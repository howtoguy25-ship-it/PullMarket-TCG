// Real client for your own self-hosted, fine-tuned Llama model — serves
// the Beginner tier (see lib/plans.ts). Talks to whatever OpenAI-compatible
// endpoint you deploy per finetune/RUNPOD_SETUP.md (vLLM's
// `/v1/chat/completions`), so this has no Anthropic dependency at all.
//
// Two real capability gaps vs. the Anthropic provider, both handled
// honestly rather than silently:
//   - No vision. Llama 3.1 8B Instruct is text-only. lib/modelRouter.ts
//     intercepts image attachments before they'd reach this file and
//     reroutes them to the same "can't view this" text-note path chat.ts
//     already uses for video/unsupported formats — see modelRouter.ts.
//   - No `thinking` API param (that's an Anthropic-specific feature). A
//     focus mode's thinking budget is approximated here as a larger
//     max_tokens allowance plus a "think it through before answering"
//     instruction, which is a real but weaker substitute — extended
//     thinking on Claude is a trained capability, not just more tokens.

import type { PlanDefinition, FocusMode } from "./plans";
import { FOCUS_MODE_DEFINITIONS } from "./plans";
import { buildNexaSystemPrompt, type NexaPromptMode } from "@shared/nexaPersona";
import type { AskResult } from "./anthropic";

export interface SelfHostedAskParams {
  plan: PlanDefinition;
  answerCount: number;
  userMessage: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  mode: NexaPromptMode;
  memoryContext?: string;
  focusMode: FocusMode;
}

function baseUrl(): string | null {
  return process.env.SELF_HOSTED_MODEL_BASE_URL || null;
}

export function isSelfHostedConfigured(): boolean {
  return !!baseUrl();
}

const NOT_CONFIGURED_TEXT =
  "_NexaAi's Beginner-tier brain isn't connected yet._\n\n**Self-hosted model not configured**\nSet `SELF_HOSTED_MODEL_BASE_URL` " +
  "(your vLLM endpoint) in the server environment — see nexaai/finetune/RUNPOD_SETUP.md. Falling back to the shared " +
  "Anthropic-backed answer in the meantime so Beginner-tier chat still works while you finish training/deploying.";

function buildSystemPrompt(params: SelfHostedAskParams): string {
  const focus = FOCUS_MODE_DEFINITIONS[params.focusMode];
  // No real `thinking` param here — approximate a bigger thinking budget
  // with an explicit instruction plus more room to write it out.
  const thinkingNote = focus.thinkingBudgetTokens
    ? "\n\nThink through the problem step by step internally before writing your final answer, but only output the final formatted answer — don't show your scratch reasoning."
    : "";
  return buildNexaSystemPrompt(params.mode, params.answerCount, focus.promptAddendum + thinkingNote + (params.memoryContext ?? ""));
}

function resolveMaxTokens(params: SelfHostedAskParams): number {
  const focus = FOCUS_MODE_DEFINITIONS[params.focusMode];
  return focus.thinkingBudgetTokens ? Math.max(params.plan.maxOutputTokens, Math.round(focus.thinkingBudgetTokens / 2)) : params.plan.maxOutputTokens;
}

function buildRequestBody(params: SelfHostedAskParams, stream: boolean) {
  return {
    model: process.env.SELF_HOSTED_MODEL_NAME || params.plan.model,
    max_tokens: resolveMaxTokens(params),
    temperature: 0.7,
    stream,
    messages: [
      { role: "system", content: buildSystemPrompt(params) },
      ...params.history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: params.userMessage },
    ],
  };
}

export async function askSelfHostedModel(params: SelfHostedAskParams): Promise<AskResult> {
  const url = baseUrl();
  if (!url) return { text: NOT_CONFIGURED_TEXT };

  const response = await fetch(`${url}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.SELF_HOSTED_MODEL_API_KEY ? { Authorization: `Bearer ${process.env.SELF_HOSTED_MODEL_API_KEY}` } : {}),
    },
    body: JSON.stringify(buildRequestBody(params, false)),
  });
  if (!response.ok) throw new Error(`Self-hosted model request failed: ${response.status} ${await response.text()}`);
  const json = (await response.json()) as { choices: { message: { content: string } }[] };
  return { text: json.choices[0].message.content.trim() };
}

export async function streamSelfHostedModel(params: SelfHostedAskParams, onDelta: (deltaText: string) => void): Promise<AskResult> {
  const url = baseUrl();
  if (!url) {
    onDelta(NOT_CONFIGURED_TEXT);
    return { text: NOT_CONFIGURED_TEXT };
  }

  const response = await fetch(`${url}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.SELF_HOSTED_MODEL_API_KEY ? { Authorization: `Bearer ${process.env.SELF_HOSTED_MODEL_API_KEY}` } : {}),
    },
    body: JSON.stringify(buildRequestBody(params, true)),
  });
  if (!response.ok || !response.body) throw new Error(`Self-hosted model stream failed: ${response.status} ${await response.text().catch(() => "")}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sepIndex = buffer.indexOf("\n\n");
    while (sepIndex !== -1) {
      const rawEvent = buffer.slice(0, sepIndex);
      buffer = buffer.slice(sepIndex + 2);
      const dataLine = rawEvent.split("\n").find((line) => line.startsWith("data: "));
      if (dataLine) {
        const payload = dataLine.slice("data: ".length).trim();
        if (payload === "[DONE]") {
          sepIndex = buffer.indexOf("\n\n");
          continue;
        }
        try {
          const json = JSON.parse(payload) as { choices: { delta: { content?: string } }[] };
          const delta = json.choices[0]?.delta?.content;
          if (delta) {
            full += delta;
            onDelta(delta);
          }
        } catch {
          // ignore malformed chunk, keep reading
        }
      }
      sepIndex = buffer.indexOf("\n\n");
    }
  }

  return { text: full.trim() };
}
