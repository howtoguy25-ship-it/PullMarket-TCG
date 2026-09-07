// Dark "galaxy" palette — deep space background with a starfield gradient,
// and one bright accent per plan tier (see lib/plans.ts on the server for
// the matching per-tier colors).

export const colors = {
  bg: "#05040F",
  bgElevated: "#0B0A1F",
  bgCard: "#12102A",
  bgCardAlt: "#181433",
  border: "rgba(140, 130, 255, 0.18)",
  starDim: "rgba(255,255,255,0.35)",
  starBright: "#FFFFFF",

  textPrimary: "#F4F2FF",
  textSecondary: "#B8B3D9",
  textMuted: "#786F9E",

  accent: "#8F6CFF", // primary NexaAi violet
  accentBright: "#B79CFF",
  accentGlow: "rgba(143, 108, 255, 0.35)",

  success: "#5FE0A6",
  warning: "#FFC466",
  danger: "#FF6B81",

  beginner: "#6C7BFF",
  pro: "#B06CFF",
  max: "#FFB347",

  gradientGalaxy: ["#05040F", "#0E0A2E", "#1B1245"] as const,
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const radii = { sm: 8, md: 14, lg: 20, pill: 999 };

export const typography = {
  h1: { fontSize: 28, fontWeight: "800" as const },
  h2: { fontSize: 20, fontWeight: "700" as const },
  body: { fontSize: 15, fontWeight: "400" as const },
  bodyBold: { fontSize: 15, fontWeight: "700" as const },
  caption: { fontSize: 12, fontWeight: "500" as const },
};
