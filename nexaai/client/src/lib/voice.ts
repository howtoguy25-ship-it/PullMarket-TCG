import * as Speech from "expo-speech";

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

/** Real on-device text-to-speech (expo-speech) using the selected character's voice + a pitch/rate tuned to its "tone". */
export function speak(text: string, characterId: string) {
  const character = VOICE_CHARACTERS.find((c) => c.id === characterId) ?? VOICE_CHARACTERS[0];
  const toneSettings: Record<string, { pitch: number; rate: number }> = {
    warm: { pitch: 1.0, rate: 0.98 },
    direct: { pitch: 0.95, rate: 1.05 },
    energetic: { pitch: 1.1, rate: 1.1 },
    calm: { pitch: 0.9, rate: 0.9 },
  };
  const settings = toneSettings[character.tone] ?? { pitch: 1, rate: 1 };
  Speech.stop();
  Speech.speak(text, { voice: character.ttsVoiceId, pitch: settings.pitch, rate: settings.rate });
}

export function stopSpeaking() {
  Speech.stop();
}

/**
 * Speech-to-text for voice memos/live voice chat.
 *
 * STUB NOTICE: real on-device STT needs a native module that isn't part of
 * the Expo Go sandbox — e.g. `expo-speech-recognition` (native speech
 * recognizer) — which requires a custom dev/production build (`eas build`),
 * not Expo Go, plus the microphone permission already declared in
 * app.config.js. Wire it up here once you've added that package and run a
 * native build; until then this throws instead of pretending to transcribe.
 */
export async function transcribeVoiceMemo(_audioUri: string): Promise<string> {
  throw new Error(
    "Speech-to-text isn't wired up yet — add expo-speech-recognition (or a similar native STT module), " +
      "run a native EAS build, then implement transcribeVoiceMemo().",
  );
}
