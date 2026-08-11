// Original, in-house-synthesized ambient sound effects (not sampled from any
// Pokémon/One Piece media) — see server/src/scripts or the generation notes
// in client/src/assets/sounds for how these were made.
export interface AmbientSoundOption {
  id: string;
  label: string;
  description: string;
  source: number;
}

export const AMBIENT_SOUNDS: AmbientSoundOption[] = [
  { id: "card_shuffle", label: "Card Shuffle", description: "Riffling through a deck", source: require("@/assets/sounds/card_shuffle.wav") },
  { id: "pack_crinkle", label: "Pack Crinkle", description: "Opening a foil booster pack", source: require("@/assets/sounds/pack_crinkle.wav") },
  { id: "coin_chime", label: "Coin Chime", description: "A bright collector's chime", source: require("@/assets/sounds/coin_chime.wav") },
  { id: "page_turn", label: "Page Turn", description: "Flipping through a binder", source: require("@/assets/sounds/page_turn.wav") },
  { id: "notification_bell", label: "Notification Bell", description: "A soft two-tone bell", source: require("@/assets/sounds/notification_bell.wav") },
];

export const DEFAULT_AMBIENT_SOUND_ID = AMBIENT_SOUNDS[0].id;
