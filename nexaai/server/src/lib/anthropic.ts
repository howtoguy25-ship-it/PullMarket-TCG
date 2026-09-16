import Anthropic from "@anthropic-ai/sdk";
import type { PlanDefinition, FocusMode } from "./plans";
import { FOCUS_MODE_DEFINITIONS } from "./plans";
import { buildNexaSystemPrompt, buildHumorAddendum, type NexaPromptMode } from "@shared/nexaPersona";
import type { VideoFrame } from "./videoFrames";
import type { ReasoningEffortCap } from "./ownerSettings";

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

export function isChatConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

const FRAME_DESCRIBE_MODEL = "claude-haiku-4-5-20251001"; // same cheap/fast model lib/memory.ts uses — never the user's own plan-tier model for this

/**
 * One real vision call per sampled video still, narrating what's actually
 * in THIS frame specifically — this is what powers the live frame-by-frame
 * breakdown in routes/chat.ts's streaming endpoint (see "videoFrame"/
 * "videoFrameDescription" SSE events). Deliberately a separate cheap-model
 * call per frame rather than asking the main answer call to describe each
 * one, so the breakdown can stream in frame-by-frame before the final
 * answer even starts, at a real, bounded cost per frame.
 */
export async function describeVideoFrame(frame: VideoFrame): Promise<string> {
  const anthropic = getClient();
  if (!anthropic) return "Frame captured.";
  try {
    const response = await anthropic.messages.create({
      model: FRAME_DESCRIBE_MODEL,
      max_tokens: 60,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: frame.mediaType, data: frame.data } },
            {
              type: "text",
              text:
                "In one short sentence (under 18 words), plainly say what this specific video still shows and what " +
                "stands out — as if narrating what you're focusing on while reviewing a video frame by frame. No preamble, no \"this frame shows\".",
            },
          ],
        },
      ],
    });
    const text = response.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    return text || "Frame captured.";
  } catch {
    return "Couldn't analyze this frame.";
  }
}

const NOT_CONFIGURED_SUPPORT_TEXT =
  "_NexaAi's support agents aren't connected yet._\n\nSet `ANTHROPIC_API_KEY` in the server environment — in the meantime, " +
  "email support@asknexaai.com and a real person will help.";

/**
 * Real support-agent reply (server/src/lib/supportPersonas.ts's personas) —
 * a genuine Claude call with that persona's own system prompt, on the fast
 * Haiku model rather than the user's paid-tier model, since Help & Support
 * is a free feature and doesn't need Opus/Sonnet-level depth to answer
 * "how do refunds work" accurately.
 */
export async function askSupportAgent(systemPrompt: string, history: Array<{ role: "user" | "assistant"; content: string }>): Promise<string> {
  const anthropic = getClient();
  if (!anthropic) return NOT_CONFIGURED_SUPPORT_TEXT;
  const response = await anthropic.messages.create({
    model: FRAME_DESCRIBE_MODEL,
    max_tokens: 700,
    system: systemPrompt,
    messages: history.map((m) => ({ role: m.role, content: m.content })),
  });
  const text = response.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
  return text || "I couldn't put together a reply to that — try rephrasing, or email support@asknexaai.com.";
}

export interface AskParams {
  plan: PlanDefinition;
  answerCount: number;
  userMessage: string;
  imageBase64?: { data: string; mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" };
  /** Real stills sampled from an attached video (lib/videoFrames.ts) — sent as additional real vision content alongside imageBase64, never both from the same attachment. */
  extraImages?: Array<{ data: string; mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" }>;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  mode: NexaPromptMode;
  /** Formatted memory-recall block from lib/memory.ts's getMemoryContext, or "" if memory/reference is off. */
  memoryContext?: string;
  focusMode: FocusMode;
  /** Real tools discovered from the user's connected MCP servers (routes/mcp.ts) — see mcpToolRunner for how a call is actually dispatched. */
  mcpTools?: Anthropic.Tool[];
  /** Dispatches one real tool_use block to whichever MCP server owns that (namespaced) tool name and returns its result as text. */
  mcpToolRunner?: (toolName: string, input: unknown) => Promise<string>;
  /**
   * Real Anthropic web_search tool (the same one lib/whoIsSearch.ts uses),
   * gated by the user's "Real images for topics" capability toggle. Unlike
   * mcpTools, this is a server-executed tool — Anthropic runs the search
   * itself and returns via `stop_reason: "pause_turn"`, not a client-side
   * tool_use round trip, so it needs its own continuation branch below.
   */
  enableTopicImages?: boolean;
  /** Real cancellation — wired from the streaming route's own AbortController, which fires when the client taps "stop" or disconnects. Not used by the non-streaming route (no stop control there). */
  signal?: AbortSignal;
  /** Real, app-wide reasoning-effort ceiling from the owner panel — see resolveEffectiveThinkingBudget. Undefined/null/"max" = uncapped. */
  reasoningEffortCap?: ReasoningEffortCap | null;
}

export interface AskResult {
  text: string;
  /** True when `signal` fired before the model finished — `text` is whatever was generated up to that point, not a full answer. */
  stopped?: boolean;
  /** Set when this turn was a real image_generation request — see routes/chat.ts's resolveAnswer(). */
  generatedImage?: { url: string; prompt: string };
}

// The "Real images for topics" capability's addendum — deliberately mirrors
// lib/whoIsSearch.ts / WHO_IS_FORMAT's own image-honesty rule: only a real
// URL an actual web_search result returned, never a guessed or invented one,
// and only when a photo would genuinely help (skip it for code, math, or
// abstract advice where an image adds nothing).
const TOPIC_IMAGES_ADDENDUM =
  "\n\nYou also have real live web search available for this reply, specifically to find real photos. The user " +
  "has this turned on because they want to actually SEE things, not just read about them. So: whenever the " +
  "question is about a concrete real-world topic, place, thing, animal, landmark, or event (basically anything " +
  "with a real visual appearance) — actually call web_search right now to find 1-2 real photos of it, don't just " +
  "consider whether to. Only skip the search for things that plainly have no visual appearance to show (abstract " +
  "advice, code, math, a private person). Embed the best 1-2 results as their own lines using ![alt text](URL) " +
  "markdown, placed right after the part of your answer they illustrate. Use ONLY a real image URL an actual " +
  "search result returned — never invent, guess, or reconstruct a URL. If the search genuinely turns up nothing " +
  "relevant, no need to mention that — just continue without an image line. Always put the image markdown on its " +
  "own line, with a blank line before and after it — never glue it onto the end of another sentence.\n\n" +
  "Whenever you actually call web_search for this reply (for photos or for the answer itself), end your ENTIRE " +
  "reply with a real **Sources** section — the same shape the who-is lookup uses — listing every page you " +
  "actually drew on, so the user can open real links for more detail:\n\n**Sources**\n1. Title — URL\n2. Title — URL\n\n" +
  "Only cite a URL an actual search result returned — never invent, guess, or reconstruct one. Skip the whole " +
  "section entirely if you didn't call web_search this turn.";

// Real automatic language detection + reply-in-kind — no separate detector
// library, no hardcoded language list: the model itself reads which
// language the user is actually writing in and matches it, then adds a
// genuine English translation underneath so an English-only reader (or a
// support/owner reviewing the transcript) can still follow along. Skipped
// for who_is/build_project for the same reason humor is below — both are
// strict, app-parsed output shapes, and an inserted translation block
// would break that parsing rather than just read oddly.
// who_is/build_project are the strict, app-parsed output shapes the
// language addendum (and humor) must stay out of — shared so
// buildMessagesRequest's token floor below and buildSystemPrompt's addendum
// choice can't drift out of sync with each other.
function appliesLanguageAddendum(mode: AskParams["mode"]): boolean {
  return mode !== "who_is" && mode !== "build_project";
}

const LANGUAGE_ADDENDUM =
  "\n\nLANGUAGE: Detect the language the user actually wrote their latest message in, and reply primarily in " +
  "that same language — match them, don't default to English just because the app itself is in English. If " +
  "their language is not English, add a complete, genuine English translation of your ENTIRE reply immediately " +
  "after it, separated by its own '---' line, then a line reading exactly '**English translation:**', then that " +
  "translation. If they wrote in English, skip the translation section entirely — never add an empty or redundant one.";

function buildSystemPrompt(params: AskParams): string {
  const base = buildNexaSystemPrompt(
    params.mode,
    params.answerCount,
    FOCUS_MODE_DEFINITIONS[params.focusMode].promptAddendum + (params.memoryContext ?? ""),
  );
  const mcpAddendum = params.mcpTools?.length
    ? "\n\nYou also have real external tools connected via the user's MCP connectors (Settings > Connectors) — " +
      "actually call one whenever it would genuinely help answer the request, rather than only describing what " +
      "you'd do with it."
    : "";
  const imagesAddendum = params.enableTopicImages ? TOPIC_IMAGES_ADDENDUM : "";
  // Skip humor mode for who_is/build_project — both are strict, app-parsed
  // output shapes (the profile-card renderer and the file-block extractor),
  // and a joke response would break that parsing rather than just read oddly.
  const allowLanguageAddendum = appliesLanguageAddendum(params.mode);
  const humorAddendum = allowLanguageAddendum ? buildHumorAddendum(params.plan.strengthMultiplier) : "";
  const languageAddendum = allowLanguageAddendum ? LANGUAGE_ADDENDUM : "";
  return base + mcpAddendum + imagesAddendum + humorAddendum + languageAddendum;
}

// Bounds the real tool-use loop below the same way lib/whoIsSearch.ts bounds
// its own pause_turn loop — a tool could misbehave and keep asking to be
// called again; this guarantees the turn still finishes.
const MAX_MCP_TOOL_ITERATIONS = 5;

/** Runs every tool_use block in a response through mcpToolRunner and returns the matching tool_result content blocks. */
async function runMcpTools(
  content: Anthropic.ContentBlock[],
  runner: (toolName: string, input: unknown) => Promise<string>,
): Promise<Anthropic.ToolResultBlockParam[]> {
  const toolUses = content.filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
  return Promise.all(
    toolUses.map(async (block) => {
      try {
        const result = await runner(block.name, block.input);
        return { type: "tool_result" as const, tool_use_id: block.id, content: result };
      } catch (err) {
        return {
          type: "tool_result" as const,
          tool_use_id: block.id,
          content: err instanceof Error ? err.message : "That tool call failed.",
          is_error: true,
        };
      }
    }),
  );
}

function joinTextBlocks(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((b) => b.text)
    .join("");
}

// Deliberately NOT anchored to a whole line: the model doesn't always put
// `![alt](url)` on its own line (it can land glued right after a preceding
// sentence with no newline), so matching anywhere catches those too —
// matching the client's own equally lenient extraction in MessageBubble.tsx.
const IMAGE_MARKDOWN = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g;

// web_search's citation URLs are page results, not guaranteed direct image
// files — the model sometimes embeds a search-result page URL (e.g. a
// tourism site's guide page) instead of an actual hotlinkable photo. Rather
// than trust that blindly and risk a broken image box in the chat, actually
// fetch each one and only keep it if it genuinely serves image bytes.
async function isRealImageUrl(url: string): Promise<boolean> {
  for (const method of ["HEAD", "GET"] as const) {
    try {
      const res = await fetch(url, { method, signal: AbortSignal.timeout(4000) });
      await res.body?.cancel().catch(() => {});
      if (res.status === 405) continue; // some hosts don't support HEAD — retry with GET
      return res.ok && (res.headers.get("content-type") ?? "").startsWith("image/");
    } catch {
      continue;
    }
  }
  return false;
}

/** Drops any `![alt](url)` whose URL doesn't actually serve a real image, so the chat never shows a broken photo box. */
async function stripBrokenImages(text: string): Promise<string> {
  const matches = [...text.matchAll(IMAGE_MARKDOWN)];
  if (!matches.length) return text;
  const isReal = await Promise.all(matches.map((m) => isRealImageUrl(m[1])));
  let cleaned = text;
  matches.forEach((m, i) => {
    if (!isReal[i]) cleaned = cleaned.replace(m[0], "");
  });
  return cleaned.replace(/\n{3,}/g, "\n\n").trim();
}

const NOT_CONFIGURED_TEXT =
  "_NexaAi's brain isn't connected yet._\n\n**Server not configured**\nSet `ANTHROPIC_API_KEY` in the server " +
  "environment to enable real answers (see nexaai/.env.example). Until then this is a placeholder response so " +
  "the rest of the app (credits, session limits, UI) can still be exercised.";

// Maps our existing token-shaped thinking budgets (lib/plans.ts's
// FocusModeDefinition.thinkingBudgetTokens) onto the Claude 5 family's
// effort levels, since the old budget_tokens knob no longer applies.
function resolveThinkingEffort(budgetTokens: number): "low" | "medium" | "high" | "xhigh" | "max" {
  if (budgetTokens >= 16000) return "max"; // Gorilla
  if (budgetTokens >= 8000) return "xhigh"; // Auto
  if (budgetTokens >= 4000) return "high"; // Build
  if (budgetTokens >= 2000) return "medium"; // Max tier's own baseline (2000) with no focus-mode override
  return "low"; // Pro tier's own baseline (1200) — real thinking, deliberately lighter than Max's
}

// The owner panel's real, app-wide reasoning ceiling (see
// server/src/lib/ownerSettings.ts / shared/src/schema.ts's
// reasoningEffortCapEnum) — each level is a real token-budget ceiling, not
// a label: it clamps the exact same `budgetTokens` number that drives both
// the Claude 5 family's `effort` string and the legacy `thinking.
// budget_tokens` param below, so both code paths respect the same cap.
// "max" (or no cap set) is uncapped — today's plan/focus-mode defaults
// apply exactly as before.
const REASONING_CAP_CEILING: Record<Exclude<ReasoningEffortCap, "max">, number> = {
  low: 1999, // forces "low" effort even for Max tier's own "medium" baseline
  standard: 3999, // caps at "medium" — Build/Auto/Gorilla's own higher budgets get pulled down
  high: 7999, // caps at "high" — only Auto/Gorilla's boost above that is clamped
};

/**
 * The one real budgetTokens resolution both resolveMaxTokens and
 * buildMessagesRequest use — a focus mode's own forced budget, or the
 * plan's own baseline, clamped down (never up) by the owner panel's
 * reasoning-effort cap if one is set.
 */
function resolveEffectiveThinkingBudget(plan: PlanDefinition, focusMode: FocusMode, cap?: ReasoningEffortCap | null): number | null {
  const focus = FOCUS_MODE_DEFINITIONS[focusMode];
  const raw = focus.thinkingBudgetTokens ?? plan.defaultThinkingBudgetTokens;
  if (raw === null || !cap || cap === "max") return raw;
  return Math.min(raw, REASONING_CAP_CEILING[cap]);
}

function buildUserContent(params: AskParams): Anthropic.MessageParam["content"] {
  const images = [...(params.imageBase64 ? [params.imageBase64] : []), ...(params.extraImages ?? [])];
  if (!images.length) return params.userMessage;
  return [
    ...images.map((img): Anthropic.ImageBlockParam => ({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } })),
    { type: "text", text: params.userMessage },
  ];
}

/**
 * The real `max_tokens` ceiling sent to Claude for a given plan/focus-mode/
 * message shape — this is also the true worst-case output-token bound a
 * single turn can bill for, so lib/costModel.ts imports this exact function
 * to price credits off the same number the API call itself is bounded by,
 * rather than a separately-maintained (and driftable) estimate.
 */
export function resolveMaxTokens(
  plan: PlanDefinition,
  focusMode: FocusMode,
  opts: { mode: AskParams["mode"]; enableTopicImages?: boolean; reasoningEffortCap?: ReasoningEffortCap | null },
): number {
  // Real extended-thinking budget (Anthropic's actual `thinking` param, not
  // a cosmetic setting) — the plan tier's own baseline still applies if the
  // focus mode doesn't force a bigger one (e.g. Max's extendedThinking flag
  // with no explicit budget below falls back to a sensible default), and
  // the owner panel's reasoning-effort cap (if any) clamps it further.
  const budgetTokens = resolveEffectiveThinkingBudget(plan, focusMode, opts.reasoningEffortCap);
  // The API requires max_tokens to exceed the thinking budget, since the
  // budget is drawn from the same token allowance as the visible output.
  // A real web_search call plus its result plus the answer text plus the
  // embedded image markdown genuinely needs more room than a plan's base
  // output cap (e.g. the beginner tier's 1024) — without this floor the
  // model hits max_tokens mid-answer and the reply (and the image) gets cut off.
  const imagesFloorTokens = opts.enableTopicImages ? 3000 : 0;
  // A non-English reply that also carries the LANGUAGE_ADDENDUM's full
  // English translation underneath is genuinely ~2x the length of a plain
  // reply — live-verified: without this floor, a "Normal" 3-answer reply
  // plus its translation hit the plan's own maxOutputTokens and got cut off
  // mid-sentence.
  const translationFloorTokens = appliesLanguageAddendum(opts.mode) ? 2200 : 0;
  return Math.max(plan.maxOutputTokens, budgetTokens ? budgetTokens + 1024 : 0, imagesFloorTokens, translationFloorTokens);
}

function buildMessagesRequest(params: AskParams) {
  const userContent = buildUserContent(params);

  const budgetTokens = resolveEffectiveThinkingBudget(params.plan, params.focusMode, params.reasoningEffortCap);
  const maxTokens = resolveMaxTokens(params.plan, params.focusMode, {
    mode: params.mode,
    enableTopicImages: params.enableTopicImages,
    reasoningEffortCap: params.reasoningEffortCap,
  });
  // The Claude 5 family dropped thinking.type "enabled" + budget_tokens —
  // live-verified 400: `"thinking.type.enabled" is not supported for this
  // model. Use "thinking.type.adaptive" and "output_config.effort"`. Map
  // our token-shaped budget onto the new effort levels instead.
  //
  // The Beginner-tier Anthropic fallback (FALLBACK_ANTHROPIC_MODEL in
  // modelRouter.ts, used when self-hosted isn't configured) answers on
  // claude-haiku-4-5-20251001 — an older-generation model that's the
  // mirror image: live-verified 400 `"adaptive thinking is not supported
  // on this model"`. It still takes the old thinking.type "enabled" +
  // budget_tokens shape, so branch on the model actually answering.
  const isClaude5Family = params.plan.model === "claude-sonnet-5" || params.plan.model === "claude-opus-5";
  const effort = budgetTokens && isClaude5Family ? resolveThinkingEffort(budgetTokens) : null;
  const legacyThinkingBudget = budgetTokens && !isClaude5Family ? budgetTokens : null;

  const tools: Anthropic.Tool[] = [
    ...(params.mcpTools ?? []),
    ...(params.enableTopicImages
      ? [{ type: "web_search_20260209", name: "web_search", max_uses: 3, allowed_callers: ["direct"] } as unknown as Anthropic.Tool]
      : []),
  ];

  return {
    model: params.plan.model,
    max_tokens: maxTokens,
    ...(effort ? { thinking: { type: "adaptive" as const }, output_config: { effort } } : {}),
    ...(legacyThinkingBudget ? { thinking: { type: "enabled" as const, budget_tokens: legacyThinkingBudget } } : {}),
    ...(tools.length ? { tools } : {}),
    system: buildSystemPrompt(params),
    messages: [
      ...params.history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: userContent },
    ] as Anthropic.MessageParam[],
  };
}

export async function askNexaAi(params: AskParams): Promise<AskResult> {
  const anthropic = getClient();
  if (!anthropic) return { text: NOT_CONFIGURED_TEXT };

  const request = buildMessagesRequest(params);
  let allText = "";
  for (let iteration = 0; ; iteration++) {
    const response = await anthropic.messages.create(request);
    const text = joinTextBlocks(response.content);
    allText += allText && text ? `\n\n${text}` : text;

    // A server-executed tool (web_search) paused the turn to run itself —
    // no client-side tool_result needed, just push the assistant content
    // back and let it resume (same pattern lib/whoIsSearch.ts uses).
    if (response.stop_reason === "pause_turn" && iteration < MAX_MCP_TOOL_ITERATIONS) {
      request.messages.push({ role: "assistant", content: response.content });
      continue;
    }
    if (response.stop_reason === "tool_use" && params.mcpToolRunner && iteration < MAX_MCP_TOOL_ITERATIONS) {
      request.messages.push({ role: "assistant", content: response.content });
      request.messages.push({ role: "user", content: await runMcpTools(response.content, params.mcpToolRunner) });
      continue;
    }
    const finalText = allText.trim();
    return { text: params.enableTopicImages ? await stripBrokenImages(finalText) : finalText };
  }
}

/**
 * Real token-by-token streaming (Anthropic's actual streaming API, not a
 * simulated typing effect) — `onDelta` fires for each text chunk as the
 * model generates it, so the app can render NexaAi "typing" live instead of
 * waiting for the full answer.
 */
export async function streamNexaAi(params: AskParams, onDelta: (deltaText: string) => void): Promise<AskResult> {
  const anthropic = getClient();
  if (!anthropic) {
    onDelta(NOT_CONFIGURED_TEXT);
    return { text: NOT_CONFIGURED_TEXT };
  }

  const request = buildMessagesRequest(params);
  let allText = "";
  for (let iteration = 0; ; iteration++) {
    if (params.signal?.aborted) return { text: allText.trim(), stopped: true };
    const stream = anthropic.messages.stream(request, { signal: params.signal });
    // Tracked separately from `allText` (which is only filled in from
    // `final.content` once the SDK's own finalMessage() resolves) so a real
    // stop mid-stream still keeps whatever text the user actually saw.
    let streamedThisTurn = "";
    stream.on("text", (delta) => {
      streamedThisTurn += delta;
      onDelta(delta);
    });

    let final: Awaited<ReturnType<typeof stream.finalMessage>>;
    try {
      final = await stream.finalMessage();
    } catch (err) {
      if (params.signal?.aborted) {
        const stoppedText = (allText && streamedThisTurn ? `${allText}\n\n${streamedThisTurn}` : allText || streamedThisTurn).trim();
        return { text: stoppedText, stopped: true };
      }
      throw err;
    }
    const text = joinTextBlocks(final.content);
    allText += allText && text ? `\n\n${text}` : text;

    if (final.stop_reason === "pause_turn" && iteration < MAX_MCP_TOOL_ITERATIONS) {
      request.messages.push({ role: "assistant", content: final.content });
      continue;
    }
    if (final.stop_reason === "tool_use" && params.mcpToolRunner && iteration < MAX_MCP_TOOL_ITERATIONS) {
      request.messages.push({ role: "assistant", content: final.content });
      request.messages.push({ role: "user", content: await runMcpTools(final.content, params.mcpToolRunner) });
      continue;
    }
    const finalText = allText.trim();
    return { text: params.enableTopicImages ? await stripBrokenImages(finalText) : finalText };
  }
}
