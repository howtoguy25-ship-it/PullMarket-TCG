import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { chatSessions, messages, users } from "@shared/schema";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { checkUsageWindow, recordSessionStart, recordUsageSeconds } from "../middleware/usage";
import { askNexaAi, streamNexaAi } from "../lib/anthropic";
import { PLAN_DEFINITIONS, ANSWER_MODE_DEFINITIONS, resolveAnswerCount, type AnswerMode } from "../lib/plans";
import { spendCredits } from "../lib/credits";
import { findNearestBusinesses } from "../lib/businessLookup";
import { resolveCapabilities } from "../lib/capabilities";
import { getMemoryContext, extractAndStoreMemory } from "../lib/memory";

export const chatRouter = Router();
chatRouter.use(requireAuth);

const sendMessageSchema = z.object({
  sessionId: z.string().uuid().optional(),
  text: z.string().min(1).max(4000),
  kind: z.enum(["text", "voice_memo", "camera_ask", "who_is_lookup", "assistance_request"]).default("text"),
  requestedAnswerCount: z.number().int().min(1).max(6).optional(),
  imageBase64: z.string().optional(),
  imageMediaType: z.enum(["image/jpeg", "image/png", "image/webp"]).optional(),
  businessCategory: z.string().optional(),
  userLat: z.number().optional(),
  userLng: z.number().optional(),
  paceHintMsSinceLastMessage: z.number().optional(),
});

// Roughly 1 credit-cent per 350 output-adjusted tokens; a real deployment
// should meter this off the Anthropic response's actual usage.output_tokens.
const CENTS_PER_ANSWER_SET = 2;

type SendMessageBody = z.infer<typeof sendMessageSchema>;

/**
 * Everything both the plain and streaming send-message routes need to do
 * before calling the model: usage-limit check, session bookkeeping, credit
 * spend, chat history, and the assistance/who-is context injection. Kept as
 * one function so the two routes can't drift out of sync.
 */
async function prepareTurn(userId: string, body: SendMessageBody) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return { ok: false, status: 404, body: { error: "User not found" } } as const;

  const usageCheck = await checkUsageWindow(userId, user.planTier, user.timezone);
  if (!usageCheck.ok) {
    return {
      ok: false,
      status: 429,
      body: { error: usageCheck.reason, message: usageCheck.message, resetAt: usageCheck.resetAt },
    } as const;
  }

  const caps = resolveCapabilities(user.capabilities);
  const CAPABILITY_BY_KIND: Partial<Record<SendMessageBody["kind"], keyof typeof caps>> = {
    camera_ask: "cameraAsk",
    who_is_lookup: "whoIsLookup",
    assistance_request: "webLookup",
  };
  const requiredCapability = CAPABILITY_BY_KIND[body.kind];
  if (requiredCapability && !caps[requiredCapability]) {
    return {
      ok: false,
      status: 403,
      body: { error: "capability_disabled", message: "This feature is turned off in Capabilities settings — turn it back on to use it." },
    } as const;
  }

  let sessionId = body.sessionId;
  if (!sessionId) {
    const [session] = await db.insert(chatSessions).values({ userId, title: body.text.slice(0, 60) }).returning();
    sessionId = session.id;
    await recordSessionStart(userId);
  }

  const spend = await spendCredits(db, userId, CENTS_PER_ANSWER_SET, `chat:${body.kind}`);
  if (!spend.allowed) {
    return {
      ok: false,
      status: 402,
      body: { error: "insufficient_credit", message: "You're out of credit. Top up to keep chatting." },
    } as const;
  }

  await db.insert(messages).values({ sessionId, role: "user", kind: body.kind, content: body.text });

  const history = await db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(desc(messages.createdAt))
    .limit(20);
  const orderedHistory = history
    .reverse()
    .slice(0, -1) // drop the message we just inserted, sent separately below
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const plan = PLAN_DEFINITIONS[user.planTier];
  const answerCount = resolveAnswerCount(user.answerMode as AnswerMode, body.requestedAnswerCount);

  let assistanceContext = "";
  if (body.kind === "assistance_request" && body.businessCategory) {
    const nearby = await findNearestBusinesses(body.businessCategory, body.userLat ?? null, body.userLng ?? null);
    if (nearby.length) {
      assistanceContext =
        "\n\n[Nearby options found by the app: " +
        nearby.map((b) => `${b.name}${b.distanceKm != null ? ` (${b.distanceKm.toFixed(1)}km away)` : ""}`).join(", ") +
        " — mention these by name and tell the user they can tap through for directions/call.]";
    }
  }

  const memoryContext = await getMemoryContext(userId);

  return {
    ok: true,
    sessionId,
    askParams: {
      plan,
      answerCount,
      userMessage: body.text + assistanceContext,
      imageBase64: body.imageBase64 && body.imageMediaType ? { data: body.imageBase64, mediaType: body.imageMediaType } : undefined,
      history: orderedHistory,
      mode: (body.kind === "who_is_lookup" ? "who_is" : body.kind === "assistance_request" ? "assistance_request" : "chat") as
        | "chat"
        | "who_is"
        | "assistance_request",
      memoryContext,
    },
    finish: async (text: string) => {
      const [assistantMsg] = await db
        .insert(messages)
        .values({ sessionId, role: "assistant", kind: "text", content: text })
        .returning();
      const pace = (body.paceHintMsSinceLastMessage ?? 5000) < 1500 ? "forced" : "smooth";
      await recordUsageSeconds(userId, 15, pace);
      // Best-effort, fire-and-forget — never delay the reply on memory extraction.
      extractAndStoreMemory(userId, sessionId, body.text, text).catch(() => {});
      return { assistantMsg, answerCount, creditBalanceAfterCents: spend.balanceAfterCents, usedGraceOverage: spend.usedGraceOverage };
    },
  } as const;
}

chatRouter.post("/messages", async (req: AuthedRequest, res) => {
  const parsed = sendMessageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const turn = await prepareTurn(req.userId!, parsed.data);
  if (!turn.ok) return res.status(turn.status).json(turn.body);

  const result = await askNexaAi(turn.askParams);
  const outcome = await turn.finish(result.text);

  res.json({ sessionId: turn.sessionId, ...outcome });
});

// Real token-by-token streaming over Server-Sent Events, so the client can
// render NexaAi "typing" live instead of waiting for the whole answer.
// Event shapes: `data: {"delta": "..."}`, then a final
// `data: {"done": true, "sessionId": ..., "message": {...}, ...}`, or
// `data: {"error": "..."}` if something goes wrong mid-stream.
chatRouter.post("/messages/stream", async (req: AuthedRequest, res) => {
  const parsed = sendMessageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const turn = await prepareTurn(req.userId!, parsed.data);
  if (!turn.ok) return res.status(turn.status).json(turn.body);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (payload: Record<string, unknown>) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

  try {
    const result = await streamNexaAi(turn.askParams, (delta) => send({ delta }));
    const outcome = await turn.finish(result.text);
    send({ done: true, sessionId: turn.sessionId, ...outcome });
  } catch (err) {
    send({ error: err instanceof Error ? err.message : "Something went wrong." });
  } finally {
    res.end();
  }
});

chatRouter.get("/sessions", async (req: AuthedRequest, res) => {
  const rows = await db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.userId, req.userId!))
    .orderBy(desc(chatSessions.startedAt))
    .limit(50);
  res.json({ sessions: rows });
});

chatRouter.get("/sessions/:id/messages", async (req: AuthedRequest, res) => {
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, req.params.id))
    .orderBy(messages.createdAt);
  res.json({ messages: rows });
});

// Voice memo: after the memo finishes, the user can edit the transcript
// text before it's treated as their message (per spec: "add real edit back
// with interaction text to change up a bit of stuff").
const editTranscriptSchema = z.object({ messageId: z.string().uuid(), newText: z.string().min(1).max(4000) });
chatRouter.patch("/messages/:id/transcript", async (req: AuthedRequest, res) => {
  const parsed = editTranscriptSchema.safeParse({ ...req.body, messageId: req.params.id });
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const [updated] = await db
    .update(messages)
    .set({ content: parsed.data.newText })
    .where(eq(messages.id, parsed.data.messageId))
    .returning();
  res.json({ message: updated });
});

chatRouter.patch("/answer-mode", async (req: AuthedRequest, res) => {
  const schema = z.object({ mode: z.enum(["strong", "extra", "normal"]) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  await db.update(users).set({ answerMode: parsed.data.mode }).where(eq(users.id, req.userId!));
  res.json({ answerMode: parsed.data.mode, definition: ANSWER_MODE_DEFINITIONS[parsed.data.mode] });
});
