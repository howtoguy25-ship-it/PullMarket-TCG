// Real "who is" deep-dive lookup — Anthropic's actual server-side web_search
// tool, not guesswork from training data. Deliberately scoped to public
// figures only (see shared/src/nexaPersona.ts's WHO_IS_FORMAT): this is a
// "look up a notable person" feature, not a general people-search tool, and
// the prompt explicitly refuses to search for a private individual rather
// than doing it. It also never guesses a social handle and never attempts
// to identify someone via photos/facial features — see that file's header
// comment for the full reasoning.
//
// Always calls Anthropic directly, regardless of plan tier's usual provider:
// web search is real tool-use, and the self-hosted Llama model
// (lib/selfHostedModel.ts) is a plain OpenAI-compatible chat endpoint with
// no tool-calling capability at all, so there's no self-hosted path for
// this feature to fall back to.

import Anthropic from "@anthropic-ai/sdk";
import type { PlanDefinition } from "./plans";
import { FALLBACK_ANTHROPIC_MODEL } from "./modelRouter";
import { buildNexaSystemPrompt } from "@shared/nexaPersona";
import type { AskResult } from "./anthropic";

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

export function isWhoIsSearchConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export interface WhoIsSearchParams {
  plan: PlanDefinition;
  userMessage: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  memoryContext?: string;
}

const NOT_CONFIGURED_TEXT =
  "_NexaAi's who-is deep-dive isn't connected yet._\n\n**Server not configured**\nSet `ANTHROPIC_API_KEY` — this " +
  "feature always calls Anthropic's real web-search tool directly, regardless of plan tier, since the self-hosted " +
  "Llama model has no tool-use/web-search capability at all.";

// Guards against an unbounded pause_turn loop on a long-running search —
// see the tool docs: a server-tool turn can pause partway through and needs
// the paused assistant turn pushed back to resume, same shape as any manual
// tool-use loop.
const MAX_SEARCH_ITERATIONS = 6;

export async function deepWhoIsLookup(params: WhoIsSearchParams): Promise<AskResult> {
  const anthropic = getClient();
  if (!anthropic) return { text: NOT_CONFIGURED_TEXT };

  const model = params.plan.provider === "anthropic" ? params.plan.model : FALLBACK_ANTHROPIC_MODEL;
  const system = buildNexaSystemPrompt("who_is", 1, params.memoryContext ?? "");
  const messages: Anthropic.MessageParam[] = [
    ...params.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: params.userMessage },
  ];

  const request = () =>
    anthropic.messages.create({
      model,
      max_tokens: 4096,
      system,
      messages,
      // allowed_callers is required by some models (e.g. the Haiku fallback)
      // that don't support programmatic tool calling — we only ever want
      // the model to call this directly anyway, never from code execution.
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5, allowed_callers: ["direct"] }],
    });

  let response = await request();
  let iterations = 0;
  while (response.stop_reason === "pause_turn" && iterations < MAX_SEARCH_ITERATIONS) {
    messages.push({ role: "assistant", content: response.content });
    response = await request();
    iterations++;
  }

  const text = response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();

  return { text };
}
