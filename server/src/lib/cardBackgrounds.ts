import path from "path";

// Repo-committed assets (not user uploads) so they survive every deploy
// regardless of the uploads dir's ephemeral disk caveat — see upload.ts.
export const BACKGROUNDS_DIR = path.resolve(process.cwd(), "server/assets/backgrounds");

// Pixel rect (in each background's own coordinate space) where the scanned
// card gets composited — same rect for all four so one crop/resize step
// works for every background. Matches the placeholder drawn into each
// backdrop image at generation time.
const CARD_RECT = { x: 230, y: 241, width: 620, height: 868 };

export interface CardBackground {
  id: string;
  label: string;
  file: string;
  cardRect: typeof CARD_RECT;
  /** Whether the composited card should get a drop shadow (skipped for the
   * framed backdrop, which already has its own frame border for depth). */
  shadow: boolean;
}

export const CARD_BACKGROUNDS: CardBackground[] = [
  { id: "grass_sky", label: "Grass & sky", file: "grass_sky.jpg", cardRect: CARD_RECT, shadow: true },
  { id: "ocean_3d", label: "Ocean", file: "ocean_3d.jpg", cardRect: CARD_RECT, shadow: true },
  { id: "desk_frame", label: "Wooden frame", file: "desk_frame.jpg", cardRect: CARD_RECT, shadow: false },
  { id: "blurred", label: "Soft blur", file: "blurred.jpg", cardRect: CARD_RECT, shadow: true },
];

export function getBackground(id: string): CardBackground | undefined {
  return CARD_BACKGROUNDS.find((b) => b.id === id);
}
