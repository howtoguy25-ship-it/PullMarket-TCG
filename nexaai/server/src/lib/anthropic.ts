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
  history: Array<{ role: "user" | "assistant"; content: string }>;
  mode: NexaPromptMode;
  /** Formatted memory-recall block from lib/memory.ts's getMemoryContext, or "" if memory/reference is off. */
  memoryContext?: string;
  focusMode: FocusMode;
  /** Real tools discovered from the user's connected MCP servers (routes/mcp.ts) — see mcpToolRunner for how a call is actually dispatched. */
  mcpTools?: Anthropic.Tool[];
  /** Dispatches one real tool_use block to whichever MCP server owns that (namespaced) tool name and returns its result as text. */
  mcpToolRunner?: (toolName: string, input: unknown) => Promise<string>;
}

export interface AskResult {
  text: string;
}

function buildSystemPrompt(params: AskParams): string {
  const base = buildNexaSystemPrompt(
    params.mode,
    params.answerCount,
    FOCUS_MODE_DEFINITIONS[params.focusMode].promptAddendum + (params.memoryContext ?? ""),
  );
  if (!params.mcpTools?.length) return base;
  return (
    base +
    "\n\nYou also have real external tools connected via the user's MCP connectors (Settings > Connectors) — " +
    "actually call one whenever it would genuinely help answer the request, rather than only describing what " +
    "you'd do with it."
  );
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

const NOT_CONFIGURED_TEXT =
  "_NexaAi's brain isn't connected yet._\n\n**Server not configured**\nSet `ANTHROPIC_API_KEY` in the server " +
  "environment to enable real answers (see nexaai/.env.example). Until then this is a placeholder response so " +
  "the rest of the app (credits, session limits, UI) can still be exercised.";

function buildMessagesRequest(params: AskParams) {
  const userContent: Anthropic.MessageParam["content"] = params.imageBase64
    ? [
        { type: "image", source: { type: "base64", media_type: params.imageBase64.mediaType, data: params.imageBase64.data } },
        { type: "text", text: params.userMessage },
      ]
    : params.userMessage;

  const focus = FOCUS_MODE_DEFINITIONS[params.focusMode];
  // Real extended-thinking budget (Anthropic's actual `thinking` param, not
  // a cosmetic setting) — the plan tier's own baseline still applies if the
  // focus mode doesn't force a bigger one (e.g. Max's extendedThinking flag
  // with no explicit budget below falls back to a sensible default).
  const budgetTokens = focus.thinkingBudgetTokens ?? (params.plan.extendedThinking ? 2000 : null);
  // The API requires max_tokens to exceed the thinking budget, since the
  // budget is drawn from the same token allowance as the visible output.
  const maxTokens = budgetTokens ? Math.max(params.plan.maxOutputTokens, budgetTokens + 1024) : params.plan.maxOutputTokens;

  return {
    model: params.plan.model,
    max_tokens: maxTokens,
    ...(budgetTokens ? { thinking: { type: "enabled" as const, budget_tokens: budgetTokens } } : {}),
    ...(params.mcpTools?.length ? { tools: params.mcpTools } : {}),
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

    if (response.stop_reason !== "tool_use" || !params.mcpToolRunner || iteration >= MAX_MCP_TOOL_ITERATIONS) {
      return { text: allText.trim() };
    }
    request.messages.push({ role: "assistant", content: response.content });
    request.messages.push({ role: "user", content: await runMcpTools(response.content, params.mcpToolRunner) });
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

    if (final.stop_reason !== "tool_use" || !params.mcpToolRunner || iteration >= MAX_MCP_TOOL_ITERATIONS) {
      return { text: allText.trim() };
    }
    request.messages.push({ role: "assistant", content: final.content });
    request.messages.push({ role: "user", content: await runMcpTools(final.content, params.mcpToolRunner) });
  }
}
