export interface HomeBackgroundOption {
  id: string;
  label: string;
  description: string;
  /** A small swatch gradient shown in the picker — the real background
   * component has its own richer, animated rendering; this is just enough
   * to preview the palette before picking. */
  swatch: [string, string];
}

export const HOME_BACKGROUNDS: HomeBackgroundOption[] = [
  { id: "galaxy", label: "Galaxy", description: "Deep space, drifting stars & nebula glow", swatch: ["#150C2E", "#6D28D9"] },
  { id: "ocean", label: "Ocean Tides", description: "Rolling waves & rising bubbles", swatch: ["#062A3E", "#0E7C9E"] },
  { id: "aurora", label: "Aurora Skies", description: "Ribbons of northern light over a starlit sky", swatch: ["#0B1230", "#16A0A0"] },
  { id: "ember", label: "Ember Glow", description: "Warm embers drifting up through the dark", swatch: ["#2B0E08", "#C2410C"] },
  { id: "forest", label: "Forest Fireflies", description: "Fireflies drifting through a night forest", swatch: ["#08210F", "#166534"] },
];

export const DEFAULT_HOME_BACKGROUND_ID = "galaxy";

export function getHomeBackgroundById(id: string): HomeBackgroundOption {
  return HOME_BACKGROUNDS.find((b) => b.id === id) ?? HOME_BACKGROUNDS[0];
}
