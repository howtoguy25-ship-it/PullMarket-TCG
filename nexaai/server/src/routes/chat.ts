import { Router } from "express";
import { eq, and, desc, gt, lt, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import path from "path";
import fs from "fs";
import { db } from "../db";
import { UPLOADS_DIR } from "./attachments";
import { chatSessions, messages, users, projects } from "@shared/schema";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { checkUsageWindow, recordMessageSent } from "../middleware/usage";
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
import { spendCredits, grantCredits, linkTransactionToMessage } from "../lib/credits";
import { findNearestBusinesses } from "../lib/businessLookup";
import { resolveCapabilities, applyOwnerOverrides } from "../lib/capabilities";
import { getOwnerSettings } from "../lib/ownerSettings";
import { getMemoryContext, extractAndStoreMemory } from "../lib/memory";
import { syncExpiredPlan } from "../lib/planExpiry";
import { resolveMaxTokens, describeVideoFrame } from "../lib/anthropic";
import { estimateChatCreditCostCents } from "../lib/costModel";
import type { NexaPromptMode } from "@shared/nexaPersona";
import { getNotionContext } from "../lib/notionContext";
import { extractFileText } from "../lib/extractFileText";
import { detectAgentBuildRequest } from "../lib/agents/detectAgentRequest";
import { detectSiteBuildRequest } from "../lib/build/detectSiteBuildRequest";
import { isSiteSparkConnected, pushProjectToSiteSpark } from "../lib/connectors/sitespark";
import { buildMcpToolBridge } from "../lib/mcp/toolBridge";
import { persistProjectFiles } from "../lib/projectFiles";
import { extractVideoFrames, FRAME_COUNT, type VideoFrame, type VideoFrameBreakdownEntry } from "../lib/videoFrames";
import { agents } from "@shared/schema";
import { checkSpelling } from "../lib/spellcheck";

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
  // Records "what the user is working on" for this session (see
  // shared/src/schema.ts's chatSessions.activeTask) — sent once, together
  // with the message that kicks a task off (e.g. the client's "Help me
  // plan something" flow), not something the caller toggles every turn.
  setActiveTask: z.string().max(200).optional(),
});

// A short, unambiguous stop/cancel message clears an in-progress active
// task deterministically — deliberately narrow (whole-message match, not a
// substring anywhere in a longer sentence) so it never misfires on a
// message that merely mentions "stop" or "cancel" in passing.
const CANCEL_TASK_RE = /^\s*(stop|cancel|cancel (this|that|it)|never ?mind|drop (this|that|it)|forget (this|that|it))\.?\s*$/i;

// who_is_lookup's real deep-dive (lib/whoIsSearch.ts) runs a multi-step
// web-search tool loop against Anthropic directly, regardless of plan tier
// — several real API calls per question, not one — so it's metered higher
// than a normal answer.
const WHO_IS_DEEP_DIVE_MULTIPLIER = 3;

// "1 minute time frame after that user can't make changes to their texts" —
// a real, server-enforced window measured from the message's own createdAt,
// not reset by editing itself, so re-editing can't extend it.
const EDIT_WINDOW_MS = 60_000;

type SendMessageBody = z.infer<typeof sendMessageSchema>;

/**
 * Everything both the plain and streaming send-message routes need to do
 * before calling the model: usage-limit check, session bookkeeping, credit
 * spend, chat history, and the assistance/who-is context injection. Kept as
 * one function so the two routes can't drift out of sync.
 */
async function prepareTurn(userId: string, body: SendMessageBody) {
  // Lazy plan-expiry check — see lib/planExpiry.ts — a lapsed Paddle/Apple
  // subscription must stop granting Pro/Max model access on the very next
  // message, not whenever the user happens to reopen Settings.
  await syncExpiredPlan(userId);
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

  const ownerSettings = await getOwnerSettings();
  const caps = applyOwnerOverrides(resolveCapabilities(user.capabilities), ownerSettings);
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

  // Deterministic "build me a website/app" detector
  // (lib/build/detectSiteBuildRequest.ts) — Smart Build. Computed once here,
  // before session/project linking, since a brand-new session needs the
  // auto-created project's id at the moment it's inserted (not patched in
  // afterward) for chatSessions.projectId to be right from turn one.
  const siteBuildIntentDetected = detectSiteBuildRequest(body.text);
  let siteBuildTriggered = false;

  let sessionId = body.sessionId;
  let projectId: string | null = null;
  let activeTask: string | null = null;
  let taskJustCancelled = false;
  if (!sessionId) {
    if (body.projectId) {
      const [project] = await db.select().from(projects).where(and(eq(projects.id, body.projectId), eq(projects.userId, userId)));
      if (!project) return { ok: false, status: 404, body: { error: "Project not found" } } as const;
      projectId = project.id;
    } else if (caps.smartBuild && siteBuildIntentDetected) {
      const [autoProject] = await db.insert(projects).values({ userId, title: body.text.slice(0, 60) }).returning();
      projectId = autoProject.id;
      siteBuildTriggered = true;
    }
    const [session] = await db
      .insert(chatSessions)
      .values({ userId, projectId, title: body.text.slice(0, 60), activeTask: body.setActiveTask ?? null })
      .returning();
    sessionId = session.id;
    activeTask = session.activeTask;
  } else {
    const [existingSession] = await db.select().from(chatSessions).where(eq(chatSessions.id, sessionId));
    projectId = existingSession?.projectId ?? null;
    activeTask = existingSession?.activeTask ?? null;

    // Same detection, mid-conversation: "actually, build me a website for
    // X" typed later in an ordinary chat (not just as the opening message)
    // still starts a real Project — the session's own projectId is patched
    // in immediately so every later turn in this same conversation keeps
    // landing in build_project mode, same as the brand-new-session case above.
    if (!projectId && caps.smartBuild && siteBuildIntentDetected) {
      const [autoProject] = await db.insert(projects).values({ userId, title: body.text.slice(0, 60) }).returning();
      projectId = autoProject.id;
      siteBuildTriggered = true;
      await db.update(chatSessions).set({ projectId }).where(eq(chatSessions.id, sessionId));
    }

    if (body.setActiveTask) {
      activeTask = body.setActiveTask;
      await db.update(chatSessions).set({ activeTask }).where(eq(chatSessions.id, sessionId));
    } else if (activeTask && CANCEL_TASK_RE.test(body.text)) {
      activeTask = null;
      taskJustCancelled = true;
      await db.update(chatSessions).set({ activeTask: null }).where(eq(chatSessions.id, sessionId));
    }
  }

  const plan = PLAN_DEFINITIONS[user.planTier];
  // Real, cost-aware charge (lib/costModel.ts) — computed from the actual
  // worst-case max_tokens this exact plan/focus-mode/message-shape turn is
  // bounded to (the same resolveMaxTokens the real API call itself uses),
  // not a flat guess, so this can never charge less than what the message
  // could really cost in Anthropic API fees. earlyMode replicates the real
  // mode-selection precedence in the same function below using only
  // request-level signals (available before attachment extraction runs) —
  // see the comment at its use site for the one deliberately-safe
  // (over- not under-charging) edge case this simplification allows.
  const earlyMode: NexaPromptMode =
    body.kind === "who_is_lookup"
      ? "who_is"
      : body.kind === "assistance_request"
        ? "assistance_request"
        : body.kind === "camera_ask" || !!body.imageBase64 || (body.attachment && body.attachment.kind !== "file")
          ? "camera_ask"
          : projectId
            ? "build_project"
            : "chat";
  const kindMultiplier = body.kind === "who_is_lookup" ? WHO_IS_DEEP_DIVE_MULTIPLIER : 1;
  const maxTokensForCost = resolveMaxTokens(plan, focusMode, {
    mode: earlyMode,
    enableTopicImages: earlyMode === "chat" && caps.topicImages,
    reasoningEffortCap: ownerSettings.reasoningEffortCap,
  });
  // Real extra cost for vision content — a single photo (camera-ask or an
  // image attachment) or, for a video attachment, the real sampled-frame
  // count plus one real per-frame description call each (see the live
  // frame-by-frame breakdown below and lib/anthropic.ts's describeVideoFrame).
  const isVideoAttachment = !!(body.attachment && body.attachment.kind !== "image" && body.attachment.kind !== "file");
  const imageCountForCost = body.imageBase64 || body.attachment?.kind === "image" ? 1 : isVideoAttachment ? FRAME_COUNT : 0;
  const creditCostCents = estimateChatCreditCostCents({
    planProvider: plan.provider,
    model: plan.model,
    maxOutputTokens: maxTokensForCost,
    kindMultiplier,
    imageCount: imageCountForCost,
    videoFrameDescriptionCount: isVideoAttachment ? FRAME_COUNT : 0,
  });
  const spend = await spendCredits(db, userId, creditCostCents, `chat:${body.kind}:${focusMode}`);
  if (!spend.allowed) {
    return {
      ok: false,
      status: 402,
      body: { error: "insufficient_credit", message: "You're out of credit. Top up to keep chatting." },
    } as const;
  }

  const [userMessageRow] = await db
    .insert(messages)
    .values({
      sessionId,
      role: "user",
      kind: body.kind,
      content: body.text,
      metadata: body.attachment ?? null,
    })
    .returning();

  // Real link from the charge to the exact message it paid for — the
  // billing-dispute review (lib/creditDisputes.ts) and the auto-refund
  // below both need this to know what they're checking.
  if (spend.transactionId) await linkTransactionToMessage(db, spend.transactionId, userMessageRow.id);

  const history = await db
    .select()
    .from(messages)
    // A message the user has genuinely deleted from their own History
    // shouldn't keep quietly steering the conversation either — see
    // messages.hiddenAt's header comment.
    .where(and(eq(messages.sessionId, sessionId), isNull(messages.hiddenAt)))
    .orderBy(desc(messages.createdAt))
    .limit(20);
  const orderedHistory = history
    .reverse()
    .slice(0, -1) // drop the message we just inserted, sent separately below
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const answerCount = resolveAnswerCount(user.answerMode as AnswerMode, body.requestedAnswerCount);

  let extraContext = "";
  if (activeTask && body.setActiveTask) {
    extraContext += `\n\n[The user just started a task for this conversation: "${activeTask}". Help them with it directly now.]`;
  } else if (activeTask) {
    extraContext += `\n\n[Ongoing task for this conversation: "${activeTask}". Keep helping toward it across turns — don't drift to something unrelated unless the user clearly asks you to stop, cancel, or move on.]`;
  } else if (taskJustCancelled) {
    extraContext += `\n\n[The user just cancelled the task they were working on in this conversation. Acknowledge that plainly — don't keep pushing the old task.]`;
  }
  // Real, structured place data (name/address/lat/lng) for the client to
  // render as actual "Get directions" links (client/src/lib/maps.ts's
  // openDirections, per the user's Settings > Directions app choice) —
  // the model only gets to narrate these by name, never a raw
  // lat/lng/URL it could get wrong, since the real link is built
  // client-side from this same data, not parsed out of its prose.
  let nearbyBusinesses: Awaited<ReturnType<typeof findNearestBusinesses>> = [];
  if (body.kind === "assistance_request" && body.businessCategory) {
    nearbyBusinesses = await findNearestBusinesses(body.businessCategory, body.userLat ?? null, body.userLng ?? null);
    if (nearbyBusinesses.length) {
      extraContext =
        "\n\n[Nearby options found by the app: " +
        nearbyBusinesses.map((b) => `${b.name}${b.distanceKm != null ? ` (${b.distanceKm.toFixed(1)}km away)` : ""}`).join(", ") +
        " — mention these by name; the app itself shows a real 'Get directions' link for each below your reply, so don't invent your own directions/maps link or phone step.]";
    }
  }

  // Camera-ask sends the image inline as base64; a general file attachment
  // (Chat's paperclip button) references an already-uploaded file instead.
  // Real vision analysis for images in a format Claude's API accepts; video
  // and unsupported image formats (e.g. HEIC) get an honest text note
  // instead of a fake "I watched it" — the model genuinely cannot view those.
  const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
  let attachmentImage: { data: string; mediaType: (typeof SUPPORTED_IMAGE_TYPES)[number] } | undefined;
  let videoFrames: VideoFrame[] | undefined;
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
    } else if (attachment.kind === "file") {
      // Real text/PDF extraction (lib/extractFileText.ts) — the model
      // actually reads the document's real content here, not just its
      // filename. Anything it has no real reader for (a spreadsheet
      // binary, a Word .doc, etc.) still gets the honest fallback.
      const filePath = path.join(UPLOADS_DIR, path.basename(attachment.url));
      let extractedText: string | null = null;
      try {
        extractedText = await extractFileText(filePath, attachment.mimeType, attachment.filename);
      } catch {
        extractedText = null;
      }
      if (extractedText) {
        extraContext +=
          `\n\n[The user attached a file ("${attachment.filename}"). Its real contents, extracted directly from the file:]\n` +
          `"""\n${extractedText}\n"""\n` +
          "[Break this down for the user section by section — don't just summarize in one line.]";
      } else {
        const sizeLabel = `${(attachment.sizeBytes / (1024 * 1024)).toFixed(1)}MB`;
        extraContext += `\n\n[The user attached a file ("${attachment.filename}", ${attachment.mimeType}, ${sizeLabel}) in a format you can't open directly — respond based on what they describe, and say so plainly.]`;
      }
    } else {
      // Real video "watching" via frame sampling (lib/videoFrames.ts) — the
      // Claude API has no native video input, so this extracts real stills
      // spread across the video's actual duration with a real ffmpeg binary
      // and sends them as real vision content. Any real extraction failure
      // (corrupt file, unsupported codec, etc.) falls back to the honest
      // "can't watch" note rather than pretending.
      try {
        const filePath = path.join(UPLOADS_DIR, path.basename(attachment.url));
        videoFrames = await extractVideoFrames(filePath);
        extraContext +=
          `\n\n[The user attached a video ("${attachment.filename}"). Attached are ${videoFrames.length} real frames sampled across its ` +
          "duration (not the full motion) — describe/analyze based on what's actually visible across these stills, and say plainly that " +
          "you're working from sampled frames, not the whole video.]";
      } catch {
        const sizeLabel = `${(attachment.sizeBytes / (1024 * 1024)).toFixed(1)}MB`;
        extraContext += `\n\n[The user attached a video ("${attachment.filename}", ${sizeLabel}) but no frames could be sampled from it — respond based on what they tell you is in it, and say plainly that you can't view it directly.]`;
      }
    }
  }

  // Deterministic "build me an agent" detector (lib/agents/detectAgentRequest.ts)
  // — chat can kick this off, but the Agent Builder tab is where the real
  // platform connection/approval queue/dry-run lives, so this creates a
  // real, off-by-default draft row there rather than trying to build
  // anything inline in the chat reply.
  const agentIntent = detectAgentBuildRequest(body.text);
  if (agentIntent) {
    if (caps.agentBuilder) {
      const [draft] = await db
        .insert(agents)
        .values({
          userId,
          name: `${agentIntent.label} agent — ${body.text.slice(0, 40)}`,
          kind: agentIntent.kind,
          config: { instructions: body.text, autoSend: false },
        })
        .returning();
      extraContext += `\n\n[The app just created a real draft agent named "${draft.name}" in the user's Agents tab from this request. Tell them plainly, in your own words, that you've started it there — Agents is where they connect the real platform, test it with a dry run, and turn it on; you don't build or run agents directly in chat.]`;
    } else {
      extraContext += `\n\n[The user asked you to build an agent, but Agent Builder is turned off in their Capabilities settings. Tell them plainly to turn it on in Settings > Capabilities before you can start a draft for them.]`;
    }
  }

  // Smart Build (detected above, before session/project linking): a real
  // Project already exists for this turn (mode below becomes build_project),
  // so this just tells the model how to behave — build now if there's
  // enough real detail, Claude-style, or ask focused clarifying questions
  // first if it's too vague — and whether a real SiteSpark push will follow.
  let siteSparkForSmartBuild: Awaited<ReturnType<typeof isSiteSparkConnected>> | null = null;
  if (siteBuildTriggered) {
    siteSparkForSmartBuild = await isSiteSparkConnected(userId);
    extraContext +=
      `\n\n[Smart Build: the app just started a real Project ("${body.text.slice(0, 60)}") for this request. If it ` +
      "already has enough real detail (what kind of site/app, its purpose, any concrete content) go ahead and " +
      "build it now — generate the real files per the build format below. If it's genuinely too vague to build " +
      'from (e.g. just "build me a website" with nothing else), ask 1-2 short, focused clarifying questions first ' +
      "instead of guessing at what they want — once you have enough, build it in your next reply without asking " +
      "again. " +
      (siteSparkForSmartBuild.connected
        ? "Their SiteSpark account is connected — if you build real files this reply, mention the app will push it live there right after."
        : "SiteSpark isn't connected — if you build something, say plainly that connecting SiteSpark in Settings > " +
          "Connectors is what would make it a real, live site; don't claim it's live now.") +
      "]";
  } else if (siteBuildIntentDetected && !projectId && !caps.smartBuild) {
    extraContext += `\n\n[The user's message looks like a "build me a website/app" request, but Smart Build is turned off in their Capabilities settings, so no Project was auto-started. Help with their request in a normal chat reply, and mention they can turn Smart Build on in Settings > Capabilities if they'd like this built automatically next time.]`;
  }

  const memoryContext = (await getMemoryContext(userId)) + (await getNotionContext(userId));

  // Real MCP tools from the user's connected connectors (routes/mcp.ts) —
  // who_is_lookup never reaches this (it bypasses askParams entirely via
  // deepWhoIsLookup's own web_search tool loop), so no conflict there.
  const mcpBridge = await buildMcpToolBridge(userId);
  if (mcpBridge.gatedToolNames.length) {
    extraContext += `\n\n[These real MCP actions exist but are withheld until the user authorises them — you literally cannot call them right now: ${mcpBridge.gatedToolNames.join(", ")}. If doing what they ask would need one of these, tell them plainly which connector to open in Connectors and turn off "Require approval before taking real actions" for.]`;
  }

  const mode = (
    body.kind === "who_is_lookup"
      ? "who_is"
      : body.kind === "assistance_request"
        ? "assistance_request"
        : body.kind === "camera_ask" || attachmentImage || videoFrames
          ? "camera_ask"
          : projectId
            ? "build_project"
            : "chat"
  ) as "chat" | "who_is" | "assistance_request" | "camera_ask" | "build_project";

  return {
    ok: true,
    sessionId,
    userMessage: userMessageRow,
    // Raw extracted stills (with real timestamps), if a video was attached —
    // route handlers use this to run the live frame-by-frame breakdown
    // (real per-frame describeVideoFrame calls) after their own response
    // has started, not blocking prepareTurn's own real gating (auth/usage/
    // capability/credit checks) on it.
    videoFrames,
    askParams: {
      plan,
      answerCount,
      userMessage: body.text + extraContext,
      imageBase64: attachmentImage,
      extraImages: videoFrames,
      history: orderedHistory,
      mode,
      memoryContext,
      focusMode,
      mcpTools: mcpBridge.tools.length ? mcpBridge.tools : undefined,
      mcpToolRunner: mcpBridge.runner,
      // Real web_search, gated by the "Real images for topics" capability —
      // only for plain chat turns; who-is has its own dedicated deep-dive
      // path, and code-build/camera/assistance turns aren't what it's for.
      enableTopicImages: mode === "chat" && caps.topicImages,
      // Real, app-wide reasoning-effort ceiling from the owner panel — see
      // lib/anthropic.ts's resolveEffectiveThinkingBudget. Undefined/null
      // means uncapped (today's plan/focus-mode defaults apply as-is).
      reasoningEffortCap: ownerSettings.reasoningEffortCap ?? undefined,
    },
    finish: async (text: string, videoFrameBreakdown?: VideoFrameBreakdownEntry[]) => {
      // NOTE: this key is `message`, not `assistantMsg` — the client
      // (ChatScreen/ProjectChatScreen) reads `final.message` on both the
      // plain and streaming routes. Keep them in sync: a mismatch here
      // means `final.message` is `undefined` client-side, and
      // `FormattedAnswer`'s `text.split("\n")` throws on the very next
      // render, crashing the whole screen right after every real reply.
      const metadata: Record<string, unknown> = {};
      if (nearbyBusinesses.length) metadata.businesses = nearbyBusinesses;
      if (videoFrameBreakdown?.length) metadata.videoFrames = videoFrameBreakdown;
      const [message] = await db
        .insert(messages)
        .values({
          sessionId,
          role: "assistant",
          kind: "text",
          content: text,
          metadata: Object.keys(metadata).length ? metadata : null,
        })
        .returning();
      await recordMessageSent(userId);
      // Smart Build's real "once finished" notification — a second, genuine
      // assistant message (not the model narrating a promise) reporting
      // what actually happened: a real SiteSpark push succeeded with a real
      // URL, failed with a real reason, or (no SiteSpark connected) nothing
      // to report here at all. See ChatScreen.tsx for how this renders and
      // gets spoken.
      let followUpMessage: typeof message | null = null;
      if (projectId) {
        await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));
        // Real code building: persist this reply's fenced files as the
        // project's actual file tree (see lib/projectFiles.ts) — a no-op
        // when mode isn't build_project, since only CODE_BUILD_FORMAT
        // produces the `filename="..."` fence shape this parses.
        if (mode === "build_project") {
          const persistedFiles = await persistProjectFiles(projectId, text);
          if (siteBuildTriggered && persistedFiles.length) {
            // Marks Smart Build's first-ever completed real build for this
            // account — once, permanently — which is what drives the
            // ChatScreen "want to keep Smart Build on?" follow-up banner.
            if (!user.smartBuildFirstRunAt) {
              await db.update(users).set({ smartBuildFirstRunAt: new Date() }).where(eq(users.id, userId));
            }
            if (siteSparkForSmartBuild?.connected) {
              try {
                const result = await pushProjectToSiteSpark(siteSparkForSmartBuild.accessToken, {
                  externalRef: projectId,
                  name: body.text.slice(0, 60),
                  files: persistedFiles.map((f) => ({ path: f.path, content: f.content })),
                });
                const [pushed] = await db
                  .insert(messages)
                  .values({ sessionId, role: "assistant", kind: "text", content: `Pushed it live to SiteSpark: ${result.url}` })
                  .returning();
                followUpMessage = pushed;
              } catch (err) {
                const [failed] = await db
                  .insert(messages)
                  .values({
                    sessionId,
                    role: "assistant",
                    kind: "text",
                    content: `I built the files, but pushing to SiteSpark failed: ${err instanceof Error ? err.message : "unknown error"}. You can retry the export from this Project's page.`,
                  })
                  .returning();
                followUpMessage = failed;
              }
            }
          }
        }
      }
      // Best-effort, fire-and-forget — never delay the reply on memory extraction.
      extractAndStoreMemory(userId, sessionId, body.text, text).catch(() => {});
      return {
        message,
        followUpMessage,
        smartBuild: siteBuildTriggered ? { triggered: true as const } : undefined,
        answerCount,
        focusMode,
        creditCostCents,
        creditBalanceAfterCents: spend.balanceAfterCents,
        usedGraceOverage: spend.usedGraceOverage,
        activeTask,
      };
    },
    // Real, automatic credit-back for a certain billing error — not a
    // "dispute" needing review, since there's nothing ambiguous about it:
    // the turn was paid for and then genuinely never produced a reply
    // (resolveAnswer/finish threw). Route handlers call this from their
    // catch block. Idempotent via providerReference, in case of a retry.
    onFailure: async () => {
      if (!spend.transactionId) return;
      await grantCredits(db, userId, creditCostCents, {
        kind: "refund",
        providerReference: `auto-refund:${spend.transactionId}`,
        note: `Automatic refund — no reply was generated for message ${userMessageRow.id}`,
      });
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

  // Credit was already spent inside prepareTurn — if anything from here on
  // throws, the user paid for a reply that never arrived. That's a real,
  // certain billing error, so it's refunded automatically, not left for a
  // manual dispute (see prepareTurn's onFailure).
  try {
    const result = await resolveAnswer(turn.askParams, parsed.data.kind);

    // Real per-frame breakdown: one live Claude vision call per sampled video
    // still (see lib/anthropic.ts's describeVideoFrame). Non-streaming route,
    // so there's no live SSE push here — the client just gets the finished
    // breakdown alongside the rest of the reply.
    let videoFrameBreakdown: VideoFrameBreakdownEntry[] | undefined;
    if (turn.videoFrames?.length) {
      videoFrameBreakdown = await Promise.all(
        turn.videoFrames.map(async (frame, index) => ({
          index,
          timestampSeconds: frame.timestampSeconds,
          description: await describeVideoFrame(frame),
        })),
      );
    }

    const outcome = await turn.finish(result.text, videoFrameBreakdown);

    res.json({ sessionId: turn.sessionId, userMessage: turn.userMessage, ...outcome });
  } catch (err) {
    await turn.onFailure();
    throw err;
  }
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

  // Real cancellation: fires when the client taps "stop" (which simply
  // aborts its own fetch) or genuinely disconnects — either way Node's own
  // `close` event tells us, and this signal is threaded all the way down
  // into the actual Anthropic/self-hosted HTTP request so a stop genuinely
  // cancels the upstream call instead of just abandoning it in the
  // background. Safe to fire more than once (e.g. also after our own
  // `res.end()` below) — aborting an already-settled signal is a no-op.
  const controller = new AbortController();
  res.on("close", () => controller.abort());

  // The client is very possibly already gone by the time this fires, so a
  // write here must never throw and crash the request.
  const send = (payload: Record<string, unknown>) => {
    try {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch {
      // client disconnected — nothing to deliver this to anymore
    }
  };

  try {
    // Real, genuinely live frame-by-frame breakdown: each sampled still is
    // pushed to the client the moment it's ready, then its real Claude
    // vision description follows right after — one frame at a time, in
    // real elapsed order, not a single batch dumped at the end. Runs
    // before the main answer streams, matching how NexaAi actually "looks
    // at the video first" before answering.
    let videoFrameBreakdown: VideoFrameBreakdownEntry[] | undefined;
    if (turn.videoFrames?.length) {
      videoFrameBreakdown = [];
      for (let index = 0; index < turn.videoFrames.length; index++) {
        const frame = turn.videoFrames[index];
        send({
          videoFrame: {
            index,
            timestampSeconds: frame.timestampSeconds,
            thumbnailBase64: frame.data,
            mediaType: frame.mediaType,
          },
        });
        const description = await describeVideoFrame(frame);
        send({ videoFrameDescription: { index, description } });
        videoFrameBreakdown.push({ index, timestampSeconds: frame.timestampSeconds, description });
      }
    }

    const result = await resolveAnswer({ ...turn.askParams, signal: controller.signal }, parsed.data.kind, (delta) => send({ delta }));
    if (result.stopped && !result.text.trim()) {
      // Stopped before any real text existed — nothing worth saving, and
      // not a billing error (the user chose to stop), so no auto-refund.
      send({ done: true, stopped: true, sessionId: turn.sessionId });
    } else {
      const outcome = await turn.finish(result.text, videoFrameBreakdown);
      send({ done: true, stopped: result.stopped ?? false, sessionId: turn.sessionId, userMessage: turn.userMessage, ...outcome });
    }
  } catch (err) {
    // Same real, certain billing error as the non-streaming route: paid
    // for, never answered — refund it automatically before telling the
    // client something went wrong.
    await turn.onFailure();
    send({ error: err instanceof Error ? err.message : "Something went wrong." });
  } finally {
    res.end();
  }
});

// Real per-attachment-kind cost preview for the composer's "+" button —
// computed with the exact same estimateChatCreditCostCents formula
// prepareTurn uses to actually charge a turn, so the numbers shown before
// the user picks a file are the real numbers, not a separate guess that
// could drift from what they're actually charged.
// Real, dictionary-based "did you mean" — nspell + the actual English
// Hunspell dictionary (lib/spellcheck.ts), never applied automatically.
// The client shows whatever comes back as a confirmation the user has to
// accept before the corrected text is sent.
const spellcheckSchema = z.object({ text: z.string().min(1).max(4000) });
chatRouter.post("/spellcheck", async (req: AuthedRequest, res) => {
  const parsed = spellcheckSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const suggestions = await checkSpelling(parsed.data.text);
  res.json({ suggestions });
});

// Real, one-time "NexaAi introduces itself" for a genuinely brand-new
// user — never fires again once this account has any chat session, so
// re-opening the app or starting a fresh "+ New chat" later never repeats
// it. Costed and generated exactly like a real reply (askModel, real
// credit spend, real auto-refund on failure) — not a canned client-side
// string, matching how routes/voice.ts's own POST .../greeting handles a
// real Call's opening line.
chatRouter.post("/welcome", async (req: AuthedRequest, res) => {
  const [user] = await db.select().from(users).where(eq(users.id, req.userId!));
  if (!user) return res.status(404).json({ error: "User not found" });

  const [existingSession] = await db.select({ id: chatSessions.id }).from(chatSessions).where(eq(chatSessions.userId, req.userId!)).limit(1);
  if (existingSession) return res.json({ skipped: true });

  const plan = PLAN_DEFINITIONS[user.planTier];
  const maxOutputTokens = resolveMaxTokens(plan, "quick", { mode: "chat" });
  const creditCostCents = estimateChatCreditCostCents({ planProvider: plan.provider, model: plan.model, maxOutputTokens, kindMultiplier: 1 });
  const spend = await spendCredits(db, req.userId!, creditCostCents, "chat:welcome");
  // A brand-new account with no trial credit somehow already spent is an
  // extreme edge case, but the honest behavior is to skip rather than
  // block onboarding on it — the empty-state UI still works fine either way.
  if (!spend.allowed) return res.json({ skipped: true });

  const [session] = await db.insert(chatSessions).values({ userId: req.userId!, title: "Welcome to NexaAi" }).returning();

  const welcomeInstruction =
    `[This is ${user.displayName}'s very first time opening NexaAi — they just finished signing up. Introduce yourself ` +
    "by name and welcome them warmly by name. Explain, in detail and professionally (not a rushed one-liner), what " +
    "NexaAi actually does: real chat with real depth control, camera-ask visual analysis, live voice chat and real " +
    "phone-style calls, building and deploying real projects/code, connecting real accounts (Google, Notion, Slack, " +
    "GitHub, and more) and building autoresponder agents, and a real credit-based usage system. Whenever you name a " +
    "focus mode, you MUST wrap that exact word in double asterisks, e.g. write literally \"**Quick**\" and " +
    "\"**Build**\" and \"**Auto**\" and \"**Gorilla**\" — not the plain words Quick/Build/Auto/Gorilla without the " +
    "asterisks, and nothing else in the message gets this bold treatment. Give each mode its own genuinely distinct, " +
    "vivid one-clause description of what it actually feels like to use — never the same generic " +
    "\"fast/thorough/adaptive/deep\" wording every time; vary the phrasing between users. Example of the exact " +
    "formatting to use (write your own fresh sentence, don't reuse this wording): \"pick **Quick** when you just " +
    "want the fast answer, **Build** when you want the full walkthrough, **Auto** when you'd rather I judge the " +
    "right depth myself, or **Gorilla** when the problem deserves everything I've got.\" 4-6 genuinely substantive " +
    "sentences. Do not end by asking what they " +
    "want help with in a rushed way — this is a proper welcome, not a normal reply.]";

  try {
    const result = await askModel({ plan, answerCount: 1, userMessage: welcomeInstruction, history: [], mode: "chat", focusMode: "quick" });
    const [message] = await db
      .insert(messages)
      .values({ sessionId: session.id, role: "assistant", kind: "text", content: result.text })
      .returning();
    if (spend.transactionId) await linkTransactionToMessage(db, spend.transactionId, message.id);
    res.json({ skipped: false, sessionId: session.id, message, creditBalanceAfterCents: spend.balanceAfterCents });
  } catch (err) {
    // Same real, certain billing error as every other turn: paid for,
    // never answered — refund it automatically.
    if (spend.transactionId) {
      await grantCredits(db, req.userId!, creditCostCents, {
        kind: "refund",
        providerReference: `auto-refund:${spend.transactionId}`,
        note: "Automatic refund — the welcome message failed to generate",
      });
    }
    res.status(502).json({ error: "welcome_failed", message: "Couldn't generate a welcome message." });
  }
});

// Real, model-generated nickname for the empty-chat greeting header — a
// tiny cosmetic flourish, not a chat answer, so unlike /welcome or a real
// reply it is never charged to the user's credit balance. Cached per real
// calendar day (the user's own local date, sent by the client) so it's one
// genuine model call per day, not one per screen open.
const nicknameSchema = z.object({ localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), hour: z.number().int().min(0).max(23) });
chatRouter.get("/nickname", async (req: AuthedRequest, res) => {
  const parsed = nicknameSchema.safeParse({ localDate: req.query.localDate, hour: Number(req.query.hour) });
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { localDate, hour } = parsed.data;

  const [user] = await db.select().from(users).where(eq(users.id, req.userId!));
  if (!user) return res.status(404).json({ error: "User not found" });

  if (user.cachedNickname && user.cachedNicknameDate === localDate) {
    return res.json({ nickname: user.cachedNickname });
  }

  const timeOfDay = hour < 5 ? "the middle of the night" : hour < 12 ? "the morning" : hour < 17 ? "the afternoon" : hour < 21 ? "the evening" : "late at night";
  const firstName = user.displayName.trim().split(/\s+/)[0];
  const nicknamePrompt =
    `Invent exactly ONE short, warm, playful nickname (2-4 words total) for a person named "${firstName}", ` +
    `tying it to the fact that it's currently ${timeOfDay} where they are. Respectful, never mocking, never generic ` +
    `("buddy"/"friend"/"champ"), and it must actually incorporate their real name "${firstName}" — a nickname that ` +
    `drops their name isn't personal. Reply with ONLY the nickname itself, no quotes, no punctuation, no explanation.`;

  const plan = PLAN_DEFINITIONS[user.planTier];
  try {
    const result = await askModel({ plan, answerCount: 1, userMessage: nicknamePrompt, history: [], mode: "chat", focusMode: "quick" });
    const nickname = result.text.trim().replace(/^["']|["']$/g, "").split("\n")[0].slice(0, 60);
    await db.update(users).set({ cachedNickname: nickname, cachedNicknameDate: localDate }).where(eq(users.id, req.userId!));
    res.json({ nickname });
  } catch {
    // Real failure, honest fallback — the client already knows how to
    // greet with just the plain first name when this call doesn't return.
    res.status(502).json({ error: "nickname_failed" });
  }
});

chatRouter.get("/attachment-cost-estimate", async (req: AuthedRequest, res) => {
  const [user] = await db.select().from(users).where(eq(users.id, req.userId!));
  if (!user) return res.status(404).json({ error: "User not found" });

  const focusModeParam = typeof req.query.focusMode === "string" ? req.query.focusMode : undefined;
  const focusMode: FocusMode = (focusModeParam && focusModeParam in FOCUS_MODE_DEFINITIONS ? focusModeParam : user.defaultFocusMode) as FocusMode;
  const plan = PLAN_DEFINITIONS[user.planTier];
  const maxOutputTokens = resolveMaxTokens(plan, focusMode, { mode: "chat" });

  const costFor = (imageCount: number, videoFrameDescriptionCount: number) =>
    estimateChatCreditCostCents({ planProvider: plan.provider, model: plan.model, maxOutputTokens, kindMultiplier: 1, imageCount, videoFrameDescriptionCount });

  const textOnlyCents = costFor(0, 0);
  res.json({
    focusMode,
    // Every number here is a full turn cost, not just the attachment's
    // marginal add-on — textOnlyCents is included so the client can show
    // "+N¢" by subtracting it, or the full number, whichever reads clearer.
    textOnlyCents,
    photoCents: costFor(1, 0),
    videoCents: costFor(FRAME_COUNT, FRAME_COUNT),
    fileCents: textOnlyCents, // real text/PDF extraction adds no vision tokens — same cost as a plain message
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

// The definitive, instant "Cancel task" action (client's task banner) —
// clears shared/src/schema.ts's chatSessions.activeTask directly, no
// message/model round trip, no credit spend, so cancelling never has to
// wait on a real answer just to take effect.
const taskSchema = z.object({ activeTask: z.string().max(200).nullable() });
chatRouter.patch("/sessions/:id/task", async (req: AuthedRequest, res) => {
  const parsed = taskSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const [session] = await db
    .update(chatSessions)
    .set({ activeTask: parsed.data.activeTask })
    .where(and(eq(chatSessions.id, req.params.id), eq(chatSessions.userId, req.userId!)))
    .returning();
  if (!session) return res.status(404).json({ error: "Session not found" });
  res.json({ activeTask: session.activeTask });
});

chatRouter.get("/sessions/:id/messages", async (req: AuthedRequest, res) => {
  const rows = await db
    .select({
      id: messages.id,
      sessionId: messages.sessionId,
      role: messages.role,
      kind: messages.kind,
      content: messages.content,
      metadata: messages.metadata,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .innerJoin(chatSessions, eq(messages.sessionId, chatSessions.id))
    // hiddenAt IS NULL — a real History-screen delete (routes/history.ts)
    // hides a message from the owning user's own session view without ever
    // erasing the row; see the header comment on messages.hiddenAt.
    .where(and(eq(messages.sessionId, req.params.id), eq(chatSessions.userId, req.userId!), isNull(messages.hiddenAt)))
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

// Real "edit a sent message" — only within EDIT_WINDOW_MS of sending it, per
// spec ("1 minute time frame after that user can't make changes"). A
// successful edit invalidates the stale reply it produced and genuinely
// regenerates the answer against the new text — "AI rehearses it adjusts
// its answer on the changes user made" — rather than just rewriting history
// silently. Scoped to plain text turns (no attachment/camera-ask/who-is/
// voice-memo) since those carry extra context this simple endpoint doesn't
// rebuild.
const editSentMessageSchema = z.object({
  newText: z.string().min(1).max(4000),
  requestedFocusMode: z.enum(["quick", "build", "auto", "gorilla"]).optional(),
});
chatRouter.patch("/messages/:id/edit", async (req: AuthedRequest, res) => {
  const parsed = editSentMessageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const [row] = await db
    .select({ message: messages, sessionUserId: chatSessions.userId })
    .from(messages)
    .innerJoin(chatSessions, eq(messages.sessionId, chatSessions.id))
    .where(eq(messages.id, req.params.id));
  if (!row || row.sessionUserId !== req.userId) return res.status(404).json({ error: "Message not found" });
  const original = row.message;
  if (original.role !== "user") return res.status(400).json({ error: "not_editable", message: "Only your own sent messages can be edited." });
  if (original.kind !== "text") {
    return res.status(400).json({ error: "not_editable", message: "Only plain text messages can be edited." });
  }
  if (Date.now() - original.createdAt.getTime() > EDIT_WINDOW_MS) {
    return res.status(403).json({ error: "edit_window_expired", message: "You can only edit a message within 1 minute of sending it." });
  }

  await syncExpiredPlan(req.userId!);
  const [user] = await db.select().from(users).where(eq(users.id, req.userId!));
  if (!user) return res.status(404).json({ error: "User not found" });

  const usageCheck = await checkUsageWindow(req.userId!, user.planTier, user.timezone);
  if (!usageCheck.ok) {
    return res.status(429).json({ error: usageCheck.reason, message: usageCheck.message, resetAt: usageCheck.resetAt });
  }

  const focusMode: FocusMode = parsed.data.requestedFocusMode ?? (user.defaultFocusMode as FocusMode);
  if (!isFocusModeAllowed(user.planTier, focusMode)) {
    const required = FOCUS_MODE_DEFINITIONS[focusMode].minPlanTier;
    return res.status(403).json({
      error: "focus_mode_not_allowed",
      message: `${FOCUS_MODE_DEFINITIONS[focusMode].label} mode needs the ${required} plan or higher. Upgrade in Plans to use it.`,
    });
  }

  // A regenerated answer is a real new model call — metered the same
  // cost-aware way as any other turn (lib/costModel.ts); this endpoint
  // always resolves as plain "chat" mode, so no topic-images floor applies.
  const editPlan = PLAN_DEFINITIONS[user.planTier];
  const creditCostCents = estimateChatCreditCostCents({
    planProvider: editPlan.provider,
    model: editPlan.model,
    maxOutputTokens: resolveMaxTokens(editPlan, focusMode, { mode: "chat" }),
    kindMultiplier: 1,
  });
  const spend = await spendCredits(db, req.userId!, creditCostCents, `chat:edit:${focusMode}`);
  if (!spend.allowed) {
    return res.status(402).json({ error: "insufficient_credit", message: "You're out of credit. Top up to keep chatting." });
  }
  // Re-point the charge at the edited message itself — it's the same real
  // message row throughout an edit, just with new content, so the dispute/
  // auto-refund system should see this newest charge against it, not
  // whichever charge (if any) originally created it.
  if (spend.transactionId) await linkTransactionToMessage(db, spend.transactionId, original.id);

  const sessionId = original.sessionId;

  // The reply this edit invalidates: the very next message in the session
  // after this one, if it's the assistant's answer to this exact turn.
  // `ne(id, ...)` guards against a real Postgres/JS precision mismatch: the
  // timestamp column stores microseconds, a JS Date only holds
  // milliseconds, so `gt(createdAt, original.createdAt)` alone can
  // spuriously match `original` against its own millisecond-truncated
  // value and short-circuit this away from ever finding the real reply.
  const [nextMessage] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.sessionId, sessionId), gt(messages.createdAt, original.createdAt), ne(messages.id, original.id)))
    .orderBy(messages.createdAt)
    .limit(1);
  if (nextMessage && nextMessage.role === "assistant") {
    await db.delete(messages).where(eq(messages.id, nextMessage.id));
  }

  const [updatedUserMessage] = await db
    .update(messages)
    .set({ content: parsed.data.newText })
    .where(eq(messages.id, original.id))
    .returning();

  const priorMessages = await db
    .select()
    .from(messages)
    .where(and(eq(messages.sessionId, sessionId), lt(messages.createdAt, original.createdAt), isNull(messages.hiddenAt)))
    .orderBy(desc(messages.createdAt))
    .limit(20);
  const orderedHistory = priorMessages.reverse().map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const answerCount = resolveAnswerCount(user.answerMode as AnswerMode);
  const memoryContext = (await getMemoryContext(req.userId!)) + (await getNotionContext(req.userId!));

  let assistantMessage: typeof messages.$inferSelect;
  try {
    const result = await resolveAnswer(
      { plan: editPlan, answerCount, userMessage: parsed.data.newText, history: orderedHistory, mode: "chat", memoryContext, focusMode },
      "text",
    );

    [assistantMessage] = await db
      .insert(messages)
      .values({ sessionId, role: "assistant", kind: "text", content: result.text })
      .returning();
    await recordMessageSent(req.userId!);
    extractAndStoreMemory(req.userId!, sessionId, parsed.data.newText, result.text).catch(() => {});
  } catch (err) {
    // Same real, certain billing error as a normal send: this edit's
    // regeneration was paid for and never produced a reply.
    if (spend.transactionId) {
      await grantCredits(db, req.userId!, creditCostCents, {
        kind: "refund",
        providerReference: `auto-refund:${spend.transactionId}`,
        note: `Automatic refund — no reply was generated for edited message ${original.id}`,
      });
    }
    throw err;
  }

  res.json({
    userMessage: updatedUserMessage,
    message: assistantMessage,
    focusMode,
    creditCostCents,
    creditBalanceAfterCents: spend.balanceAfterCents,
    usedGraceOverage: spend.usedGraceOverage,
  });
});

chatRouter.patch("/answer-mode", async (req: AuthedRequest, res) => {
  const schema = z.object({ mode: z.enum(["strong", "extra", "normal"]) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  await db.update(users).set({ answerMode: parsed.data.mode }).where(eq(users.id, req.userId!));
  res.json({ answerMode: parsed.data.mode, definition: ANSWER_MODE_DEFINITIONS[parsed.data.mode] });
});
