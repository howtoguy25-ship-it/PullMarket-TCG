// Real, switchable background/accent themes (Settings -> Appearance).
// Deliberately keep card surfaces, borders, and text colors constant across
// every palette — only the background gradient and accent color change —
// so contrast against text is always guaranteed instead of needing a
// per-theme text-color override that could accidentally break legibility.

import type { ThemeId } from "@shared/schema";

export type { ThemeId };

export interface Palette {
  id: ThemeId;
  label: string;
  bg: string;
  bgElevated: string;
  bgCard: string;
  bgCardAlt: string;
  border: string;
  starDim: string;
  starBright: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentBright: string;
  accentGlow: string;
  success: string;
  warning: string;
  danger: string;
  beginner: string;
  pro: string;
  max: string;
  gradientGalaxy: readonly [string, string, string];
}

const CONSTANT = {
  bgCard: "#12102A",
  bgCardAlt: "#181433",
  border: "rgba(140, 130, 255, 0.18)",
  starDim: "rgba(255,255,255,0.35)",
  starBright: "#FFFFFF",
  textPrimary: "#F4F2FF",
  textSecondary: "#B8B3D9",
  textMuted: "#786F9E",
  success: "#5FE0A6",
  warning: "#FFC466",
  danger: "#FF6B81",
  beginner: "#6C7BFF",
  pro: "#B06CFF",
  max: "#FFB347",
};

export const PALETTES: Record<ThemeId, Palette> = {
  galaxy_violet: {
    id: "galaxy_violet",
    label: "Galaxy Violet",
    ...CONSTANT,
    bg: "#05040F",
    bgElevated: "#0B0A1F",
    accent: "#8F6CFF",
    accentBright: "#B79CFF",
    accentGlow: "rgba(143, 108, 255, 0.35)",
    gradientGalaxy: ["#05040F", "#0E0A2E", "#1B1245"],
  },
  nebula_rose: {
    id: "nebula_rose",
    label: "Nebula Rose",
    ...CONSTANT,
    bg: "#0F0508",
    bgElevated: "#1A0A10",
    accent: "#FF6FA5",
    accentBright: "#FFA0C4",
    accentGlow: "rgba(255, 111, 165, 0.35)",
    gradientGalaxy: ["#0F0508", "#210A16", "#3A1027"],
  },
  deep_ocean: {
    id: "deep_ocean",
    label: "Deep Ocean",
    ...CONSTANT,
    bg: "#040B0F",
    bgElevated: "#081820",
    accent: "#34D6C6",
    accentBright: "#7FE9DD",
    accentGlow: "rgba(52, 214, 198, 0.35)",
    gradientGalaxy: ["#040B0F", "#08202A", "#0D3547"],
  },
  solar_amber: {
    id: "solar_amber",
    label: "Solar Amber",
    ...CONSTANT,
    bg: "#0F0904",
    bgElevated: "#1C1208",
    accent: "#FFB347",
    accentBright: "#FFCC80",
    accentGlow: "rgba(255, 179, 71, 0.35)",
    gradientGalaxy: ["#0F0904", "#241708", "#3A230D"],
  },
};

export const THEME_OPTIONS: Palette[] = Object.values(PALETTES);
