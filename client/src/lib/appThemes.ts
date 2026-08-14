export interface AppThemeOption {
  id: string;
  label: string;
  description: string;
  /** A soft two-stop gradient, always light enough that the app's existing
   * dark text/icon colors stay fully legible without any per-screen change —
   * these intentionally sit within a hair of the app's original cream
   * background in lightness, just shifted in hue, so nothing anywhere reads
   * as "too bright" or fights with content sitting on top of it. */
  colors: [string, string];
}

export const APP_THEMES: AppThemeOption[] = [
  { id: "classic_cream", label: "Classic Cream", description: "The original PullMarket look", colors: ["#FBF9F4", "#F3EEE2"] },
  { id: "soft_sky", label: "Soft Sky", description: "Cool, calm pale blue", colors: ["#F2F7FC", "#E8EFF9"] },
  { id: "warm_blush", label: "Warm Blush", description: "A gentle echo of Poké red", colors: ["#FDF2EE", "#FBE8E3"] },
  { id: "cool_mint", label: "Cool Mint", description: "Fresh, quiet green-gray", colors: ["#EFF9F5", "#E6F2EC"] },
  { id: "golden_sand", label: "Golden Sand", description: "A soft take on treasure gold", colors: ["#FDF8EC", "#F9EFD6"] },
];

export const DEFAULT_APP_THEME_ID = "classic_cream";

export function getAppThemeById(id: string): AppThemeOption {
  return APP_THEMES.find((t) => t.id === id) ?? APP_THEMES[0];
}
