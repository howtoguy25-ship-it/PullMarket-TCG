// Neutral design system: three palettes (Original / Black / White), all
// grayscale (with a cool blue-green undertone) except for one shared teal
// accent used sparingly for active/primary states — no per-theme color
// identity, no gradients. "Original" is the app's established dark
// look (tinted a bit more visibly green per real user feedback); "Black"
// is a true-black AMOLED-style option; "White" is the existing bright
// theme. Replaces the earlier 6-theme "galaxy" picker (violet/rose/teal/
// amber + light/true-black) entirely, per product direction: one
// consistent, professional look app-wide instead of a color-theme picker.

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
  divider: string;
  starBright: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentBright: string;
  accentGlow: string;
  toggleTrackOff: string;
  success: string;
  warning: string;
  danger: string;
  // A real hyperlink blue, deliberately distinct from `accent` — links
  // (Sources, inline markdown links) read as links, not as another accent
  // button, the same way a document distinguishes "clickable text" from
  // "call to action" even when both live in the same page.
  link: string;
}

// The one shared accent — a deep teal (blue-green), used sparingly for
// active toggles, links, and primary actions. Identical in both palettes
// on purpose: "one single accent color used sparingly", not a per-theme hue.
// Slightly desaturated from the original #2A9D8F/#3FBFAE per the latest
// design pass (a premium product's accent reads as calm, not neon) — the
// hue is unchanged, only the vividness is pulled back ~15%.
const ACCENT = "#339487";
const ACCENT_BRIGHT = "#4BB8A9";

export const PALETTES: Record<ThemeId, Palette> = {
  // "Original" — back to a near-black base (real, most-recent user
  // feedback: the previous #0F211D green tint read as "flat dark green,"
  // not premium/professional). An earlier round of feedback had pushed
  // this the other way (from a near-gray #141C1D toward more visible
  // green, so it wouldn't read as "black theme in disguise") — this value
  // deliberately reverses that: nearly black with only a whisper of the
  // cool green-blue undertone, so it reads as a refined dark theme rather
  // than a colored one. The separate "Black" palette below stays a true
  // AMOLED #070A0A for anyone who wants zero undertone at all.
  dark: {
    id: "dark",
    label: "Original",
    bg: "#0E1211",
    bgElevated: "#141918",
    bgCard: "#181F1D",
    bgCardAlt: "#1E2624",
    border: "#2A3331",
    divider: "#1E2624",
    starBright: "#EFF5F4",
    textPrimary: "#ECF1EF",
    textSecondary: "#9AACAA",
    textMuted: "#788987",
    accent: ACCENT,
    accentBright: ACCENT_BRIGHT,
    accentGlow: "rgba(51, 148, 135, 0.16)",
    toggleTrackOff: "#2E3836",
    success: "#6FBF8A",
    warning: "#D9A25C",
    danger: "#D9705F",
    link: "#5BA8FF",
  },
  light: {
    id: "light",
    label: "White",
    bg: "#F4FAF9",
    bgElevated: "#EEF6F5",
    bgCard: "#FFFFFF",
    bgCardAlt: "#E7F2F1",
    border: "#D3E6E4",
    divider: "#E1EFED",
    starBright: "#15302D",
    textPrimary: "#172624",
    textSecondary: "#5C6E6D",
    textMuted: "#7E8C8B",
    accent: ACCENT,
    accentBright: "#1F7A6E",
    accentGlow: "rgba(42, 157, 143, 0.14)",
    toggleTrackOff: "#CFE2E0",
    success: "#3F8F5C",
    warning: "#B37A2E",
    danger: "#C1503F",
    link: "#1D6FE0",
  },
  // True-black, AMOLED-style — deliberately near #000 (not the same base
  // as "Original") for real battery savings on OLED screens and the
  // highest-contrast option, while keeping the same text/accent colors so
  // nothing reads as "unfinished" against it.
  black: {
    id: "black",
    label: "Black",
    bg: "#070A0A",
    bgElevated: "#0C1010",
    bgCard: "#101515",
    bgCardAlt: "#161C1C",
    border: "#262E2E",
    divider: "#161C1C",
    starBright: "#F5FAF9",
    textPrimary: "#F0F5F4",
    textSecondary: "#A6B5B4",
    textMuted: "#7E8D8C",
    accent: ACCENT,
    accentBright: ACCENT_BRIGHT,
    accentGlow: "rgba(42, 157, 143, 0.25)",
    toggleTrackOff: "#2A3434",
    success: "#6FBF8A",
    warning: "#D9A25C",
    danger: "#D9705F",
    link: "#5BA8FF",
  },
};

export const THEME_OPTIONS: Palette[] = Object.values(PALETTES);
