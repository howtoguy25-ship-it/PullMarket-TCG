import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { conversations, messages, messageAttachments, users, reports } from "@shared/schema";
import { and, desc, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { authenticateToken } from "../middleware/auth";
import { chatUpload, attachmentTypeFromMime } from "../lib/chatUpload";
import { saveUploadedFile } from "../lib/upload";
import { notifyUser } from "../lib/notify";
import { moderateMessage, isModerationConfigured } from "../lib/moderation";

const router = Router();
router.use(authenticateToken);

const PUBLIC_USER_COLUMNS = { id: users.id, username: users.username, displayName: users.displayName, avatarUrl: users.avatarUrl };

function pairIds(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

async function assertParticipant(conversationId: string, userId: string) {
  const [convo] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
  if (!convo) return null;
  if (convo.userAId !== userId && convo.userBId !== userId) return null;
  return convo;
}

async function attachAttachments(rows: (typeof messages.$inferSelect)[]) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const atts = await db.select().from(messageAttachments).where(inArray(messageAttachments.messageId, ids)).orderBy(messageAttachments.position);
  const byMessage = new Map<string, typeof atts>();
  for (const a of atts) {
    const arr = byMessage.get(a.messageId) ?? [];
    arr.push(a);
    byMessage.set(a.messageId, arr);
  }
  return rows.map((r) => ({ ...r, attachments: byMessage.get(r.id) ?? [] }));
}

router.get("/unread-count", async (req, res) => {
  const meId = req.user!.id;
  const rows = await db
    .select({ conversationId: messages.conversationId, count: sql<number>`count(*)::int` })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(and(or(eq(conversations.userAId, meId), eq(conversations.userBId, meId)), ne(conversations.status, "declined"), ne(messages.senderId, meId), isNull(messages.readAt)))
    .groupBy(messages.conversationId);
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  res.json({ count: total });
});

// ── Find or create the 1:1 conversation with another user ────────────────
router.post("/conversations/with/:userId", async (req, res) => {
  const meId = req.user!.id;
  const targetId = req.params.userId;
  if (targetId === meId) return res.status(400).json({ message: "You can't message yourself" });

  const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, targetId));
  if (!target) return res.status(404).json({ message: "User not found" });

  const [userAId, userBId] = pairIds(meId, targetId);
  const [existing] = await db.select().from(conversations).where(and(eq(conversations.userAId, userAId), eq(conversations.userBId, userBId)));
  if (existing) {
    // A declined thread is closed to whoever got declined, but if the
    // decliner is the one reaching out now, that's a fresh request.
    if (existing.status === "declined") {
      const [reopened] = await db
        .update(conversations)
        .set({ status: "pending", initiatorId: meId, respondedAt: null })
        .where(eq(conversations.id, existing.id))
        .returning();
      return res.json(reopened);
    }
    return res.json(existing);
  }

  const [created] = await db.insert(conversations).values({ userAId, userBId, initiatorId: meId, status: "pending" }).returning();
  res.status(201).json(created);
});

// ── List my conversations (accepted chats + pending requests both ways) ──
router.get("/conversations", async (req, res) => {
  const meId = req.user!.id;
  const rows = await db
    .select()
    .from(conversations)
    .where(and(or(eq(conversations.userAId, meId), eq(conversations.userBId, meId)), ne(conversations.status, "declined")))
    .orderBy(desc(conversations.lastMessageAt));

  if (rows.length === 0) return res.json([]);

  // A recipient's client fetching the inbox is the point a message has
  // reached their device — flip sent→delivered here, same as a real chat
  // app's "arrived" tick, without needing a push/socket round-trip.
  const conversationIds = rows.map((r) => r.id);
  await db
    .update(messages)
    .set({ deliveredAt: new Date() })
    .where(and(inArray(messages.conversationId, conversationIds), ne(messages.senderId, meId), isNull(messages.deliveredAt)));

  const otherIds = rows.map((r) => (r.userAId === meId ? r.userBId : r.userAId));
  const [people, unreadRows] = await Promise.all([
    db.select(PUBLIC_USER_COLUMNS).from(users).where(inArray(users.id, otherIds)),
    db
      .select({ conversationId: messages.conversationId, count: sql<number>`count(*)::int` })
      .from(messages)
      .where(and(inArray(messages.conversationId, conversationIds), ne(messages.senderId, meId), isNull(messages.readAt)))
      .groupBy(messages.conversationId),
  ]);
  const peopleById = new Map(people.map((p) => [p.id, p]));
  const unreadByConvo = new Map(unreadRows.map((u) => [u.conversationId, u.count]));

  res.json(
    rows.map((r) => ({
      ...r,
      otherUser: peopleById.get(r.userAId === meId ? r.userBId : r.userAId) ?? null,
      isIncomingRequest: r.status === "pending" && r.initiatorId !== meId,
      unreadCount: unreadByConvo.get(r.id) ?? 0,
    })),
  );
});

router.post("/conversations/:id/accept", async (req, res) => {
  const convo = await assertParticipant(req.params.id, req.user!.id);
  if (!convo) return res.status(404).json({ message: "Conversation not found" });
  if (convo.initiatorId === req.user!.id) return res.status(403).json({ message: "Only the recipient can accept" });
  if (convo.status !== "pending") return res.json(convo);

  const [updated] = await db.update(conversations).set({ status: "accepted", respondedAt: new Date() }).where(eq(conversations.id, convo.id)).returning();
  await notifyUser(convo.initiatorId, { type: "chat_accepted", title: "Message request accepted", body: `@${req.user!.username} accepted your message`, data: { conversationId: convo.id } });
  res.json(updated);
});

router.post("/conversations/:id/decline", async (req, res) => {
  const convo = await assertParticipant(req.params.id, req.user!.id);
  if (!convo) return res.status(404).json({ message: "Conversation not found" });
  if (convo.initiatorId === req.user!.id) return res.status(403).json({ message: "Only the recipient can decline" });

  const [updated] = await db.update(conversations).set({ status: "declined", respondedAt: new Date() }).where(eq(conversations.id, convo.id)).returning();
  res.json(updated);
});

// ── Messages in a conversation ────────────────────────────────────────────
router.get("/conversations/:id/messages", async (req, res) => {
  const meId = req.user!.id;
  const convo = await assertParticipant(req.params.id, meId);
  if (!convo) return res.status(404).json({ message: "Conversation not found" });

  const querySchema = z.object({ before: z.string().optional(), limit: z.coerce.number().min(1).max(100).default(50) });
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: "Invalid query" });

  const conditions = [eq(messages.conversationId, convo.id)];
  if (parsed.data.before) {
    const [beforeMsg] = await db.select({ createdAt: messages.createdAt }).from(messages).where(eq(messages.id, parsed.data.before));
    if (beforeMsg) conditions.push(lt(messages.createdAt, beforeMsg.createdAt!));
  }

  const rows = await db.select().from(messages).where(and(...conditions)).orderBy(desc(messages.createdAt)).limit(parsed.data.limit);

  // Delivered always flips on view. Read only flips once the conversation is
  // accepted — while it's still a pending request, the recipient can open
  // and read it freely without the sender ever finding out (no readAt set),
  // exactly like viewing a message request before deciding to accept.
  const now = new Date();
  await db
    .update(messages)
    .set({ deliveredAt: now })
    .where(and(eq(messages.conversationId, convo.id), ne(messages.senderId, meId), isNull(messages.deliveredAt)));
  const willMarkRead = convo.status === "accepted";
  if (willMarkRead) {
    await db
      .update(messages)
      .set({ readAt: now })
      .where(and(eq(messages.conversationId, convo.id), ne(messages.senderId, meId), isNull(messages.readAt)));
  }
  // Reflect those updates in this response too, not just the next poll —
  // the rows above were selected before the UPDATEs ran.
  const patched = rows.map((r) =>
    r.senderId === meId
      ? r
      : { ...r, deliveredAt: r.deliveredAt ?? now, readAt: willMarkRead ? (r.readAt ?? now) : r.readAt },
  );

  const withAttachments = await attachAttachments(patched);
  res.json(withAttachments.reverse());
});

router.post("/conversations/:id/messages", chatUpload.array("media", 4), async (req, res) => {
  const meId = req.user!.id;
  const convo = await assertParticipant(req.params.id, meId);
  if (!convo) return res.status(404).json({ message: "Conversation not found" });
  if (convo.status === "declined") return res.status(403).json({ message: "This conversation was declined" });

  const bodySchema = z.object({ text: z.string().max(2000).optional() });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid message" });

  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const text = parsed.data.text?.trim();
  if (!text && files.length === 0) return res.status(400).json({ message: "Message can't be empty" });

  // A pending request that the recipient replies to is a real-world signal
  // of acceptance — mirrors how message requests behave elsewhere.
  const isRecipientReply = convo.status === "pending" && convo.initiatorId !== meId;

  const [message] = await db.insert(messages).values({ conversationId: convo.id, senderId: meId, text: text || null }).returning();
  if (files.length > 0) {
    const urls = await Promise.all(files.map((f) => saveUploadedFile(f)));
    await db.insert(messageAttachments).values(urls.map((url, i) => ({ messageId: message.id, url, type: attachmentTypeFromMime(files[i].mimetype), position: i })));
  }

  const preview = text || (files.length > 0 ? (attachmentTypeFromMime(files[0].mimetype) === "video" ? "Sent a video" : "Sent a photo") : "");
  await db
    .update(conversations)
    .set({
      lastMessageAt: new Date(),
      lastMessagePreview: preview,
      ...(isRecipientReply ? { status: "accepted" as const, respondedAt: new Date() } : {}),
    })
    .where(eq(conversations.id, convo.id));

  const otherUserId = convo.userAId === meId ? convo.userBId : convo.userAId;
  await notifyUser(otherUserId, { type: "new_message", title: `@${req.user!.username}`, body: preview, data: { conversationId: convo.id } });

  const [withAttachments] = await attachAttachments([message]);
  res.status(201).json({ ...withAttachments, conversationAccepted: isRecipientReply });

  // Moderation runs after the response is already sent — it never adds
  // latency to sending a message, and a slow/failed AI call can't affect
  // delivery. A flagged message stays delivered as normal; this only opens
  // a report in the owner's review queue.
  if (text && isModerationConfigured()) {
    void moderateMessage(text)
      .then(async (verdict) => {
        if (!verdict?.flagged) return;
        await db.update(messages).set({ flagged: true }).where(eq(messages.id, message.id));
        await db.insert(reports).values({
          source: "ai_moderation",
          conversationId: convo.id,
          reportedUserId: meId,
          messageId: message.id,
          reason: verdict.category === "none" ? "other" : verdict.category,
          description: `Auto-flagged chat message: "${text.slice(0, 300)}"`,
          aiReasoning: verdict.reasoning,
        });
      })
      .catch((err) => console.error("Chat moderation pass failed:", err));
  }
});

router.get("/conversations/:id", async (req, res) => {
  const meId = req.user!.id;
  const convo = await assertParticipant(req.params.id, meId);
  if (!convo) return res.status(404).json({ message: "Conversation not found" });
  const otherUserId = convo.userAId === meId ? convo.userBId : convo.userAId;
  const [otherUser] = await db.select(PUBLIC_USER_COLUMNS).from(users).where(eq(users.id, otherUserId));
  res.json({ ...convo, otherUser: otherUser ?? null, isIncomingRequest: convo.status === "pending" && convo.initiatorId !== meId });
});

export default router;
