// Real Gemini client for the "speed lane" — per the user's explicit
// decision, Gemini stays scoped to fast/voice/multimodal work rather than
// becoming a second selectable chat provider alongside Claude. Its one real
// job right now: answer the reasoning step of live voice chat (routes/voice.ts)
// fast, since a phone call shouldn't wait on the same budget a written chat
// answer gets.
//
// Uses Google's own OpenAI-compatible endpoint
// (https://ai.google.dev/gemini-api/docs/openai) instead of the Gemini SDK,
// so this reuses the exact same request/response shape as
// lib/selfHostedModel.ts rather than a bespoke client.

import { buildNexaSystemPrompt, type NexaPromptMode } from "@shared/nexaPersona";
import type { AskResult } from "./anthropic";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";

export function isGeminiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

export interface GeminiAskParams {
  userMessage: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  mode: NexaPromptMode;
  maxOutputTokens?: number;
}

const NOT_CONFIGURED_TEXT =
  "I can't answer that yet — the app owner hasn't connected the fast voice model. Set GEMINI_API_KEY in the server environment.";

export async function askGemini(params: GeminiAskParams): Promise<AskResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { text: NOT_CONFIGURED_TEXT };

  const response = await fetch(`${GEMINI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      max_tokens: params.maxOutputTokens ?? 400,
      temperature: 0.7,
      messages: [
        { role: "system", content: buildNexaSystemPrompt(params.mode, 1) },
        ...params.history.map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: params.userMessage },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Gemini request failed: ${response.status} ${await response.text()}`);

  const json = (await response.json()) as { choices: { message: { content: string } }[] };
  return { text: json.choices[0].message.content.trim() };
}
