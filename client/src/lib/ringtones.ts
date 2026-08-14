// Original, in-house-synthesized ringtones (not Apple's system ringtone,
// not sampled from any Pokémon/One Piece media) — short loopable phrases
// played on the incoming-call screen. See RingtoneContext for playback.
export interface RingtoneOption {
  id: string;
  label: string;
  description: string;
  source: number;
}

export const RINGTONES: RingtoneOption[] = [
  { id: "card_flip", label: "Card Flip", description: "Bright ascending marimba arpeggio", source: require("@/assets/sounds/ringtones/card_flip.mp3") },
  { id: "pixel_call", label: "Pixel Call", description: "Energetic retro two-tone alert", source: require("@/assets/sounds/ringtones/pixel_call.mp3") },
  { id: "gentle_chime", label: "Gentle Chime", description: "Soft, calm bell tones", source: require("@/assets/sounds/ringtones/gentle_chime.mp3") },
  { id: "adventure_call", label: "Adventure Call", description: "Short brassy fanfare swell", source: require("@/assets/sounds/ringtones/adventure_call.mp3") },
];

export const DEFAULT_RINGTONE_ID = RINGTONES[0].id;

export function getRingtoneById(id: string): RingtoneOption {
  return RINGTONES.find((r) => r.id === id) ?? RINGTONES[0];
}

// Fixed (not user-selectable) — plays on the CALLER's device while an
// outgoing call is ringing on the other end, replacing InCallManager's
// "_DEFAULT_" ringback. Distinct timbre from every incoming ringtone above
// so caller and callee never hear the identical sound.
export const OUTGOING_RINGBACK_SOURCE = require("@/assets/sounds/ringtones/outgoing_ringback.mp3");
