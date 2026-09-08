import { Router } from "express";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import path from "path";
import fs from "fs";
import { db } from "../db";
import { UPLOADS_DIR } from "./attachments";
import { chatSessions, messages, users, projects } from "@shared/schema";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { checkUsageWindow, recordSessionStart, recordUsageSeconds } from "../middleware/usage";
import { askModel, streamModel } from "../lib/modelRouter";
import { deepWhoIsLookup } from "../lib/whoIsSearch";
import type { AskParams, AskResult } from "../lib/anthropic";
import {
  PLAN_DEFINITIONS,
  ANSWER_MODE_DEFINITIONS,
  FOCUS_MODE_DEFINITIONS,
  resolveAnswerCount,
  isFocusModeAllowed,
  type AnswerMode,
  type FocusMode,
} from "../lib/plans";
import { spendCredits } from "../lib/credits";
import { findNearestBusinesses } from "../lib/businessLookup";
import { resolveCapabilities } from "../lib/capabilities";
import { getMemoryContext, extractAndStoreMemory } from "../lib/memory";

export const chatRouter = Router();
chatRouter.use(requireAuth);

const sendMessageSchema = z.object({
  sessionId: z.string().uuid().optional(),
  // Set when this message belongs inside a Project (see routes/projects.ts)
  // — only meaningful when starting a NEW session; an existing session
  // already carries its own projectId in the DB.
  projectId: z.string().uuid().optional(),
  text: z.string().min(1).max(4000),
  kind: z.enum(["text", "voice_memo", "camera_ask", "who_is_lookup", "assistance_request", "file_attachment"]).default("text"),
  requestedAnswerCount: z.number().int().min(1).max(6).optional(),
  requestedFocusMode: z.enum(["quick", "build", "auto", "gorilla"]).optional(),
  imageBase64: z.string().optional(),
  imageMediaType: z.enum(["image/jpeg", "image/png", "image/webp"]).optional(),
  attachment: z
    .object({
      url: z.string(),
      filename: z.string(),
      mimeType: z.string(),
      sizeBytes: z.number(),
      kind: z.enum(["image", "video", "file"]),
    })
    .optional(),
  businessCategory: z.string().optional(),
  userLat: z.number().optional(),
  userLng: z.number().optional(),
  paceHintMsSinceLastMessage: z.number().optional(),
});

// Roughly 1 credit-cent per 350 output-adjusted tokens; a real deployment
// should meter this off the Anthropic response's actual usage.output_tokens.
const CENTS_PER_ANSWER_SET = 2;

// who_is_lookup's real deep-dive (lib/whoIsSearch.ts) runs a multi-step
// web-search tool loop against Anthropic directly, regardless of plan tier
// — several real API calls per question, not one — so it's metered higher
// than a normal answer.
const WHO_IS_DEEP_DIVE_MULTIPLIER = 3;

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

  const focusMode: FocusMode = body.requestedFocusMode ?? (user.defaultFocusMode as FocusMode);
  if (!isFocusModeAllowed(user.planTier, focusMode)) {
    const required = FOCUS_MODE_DEFINITIONS[focusMode].minPlanTier;
    return {
      ok: false,
      status: 403,
      body: {
        error: "focus_mode_not_allowed",
        message: `${FOCUS_MODE_DEFINITIONS[focusMode].label} mode needs the ${required} plan or higher. Upgrade in Plans to use it.`,
      },
    } as const;
  }

  let sessionId = body.sessionId;
  let projectId: string | null = null;
  if (!sessionId) {
    if (body.projectId) {
      const [project] = await db.select().from(projects).where(and(eq(projects.id, body.projectId), eq(projects.userId, userId)));
      if (!project) return { ok: false, status: 404, body: { error: "Project not found" } } as const;
      projectId = project.id;
    }
    const [session] = await db.insert(chatSessions).values({ userId, projectId, title: body.text.slice(0, 60) }).returning();
    sessionId = session.id;
    await recordSessionStart(userId);
  } else {
    const [existingSession] = await db.select().from(chatSessions).where(eq(chatSessions.id, sessionId));
    projectId = existingSession?.projectId ?? null;
  }

  const kindMultiplier = body.kind === "who_is_lookup" ? WHO_IS_DEEP_DIVE_MULTIPLIER : 1;
  const creditCostCents = Math.round(CENTS_PER_ANSWER_SET * FOCUS_MODE_DEFINITIONS[focusMode].creditMultiplier * kindMultiplier);
  const spend = await spendCredits(db, userId, creditCostCents, `chat:${body.kind}:${focusMode}`);
  if (!spend.allowed) {
    return {
      ok: false,
      status: 402,
      body: { error: "insufficient_credit", message: "You're out of credit. Top up to keep chatting." },
    } as const;
  }

  await db.insert(messages).values({
    sessionId,
    role: "user",
    kind: body.kind,
    content: body.text,
    metadata: body.attachment ?? null,
  });

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

  let extraContext = "";
  if (body.kind === "assistance_request" && body.businessCategory) {
    const nearby = await findNearestBusinesses(body.businessCategory, body.userLat ?? null, body.userLng ?? null);
    if (nearby.length) {
      extraContext =
        "\n\n[Nearby options found by the app: " +
        nearby.map((b) => `${b.name}${b.distanceKm != null ? ` (${b.distanceKm.toFixed(1)}km away)` : ""}`).join(", ") +
        " — mention these by name and tell the user they can tap through for directions/call.]";
    }
  }

  // Camera-ask sends the image inline as base64; a general file attachment
  // (Chat's paperclip button) references an already-uploaded file instead.
  // Real vision analysis for images in a format Claude's API accepts; video
  // and unsupported image formats (e.g. HEIC) get an honest text note
  // instead of a fake "I watched it" — the model genuinely cannot view those.
  const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
  let attachmentImage: { data: string; mediaType: (typeof SUPPORTED_IMAGE_TYPES)[number] } | undefined;
  if (body.imageBase64 && body.imageMediaType) {
    attachmentImage = { data: body.imageBase64, mediaType: body.imageMediaType };
  } else if (body.attachment) {
    const { attachment } = body;
    const isSupportedImage = attachment.kind === "image" && (SUPPORTED_IMAGE_TYPES as readonly string[]).includes(attachment.mimeType);
    if (isSupportedImage) {
      try {
        const filePath = path.join(UPLOADS_DIR, path.basename(attachment.url));
        const data = fs.readFileSync(filePath).toString("base64");
        attachmentImage = { data, mediaType: attachment.mimeType as (typeof SUPPORTED_IMAGE_TYPES)[number] };
      } catch {
        extraContext += `\n\n[The user attached an image ("${attachment.filename}") but it couldn't be read — ask them to resend it.]`;
      }
    } else {
      const sizeLabel = `${(attachment.sizeBytes / (1024 * 1024)).toFixed(1)}MB`;
      extraContext +=
        attachment.kind === "video"
          ? `\n\n[The user attached a video ("${attachment.filename}", ${sizeLabel}). You cannot watch video — respond based on ` +
            "what they tell you is in it, and say plainly that you can't view the video directly.]"
          : `\n\n[The user attached a file ("${attachment.filename}", ${attachment.mimeType}, ${sizeLabel}) in a format you can't open ` +
            "directly — respond based on what they describe, and say so plainly.]";
    }
  }

  const memoryContext = await getMemoryContext(userId);

  return {
    ok: true,
    sessionId,
    askParams: {
      plan,
      answerCount,
      userMessage: body.text + extraContext,
      imageBase64: attachmentImage,
      history: orderedHistory,
      mode: (body.kind === "who_is_lookup"
        ? "who_is"
        : body.kind === "assistance_request"
          ? "assistance_request"
          : body.kind === "camera_ask" || attachmentImage
            ? "camera_ask"
            : projectId
              ? "build_project"
              : "chat") as "chat" | "who_is" | "assistance_request" | "camera_ask" | "build_project",
      memoryContext,
      focusMode,
    },
    finish: async (text: string) => {
      const [assistantMsg] = await db
        .insert(messages)
        .values({ sessionId, role: "assistant", kind: "text", content: text })
        .returning();
      const pace = (body.paceHintMsSinceLastMessage ?? 5000) < 1500 ? "forced" : "smooth";
      await recordUsageSeconds(userId, 15, pace);
      if (projectId) await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));
      // Best-effort, fire-and-forget — never delay the reply on memory extraction.
      extractAndStoreMemory(userId, sessionId, body.text, text).catch(() => {});
      return {
        assistantMsg,
        answerCount,
        focusMode,
        creditCostCents,
        creditBalanceAfterCents: spend.balanceAfterCents,
        usedGraceOverage: spend.usedGraceOverage,
      };
    },
  } as const;
}

// who_is_lookup always goes through the real web-search deep dive
// (lib/whoIsSearch.ts) instead of the normal plan-tier model — see that
// file's header comment for why this bypasses modelRouter entirely.
async function resolveAnswer(askParams: AskParams, kind: SendMessageBody["kind"], onDelta?: (delta: string) => void): Promise<AskResult> {
  if (kind === "who_is_lookup") {
    const result = await deepWhoIsLookup({
      plan: askParams.plan,
      userMessage: askParams.userMessage,
      history: askParams.history,
      memoryContext: askParams.memoryContext,
    });
    onDelta?.(result.text); // no partial streaming — the search tool loop must finish before any text exists
    return result;
  }
  return onDelta ? streamModel(askParams, onDelta) : askModel(askParams);
}

chatRouter.post("/messages", async (req: AuthedRequest, res) => {
  const parsed = sendMessageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const turn = await prepareTurn(req.userId!, parsed.data);
  if (!turn.ok) return res.status(turn.status).json(turn.body);

  const result = await resolveAnswer(turn.askParams, parsed.data.kind);
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
    const result = await resolveAnswer(turn.askParams, parsed.data.kind, (delta) => send({ delta }));
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
