import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { chatSessions, messages, users } from "@shared/schema";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { checkUsageWindow, recordSessionStart, recordUsageSeconds } from "../middleware/usage";
import { askNexaAi } from "../lib/anthropic";
import { PLAN_DEFINITIONS, ANSWER_MODE_DEFINITIONS, resolveAnswerCount, type AnswerMode } from "../lib/plans";
import { spendCredits } from "../lib/credits";
import { findNearestBusinesses } from "../lib/businessLookup";

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

chatRouter.post("/messages", async (req: AuthedRequest, res) => {
  const parsed = sendMessageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const body = parsed.data;
  const userId = req.userId!;

  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return res.status(404).json({ error: "User not found" });

  const usageCheck = await checkUsageWindow(userId, user.planTier, user.timezone);
  if (!usageCheck.ok) {
    return res.status(429).json({ error: usageCheck.reason, message: usageCheck.message, resetAt: usageCheck.resetAt });
  }

  let sessionId = body.sessionId;
  if (!sessionId) {
    const [session] = await db.insert(chatSessions).values({ userId, title: body.text.slice(0, 60) }).returning();
    sessionId = session.id;
    await recordSessionStart(userId);
  }

  const spend = await spendCredits(db, userId, CENTS_PER_ANSWER_SET, `chat:${body.kind}`);
  if (!spend.allowed) {
    return res.status(402).json({ error: "insufficient_credit", message: "You're out of credit. Top up to keep chatting." });
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

  const result = await askNexaAi({
    plan,
    answerCount,
    userMessage: body.text + assistanceContext,
    imageBase64: body.imageBase64 && body.imageMediaType ? { data: body.imageBase64, mediaType: body.imageMediaType } : undefined,
    history: orderedHistory,
    mode: body.kind === "who_is_lookup" ? "who_is" : body.kind === "assistance_request" ? "assistance_request" : "chat",
  });

  const [assistantMsg] = await db
    .insert(messages)
    .values({ sessionId, role: "assistant", kind: "text", content: result.text })
    .returning();

  const pace = (body.paceHintMsSinceLastMessage ?? 5000) < 1500 ? "forced" : "smooth";
  await recordUsageSeconds(userId, 15, pace);

  res.json({
    sessionId,
    message: assistantMsg,
    answerCount,
    creditBalanceAfterCents: spend.balanceAfterCents,
    usedGraceOverage: spend.usedGraceOverage,
  });
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
