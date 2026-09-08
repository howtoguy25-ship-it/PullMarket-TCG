import * as Speech from "expo-speech";
import { API_URL, getToken, ApiError } from "./api";

export interface VoiceCharacter {
  id: string;
  displayName: string;
  gender: "female" | "male" | "neutral";
  tone: string;
  ttsVoiceId: string;
}

// Mirrors server/src/scripts/seed.ts's nexaai_voice_characters seed rows —
// fetched from GET /api/voice-characters in a real build; hardcoded here so
// the picker works even before that endpoint round-trips.
export const VOICE_CHARACTERS: VoiceCharacter[] = [
  { id: "nova-neutral", displayName: "Nova", gender: "neutral", tone: "warm", ttsVoiceId: "com.apple.voice.compact.en-US.Samantha" },
  { id: "atlas-male-direct", displayName: "Atlas", gender: "male", tone: "direct", ttsVoiceId: "com.apple.voice.compact.en-US.Alex" },
  { id: "luna-female-energetic", displayName: "Luna", gender: "female", tone: "energetic", ttsVoiceId: "com.apple.voice.compact.en-US.Samantha" },
  { id: "sol-male-calm", displayName: "Sol", gender: "male", tone: "calm", ttsVoiceId: "com.apple.voice.compact.en-US.Fred" },
];

export interface SpeakCallbacks {
  onStart?: () => void;
  onDone?: () => void;
  onStopped?: () => void;
  onError?: () => void;
}

/**
 * Real on-device text-to-speech (expo-speech) using the selected character's
 * voice + a pitch/rate tuned to its "tone". `onStart`/`onDone` are expo-speech's
 * own real playback-lifecycle callbacks — wire the bot avatar's "talking"
 * animation to them so the mouth only moves while audio is actually playing.
 */
export function speak(text: string, characterId: string, callbacks: SpeakCallbacks = {}) {
  const character = VOICE_CHARACTERS.find((c) => c.id === characterId) ?? VOICE_CHARACTERS[0];
  const toneSettings: Record<string, { pitch: number; rate: number }> = {
    warm: { pitch: 1.0, rate: 0.98 },
    direct: { pitch: 0.95, rate: 1.05 },
    energetic: { pitch: 1.1, rate: 1.1 },
    calm: { pitch: 0.9, rate: 0.9 },
  };
  const settings = toneSettings[character.tone] ?? { pitch: 1, rate: 1 };
  Speech.stop();
  Speech.speak(text, {
    voice: character.ttsVoiceId,
    pitch: settings.pitch,
    rate: settings.rate,
    onStart: callbacks.onStart,
    onDone: callbacks.onDone,
    onStopped: callbacks.onStopped,
    onError: callbacks.onError,
  });
}

export function stopSpeaking() {
  Speech.stop();
}

/**
 * Real speech-to-text for voice memos, via the server's Whisper-backed
 * /api/voice/transcribe endpoint (see server/src/lib/voice/speechToText.ts).
 * This sidesteps the on-device-STT gap entirely — no native module or EAS
 * build needed, since transcription happens server-side. Throws with the
 * server's own honest message if OPENAI_API_KEY isn't configured there.
 */
export async function transcribeVoiceMemo(audioUri: string): Promise<string> {
  const token = await getToken();
  const form = new FormData();
  form.append("audio", { uri: audioUri, name: "memo.m4a", type: "audio/m4a" } as unknown as Blob);

  const response = await fetch(`${API_URL}/api/voice/transcribe`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await response.json() : null;
  if (!response.ok) throw new ApiError(response.status, body);
  return (body as { transcript: string }).transcript;
}
