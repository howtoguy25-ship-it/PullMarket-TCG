// Neutral design tokens — flat blue-green-tinted charcoal/off-white
// surfaces, one deep teal accent, refined serif page titles over an
// Inter body/label system. Used as a same-shape fallback before
// ThemeProvider mounts (see lib/FontContext.tsx's loading screen); every
// real screen reads the live `palette` from lib/ThemeContext instead.
// See theme/palettes.ts for the Dark/Light palette definitions this mirrors.

export const colors = {
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

  accent: "#339487",
  accentBright: "#4BB8A9",
  accentGlow: "rgba(51, 148, 135, 0.16)",

  toggleTrackOff: "#2E3836",

  success: "#6FBF8A",
  warning: "#D9A25C",
  danger: "#D9705F",
  link: "#5BA8FF",
};

// An 8px-based rhythm (4 stays only as the one sub-grid half-step, for
// icon-tight gaps too small for 8 to work) — 8/16/24/32 map straight onto
// sm/lg/xl/xxl; md sits at 12 as the other real half-step, used constantly
// for card/row internal padding.
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

// 12-14px is this system's real corner-radius range: `lg` (used for every
// input, button, and primary card) sits at the top of that range; `pill`
// stays a true pill for fully-rounded chips/toggles.
export const radii = { sm: 6, md: 10, lg: 14, pill: 999 };

// Soft, low-opacity elevation — replaces any harsh/saturated drop-shadow
// with the same shadowColor/Offset/Opacity/Radius + elevation shape used
// throughout the app (see ChatScreen's composerCard for the pre-existing
// pattern this formalizes). `card` for resting surfaces, `raised` for a
// floating primary CTA.
export const shadows = {
  card: { shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.14, shadowRadius: 8, elevation: 2 },
  raised: { shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 14, elevation: 4 },
};

// Two type families, used deliberately, not interchangeably: a refined
// clean Inter sans throughout, including page/screen titles — simpler and
// more legible than an ornate serif, closer to how Claude's own interface
// actually reads. (Fraunces stays real and pickable in Appearance for
// anyone who wants a more editorial feel — just no longer forced onto
// every screen title regardless of what a user picked.) Each Google Font
// weight ships as its own family name (there is no single "Fraunces" +
// fontWeight:700), so every size here names its exact cut instead of
// pairing a base family with a numeric fontWeight — see lib/globalFont.ts's
// header comment for why that matters.
//
// The scale itself: headline 28/600 (SemiBold reads as confident without
// the heavier Bold cut's clunkiness), body 16/400 at a real 1.5 line-height,
// labels 12/500 uppercase + 0.05em tracking (== letterSpacing 0.6 at this
// size) in a muted color at each call site, buttons 16/600.
export const typography = {
  h1: { fontSize: 28, fontFamily: "Inter_600SemiBold" },
  h2: { fontSize: 20, fontFamily: "Inter_600SemiBold" },
  body: { fontSize: 16, fontFamily: "Inter_400Regular", lineHeight: 24 },
  bodyBold: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  description: { fontSize: 15, fontFamily: "Inter_400Regular" },
  caption: { fontSize: 13, fontFamily: "Inter_400Regular" },
  sectionLabel: { fontSize: 12, fontFamily: "Inter_500Medium", letterSpacing: 0.6 },
  button: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
};
