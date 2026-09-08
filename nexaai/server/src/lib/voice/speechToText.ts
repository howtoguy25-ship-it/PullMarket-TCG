// Real speech-to-text for both the live voice chat pipeline (routes/voice.ts)
// and the Chat screen's older "record a memo, transcribe it, edit before
// sending" flow (client/src/lib/voice.ts's transcribeVoiceMemo — this is
// what makes that actually work instead of throwing). Uses OpenAI's Whisper
// API rather than an on-device model: real on-device STT needs a native
// module (expo-speech-recognition) that requires an EAS build, not Expo Go —
// this sidesteps that entirely by transcribing server-side.
//
// HONEST LIMIT: OpenAI's transcription endpoint caps uploads at 25MB, which
// is plenty for a spoken turn (a few minutes of compressed audio) but not
// for an arbitrarily long recording — a very long voice memo will fail with
// a clear error rather than being silently truncated.

import fs from "fs";

export function isSpeechToTextConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

export async function transcribeAudio(filePath: string, mimeType: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Speech-to-text isn't configured — set OPENAI_API_KEY in the server environment (see nexaai/.env.example).");
  }

  const buffer = fs.readFileSync(filePath);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buffer)], { type: mimeType || "audio/m4a" }), "audio");
  form.append("model", process.env.OPENAI_STT_MODEL || "whisper-1");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!response.ok) throw new Error(`Transcription failed: ${response.status} ${await response.text()}`);

  const json = (await response.json()) as { text: string };
  return json.text.trim();
}
