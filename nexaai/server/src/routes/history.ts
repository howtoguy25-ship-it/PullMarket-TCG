// Real cross-session history: every prompt/image/video the current user has
// ever sent, in one flat list, with a real working "remove this" action.
// "Delete" here is a SOFT delete — see shared/src/schema.ts's
// messages.hiddenAt header comment for why: the row is never actually
// erased, so the account owner's permanent audit record (routes/owner.ts's
// history section) stays complete, while the user still gets a real,
// working "this is gone from my history" outcome for their own account.
import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, gt, isNull, lt, ne } from "drizzle-orm";
import { db } from "../db";
import { chatSessions, messages } from "@shared/schema";
import { requireAuth, type AuthedRequest } from "../middleware/auth";

export const historyRouter = Router();
historyRouter.use(requireAuth);

const PAGE_SIZE = 30;

historyRouter.get("/", async (req: AuthedRequest, res) => {
  const cursor = typeof req.query.cursor === "string" ? new Date(req.query.cursor) : null;

  const rows = await db
    .select({
      id: messages.id,
      sessionId: messages.sessionId,
      sessionTitle: chatSessions.title,
      kind: messages.kind,
      content: messages.content,
      metadata: messages.metadata,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .innerJoin(chatSessions, eq(messages.sessionId, chatSessions.id))
    .where(
      and(
        eq(chatSessions.userId, req.userId!),
        eq(messages.role, "user"),
        isNull(messages.hiddenAt),
        cursor && !isNaN(cursor.getTime()) ? lt(messages.createdAt, cursor) : undefined,
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(PAGE_SIZE + 1);

  const hasMore = rows.length > PAGE_SIZE;
  const page = rows.slice(0, PAGE_SIZE);
  res.json({
    items: page,
    nextCursor: hasMore ? page[page.length - 1]?.createdAt.toISOString() : null,
  });
});

/** Real ownership check + the pairing rule shared by single/bulk delete below: hides the given message and, if the very next row in its session is the assistant's reply to it, hides that too — so a re-opened session never shows an orphaned reply with no question above it. */
async function hideMessageAndReply(userId: string, messageId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: messages.id, sessionId: messages.sessionId, createdAt: messages.createdAt, sessionUserId: chatSessions.userId })
    .from(messages)
    .innerJoin(chatSessions, eq(messages.sessionId, chatSessions.id))
    .where(eq(messages.id, messageId));
  if (!row || row.sessionUserId !== userId) return false;

  const now = new Date();
  await db.update(messages).set({ hiddenAt: now }).where(eq(messages.id, row.id));

  // Hide the paired reply too, if there is one — otherwise a reopened
  // session would show NexaAi's answer with no question above it. `ne(id, ...)`
  // guards against a real Postgres/JS precision mismatch: the timestamp
  // column stores microseconds, a JS Date only holds milliseconds, so
  // `gt(createdAt, row.createdAt)` alone can spuriously match this exact
  // row against its own millisecond-truncated value.
  const [nextMessage] = await db
    .select({ id: messages.id, role: messages.role })
    .from(messages)
    .where(and(eq(messages.sessionId, row.sessionId), gt(messages.createdAt, row.createdAt), ne(messages.id, row.id)))
    .orderBy(messages.createdAt)
    .limit(1);
  if (nextMessage && nextMessage.role === "assistant") {
    await db.update(messages).set({ hiddenAt: now }).where(eq(messages.id, nextMessage.id));
  }
  return true;
}

historyRouter.delete("/:id", async (req: AuthedRequest, res) => {
  const ok = await hideMessageAndReply(req.userId!, req.params.id);
  if (!ok) return res.status(404).json({ error: "Message not found" });
  res.json({ ok: true });
});

const bulkDeleteSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(100) });
historyRouter.post("/bulk-delete", async (req: AuthedRequest, res) => {
  const parsed = bulkDeleteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  let deletedCount = 0;
  for (const id of parsed.data.ids) {
    if (await hideMessageAndReply(req.userId!, id)) deletedCount++;
  }
  res.json({ deletedCount });
});
