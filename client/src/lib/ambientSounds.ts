// Original, in-house-synthesized ambient background music loops (not sampled
// from any Pokémon/One Piece media) — each is a 40-50s seamless instrumental
// loop, not a one-shot sound effect repeated back-to-back.
export interface AmbientSoundOption {
  id: string;
  label: string;
  description: string;
  source: number;
}

export const AMBIENT_SOUNDS: AmbientSoundOption[] = [
  { id: "pokecenter_lofi", label: "Poké Center Lo-Fi", description: "Warm chill pad with a soft chime melody", source: require("@/assets/sounds/pokecenter_lofi.mp3") },
  { id: "grandline_voyage", label: "Grand Line Voyage", description: "Adventurous swells with rolling sea texture", source: require("@/assets/sounds/grandline_voyage.mp3") },
  { id: "cardshop_ambience", label: "Card Shop Ambience", description: "Cozy pad with sparse collector's bells", source: require("@/assets/sounds/cardshop_ambience.mp3") },
];

export const DEFAULT_AMBIENT_SOUND_ID = AMBIENT_SOUNDS[0].id;
