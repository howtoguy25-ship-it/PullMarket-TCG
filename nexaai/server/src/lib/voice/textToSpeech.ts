// Real text-to-speech for live voice chat replies (routes/voice.ts) — OpenAI's
// /v1/audio/speech endpoint, saved as a real mp3 file into the same uploads
// directory attachments.ts already serves at /uploads. Separate from
// client/src/lib/voice.ts's `speak()`, which is on-device expo-speech used
// for the Chat screen's "read the reply aloud" toggle — that path stays as
// is; this one is for the dedicated voice-conversation pipeline, where the
// reply audio needs to be a real file the client can fetch and play back
// (and, later, review from a past conversation's history).

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { UPLOADS_DIR } from "../../routes/attachments";

export function isTextToSpeechConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

// Maps the app's existing voice-character picker (Settings -> Appearance;
// see shared voiceCharacters table / client/src/lib/voice.ts's
// VOICE_CHARACTERS) onto OpenAI's TTS voice names, so a user's chosen
// character sounds consistent whether NexaAi is typing (on-device
// expo-speech) or talking on a live voice call (this).
const VOICE_CHARACTER_TO_OPENAI_VOICE: Record<string, string> = {
  "nova-neutral": "alloy",
  "atlas-male-direct": "onyx",
  "luna-female-energetic": "nova",
  "sol-male-calm": "echo",
};

export async function synthesizeSpeech(text: string, voiceCharacterId: string): Promise<{ url: string; filename: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Text-to-speech isn't configured — set OPENAI_API_KEY in the server environment (see nexaai/.env.example).");

  const voice = VOICE_CHARACTER_TO_OPENAI_VOICE[voiceCharacterId] || "alloy";
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_TTS_MODEL || "tts-1",
      voice,
      input: text,
      response_format: "mp3",
    }),
  });
  if (!response.ok) throw new Error(`Speech synthesis failed: ${response.status} ${await response.text()}`);

  const filename = `${crypto.randomUUID()}.mp3`;
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);
  return { url: `/uploads/${filename}`, filename };
}
