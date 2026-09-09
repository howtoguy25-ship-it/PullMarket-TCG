import Anthropic from "@anthropic-ai/sdk";
import type { PlanDefinition, FocusMode } from "./plans";
import { FOCUS_MODE_DEFINITIONS } from "./plans";
import { buildNexaSystemPrompt, type NexaPromptMode } from "@shared/nexaPersona";

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

export function isChatConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
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
}

export interface AskResult {
  text: string;
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
  "own line, with a blank line before and after it — never glue it onto the end of another sentence.";

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
  return base + mcpAddendum + imagesAddendum;
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

function buildUserContent(params: AskParams): Anthropic.MessageParam["content"] {
  const images = [...(params.imageBase64 ? [params.imageBase64] : []), ...(params.extraImages ?? [])];
  if (!images.length) return params.userMessage;
  return [
    ...images.map((img): Anthropic.ImageBlockParam => ({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } })),
    { type: "text", text: params.userMessage },
  ];
}

function buildMessagesRequest(params: AskParams) {
  const userContent = buildUserContent(params);

  const focus = FOCUS_MODE_DEFINITIONS[params.focusMode];
  // Real extended-thinking budget (Anthropic's actual `thinking` param, not
  // a cosmetic setting) — the plan tier's own baseline still applies if the
  // focus mode doesn't force a bigger one (e.g. Max's extendedThinking flag
  // with no explicit budget below falls back to a sensible default).
  const budgetTokens = focus.thinkingBudgetTokens ?? (params.plan.extendedThinking ? 2000 : null);
  // The API requires max_tokens to exceed the thinking budget, since the
  // budget is drawn from the same token allowance as the visible output.
  // A real web_search call plus its result plus the answer text plus the
  // embedded image markdown genuinely needs more room than a plan's base
  // output cap (e.g. the beginner tier's 1024) — without this floor the
  // model hits max_tokens mid-answer and the reply (and the image) gets cut off.
  const imagesFloorTokens = params.enableTopicImages ? 3000 : 0;
  const maxTokens = Math.max(params.plan.maxOutputTokens, budgetTokens ? budgetTokens + 1024 : 0, imagesFloorTokens);

  const tools: Anthropic.Tool[] = [
    ...(params.mcpTools ?? []),
    ...(params.enableTopicImages
      ? [{ type: "web_search_20260209", name: "web_search", max_uses: 3, allowed_callers: ["direct"] } as unknown as Anthropic.Tool]
      : []),
  ];

  return {
    model: params.plan.model,
    max_tokens: maxTokens,
    ...(budgetTokens ? { thinking: { type: "enabled" as const, budget_tokens: budgetTokens } } : {}),
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
    const stream = anthropic.messages.stream(request);
    stream.on("text", onDelta);
    const final = await stream.finalMessage();
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
