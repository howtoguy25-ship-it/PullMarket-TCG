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
}

export interface AskResult {
  text: string;
}

function buildSystemPrompt(params: AskParams): string {
  return buildNexaSystemPrompt(
    params.mode,
    params.answerCount,
    FOCUS_MODE_DEFINITIONS[params.focusMode].promptAddendum + (params.memoryContext ?? ""),
  );
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
    system: buildSystemPrompt(params),
    messages: [
      ...params.history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: userContent },
    ],
  };
}

export async function askNexaAi(params: AskParams): Promise<AskResult> {
  const anthropic = getClient();
  if (!anthropic) return { text: NOT_CONFIGURED_TEXT };

  const response = await anthropic.messages.create(buildMessagesRequest(params));
  const text = response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();

  return { text };
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

  const stream = anthropic.messages.stream(buildMessagesRequest(params));
  stream.on("text", (delta) => onDelta(delta));
  const final = await stream.finalMessage();
  const text = final.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();

  return { text };
}
