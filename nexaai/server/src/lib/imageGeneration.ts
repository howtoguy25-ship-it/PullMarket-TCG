// Real AI image generation — OpenAI's gpt-image-2 /v1/images/generations
// endpoint (confirmed working against this account's own real API key;
// gpt-image-1 and gpt-image-1.5 are both scheduled for retirement in the
// months ahead, so this deliberately targets the current model), saved as
// a real png file into the same uploads directory attachments.ts and
// lib/voice/textToSpeech.ts already serve at /uploads.

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { UPLOADS_DIR } from "../routes/attachments";
import type { ImageQuality } from "./costModel";

export function isImageGenerationConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

export interface GeneratedImage {
  url: string;
  filename: string;
}

export async function generateImage(prompt: string, quality: ImageQuality, signal?: AbortSignal): Promise<GeneratedImage> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Image generation isn't configured — set OPENAI_API_KEY in the server environment (see nexaai/.env.example).");

  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-image-2", prompt, size: "1024x1024", quality, n: 1 }),
    signal,
  });
  if (!response.ok) throw new Error(`Image generation failed: ${response.status} ${await response.text()}`);

  const data: { data?: Array<{ b64_json?: string }> } = await response.json();
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error("Image generation returned no image data.");

  const filename = `${crypto.randomUUID()}.png`;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), Buffer.from(b64, "base64"));
  return { url: `/uploads/${filename}`, filename };
}
