import { Router } from "express";
import multer from "multer";
import path from "path";
import crypto from "crypto";
import { eq, and, asc, desc } from "drizzle-orm";
import { db } from "../db";
import { voiceConversations, voiceTurns, users } from "@shared/schema";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { resolveCapabilities } from "../lib/capabilities";
import { spendCredits } from "../lib/credits";
import { UPLOADS_DIR } from "./attachments";
import { transcribeAudio, isSpeechToTextConfigured } from "../lib/voice/speechToText";
import { synthesizeSpeech, isTextToSpeechConfigured } from "../lib/voice/textToSpeech";
import { askGemini, isGeminiConfigured } from "../lib/geminiModel";
import { askModel } from "../lib/modelRouter";
import { PLAN_DEFINITIONS } from "../lib/plans";

export const voiceRouter = Router();
voiceRouter.use(requireAuth);

// Real credit cost per voice turn — roughly what a Whisper transcription +
// a short Gemini Flash completion + a TTS synthesis actually costs against
// those APIs, metered the same honest way chat.ts's CENTS_PER_ANSWER_SET is.
const CENTS_PER_VOICE_TURN = 4;

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname) || ".m4a"}`),
});
// Whisper's own upload cap is 25MB — reject bigger recordings with a clear
// error instead of letting them fail deep inside the transcription call.
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } });

async function requireVoiceChatCapability(userId: string): Promise<{ ok: true; user: typeof users.$inferSelect } | { ok: false; status: number; body: object }> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return { ok: false, status: 404, body: { error: "User not found" } };
  if (!resolveCapabilities(user.capabilities).voiceChat) {
    return { ok: false, status: 403, body: { error: "capability_disabled", message: "Voice chat is turned off in Capabilities settings." } };
  }
  return { ok: true, user };
}

voiceRouter.post("/conversations", async (req: AuthedRequest, res) => {
  const check = await requireVoiceChatCapability(req.userId!);
  if (!check.ok) return res.status(check.status).json(check.body);
  const [conversation] = await db.insert(voiceConversations).values({ userId: req.userId! }).returning();
  res.status(201).json({ conversation });
});

voiceRouter.get("/conversations", async (req: AuthedRequest, res) => {
  const rows = await db
    .select()
    .from(voiceConversations)
    .where(eq(voiceConversations.userId, req.userId!))
    .orderBy(desc(voiceConversations.startedAt))
    .limit(30);
  res.json({ conversations: rows });
});

voiceRouter.get("/conversations/:id/turns", async (req: AuthedRequest, res) => {
  const rows = await db
    .select()
    .from(voiceTurns)
    .where(and(eq(voiceTurns.conversationId, req.params.id), eq(voiceTurns.userId, req.userId!)))
    .orderBy(asc(voiceTurns.createdAt));
  res.json({ turns: rows });
});

voiceRouter.patch("/conversations/:id/end", async (req: AuthedRequest, res) => {
  const [updated] = await db
    .update(voiceConversations)
    .set({ endedAt: new Date() })
    .where(and(eq(voiceConversations.id, req.params.id), eq(voiceConversations.userId, req.userId!)))
    .returning();
  if (!updated) return res.status(404).json({ error: "Conversation not found" });
  res.json({ conversation: updated });
});

// A real Call's opening line — NexaAi speaks first, the way an answered
// phone call actually starts. Genuinely generated per call (not a canned
// string): a real Gemini/model call with temperature 0.7 (see
// lib/geminiModel.ts) asked to vary its exact wording each time, so two
// calls in a row don't sound identical. Costed and persisted the same way
// a normal turn is, just with no incoming user audio to attach.
voiceRouter.post("/conversations/:id/greeting", async (req: AuthedRequest, res) => {
  try {
    const check = await requireVoiceChatCapability(req.userId!);
    if (!check.ok) return res.status(check.status).json(check.body);
    const { user } = check;

    const [conversation] = await db
      .select()
      .from(voiceConversations)
      .where(and(eq(voiceConversations.id, req.params.id), eq(voiceConversations.userId, req.userId!)));
    if (!conversation) return res.status(404).json({ error: "Conversation not found" });

    const spend = await spendCredits(db, req.userId!, CENTS_PER_VOICE_TURN, "voice:greeting");
    if (!spend.allowed) return res.status(402).json({ error: "insufficient_credit", message: "You're out of credit. Top up to start a call." });

    const greetingInstruction =
      `[You just picked up a real phone call from ${user.displayName}. Greet them warmly by name, ask briefly how ` +
      "their day is going, and ask what they'd like help with today. Keep it to 1-2 short, natural sentences — and " +
      "genuinely vary your exact wording from how you might normally open a call, rather than reusing a stock line.]";

    const replyText = isGeminiConfigured()
      ? (await askGemini({ userMessage: greetingInstruction, history: [], mode: "voice" })).text
      : (
          await askModel({
            plan: PLAN_DEFINITIONS[user.planTier],
            answerCount: 1,
            userMessage: greetingInstruction,
            history: [],
            mode: "voice",
            focusMode: "quick",
          })
        ).text;

    let replyAudioUrl: string | null = null;
    if (isTextToSpeechConfigured()) {
      const synthesized = await synthesizeSpeech(replyText, user.voiceCharacterId);
      replyAudioUrl = synthesized.url;
    }

    const [turn] = await db
      .insert(voiceTurns)
      .values({ conversationId: conversation.id, userId: req.userId!, incomingAudioUrl: null, transcript: null, replyText, replyAudioUrl })
      .returning();

    res.status(201).json({ turn, creditBalanceAfterCents: spend.balanceAfterCents, ttsConfigured: isTextToSpeechConfigured() });
  } catch (e: any) {
    res.status(502).json({ error: "greeting_failed", message: e.message ?? "Couldn't start the call." });
  }
});

// The real live-voice-chat turn: record -> transcribe -> reason -> speak.
// Turn-based, not full-duplex streaming (see README's voice section for why)
// — every stage still runs against a real API, nothing here is simulated.
voiceRouter.post("/conversations/:id/turns", (req: AuthedRequest, res) => {
  upload.single("audio")(req, res, async (err) => {
    if (err) return res.status(400).json({ error: "upload_failed", message: err.message });
    if (!req.file) return res.status(400).json({ error: "No audio uploaded" });

    try {
      const check = await requireVoiceChatCapability(req.userId!);
      if (!check.ok) return res.status(check.status).json(check.body);
      const { user } = check;

      const [conversation] = await db
        .select()
        .from(voiceConversations)
        .where(and(eq(voiceConversations.id, req.params.id), eq(voiceConversations.userId, req.userId!)));
      if (!conversation) return res.status(404).json({ error: "Conversation not found" });

      if (!isSpeechToTextConfigured()) {
        return res.status(503).json({
          error: "voice_not_configured",
          message: "Voice chat isn't set up on this server yet — set OPENAI_API_KEY (see nexaai/.env.example).",
        });
      }

      const spend = await spendCredits(db, req.userId!, CENTS_PER_VOICE_TURN, "voice:turn");
      if (!spend.allowed) return res.status(402).json({ error: "insufficient_credit", message: "You're out of credit. Top up to keep talking." });

      const transcript = await transcribeAudio(req.file.path, req.file.mimetype);

      const priorTurns = await db
        .select()
        .from(voiceTurns)
        .where(eq(voiceTurns.conversationId, conversation.id))
        .orderBy(asc(voiceTurns.createdAt))
        .limit(10);
      // A greeting turn (routes/voice.ts's POST .../greeting) has no user
      // transcript to replay — still include NexaAi's own opening line as
      // context, just without a matching "user said" entry.
      const history = priorTurns.flatMap((t) =>
        t.transcript !== null
          ? [{ role: "user" as const, content: t.transcript }, { role: "assistant" as const, content: t.replyText }]
          : [{ role: "assistant" as const, content: t.replyText }],
      );

      // Gemini is the "speed lane" for voice specifically — fall back to the
      // user's own plan-tier model (Llama/Claude via modelRouter) if Gemini
      // isn't configured, so voice chat still works end-to-end, just slower.
      const replyText = isGeminiConfigured()
        ? (await askGemini({ userMessage: transcript, history, mode: "voice" })).text
        : (
            await askModel({
              plan: PLAN_DEFINITIONS[user.planTier],
              answerCount: 1,
              userMessage: transcript,
              history,
              mode: "voice",
              focusMode: "quick",
            })
          ).text;

      let replyAudioUrl: string | null = null;
      if (isTextToSpeechConfigured()) {
        const synthesized = await synthesizeSpeech(replyText, user.voiceCharacterId);
        replyAudioUrl = synthesized.url;
      }

      const [turn] = await db
        .insert(voiceTurns)
        .values({
          conversationId: conversation.id,
          userId: req.userId!,
          incomingAudioUrl: `/uploads/${req.file.filename}`,
          transcript,
          replyText,
          replyAudioUrl,
        })
        .returning();

      res.status(201).json({ turn, creditBalanceAfterCents: spend.balanceAfterCents, ttsConfigured: isTextToSpeechConfigured() });
    } catch (e: any) {
      res.status(502).json({ error: "voice_turn_failed", message: e.message ?? "Something went wrong processing that." });
    }
  });
});

// Lightweight standalone transcription — used by the Chat screen's "record a
// memo, prefill the text box" flow (client/src/lib/voice.ts's
// transcribeVoiceMemo), which has no conversation/turn bookkeeping of its own.
voiceRouter.post("/transcribe", (req: AuthedRequest, res) => {
  upload.single("audio")(req, res, async (err) => {
    if (err) return res.status(400).json({ error: "upload_failed", message: err.message });
    if (!req.file) return res.status(400).json({ error: "No audio uploaded" });
    if (!isSpeechToTextConfigured()) {
      return res.status(503).json({ error: "voice_not_configured", message: "Transcription isn't set up on this server yet — set OPENAI_API_KEY." });
    }
    try {
      const transcript = await transcribeAudio(req.file.path, req.file.mimetype);
      res.json({ transcript });
    } catch (e: any) {
      res.status(502).json({ error: "transcription_failed", message: e.message ?? "Couldn't transcribe that." });
    }
  });
});
