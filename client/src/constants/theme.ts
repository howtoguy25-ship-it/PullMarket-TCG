// PullMarket TCG palette — Poké Ball red + One Piece gold, high-energy but
// still readable at card-listing density.
export const Colors = {
  primary: "#E3350D", // Poké Ball red
  primaryDark: "#B8280A",
  secondary: "#1E3A8A", // straw-hat navy
  gold: "#FFCB05", // Pikachu yellow / treasure gold
  goldDark: "#E0A800",

  background: "#F7F5EF",
  surface: "#FFFFFF",
  surfaceAlt: "#FFF7E6",
  border: "#E7E1D3",

  text: "#1B1B1F",
  textSecondary: "#6B6B76",
  textMuted: "#9A9AA5",

  success: "#1E9E5A",
  warning: "#F59E0B",
  danger: "#DC2626",

  pokemon: "#3B82C4",
  onePiece: "#C0392B",

  white: "#FFFFFF",
  black: "#000000",
  overlay: "rgba(15, 12, 8, 0.6)",
};

export const Spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const BorderRadius = { sm: 8, md: 14, lg: 20, xl: 28, pill: 999 };

export const Shadow = {
  card: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
};

export const Typography = {
  h1: { fontSize: 28, fontWeight: "800" as const },
  h2: { fontSize: 22, fontWeight: "800" as const },
  h3: { fontSize: 18, fontWeight: "700" as const },
  body: { fontSize: 15, fontWeight: "400" as const },
  bodyBold: { fontSize: 15, fontWeight: "700" as const },
  small: { fontSize: 13, fontWeight: "400" as const },
  price: { fontSize: 17, fontWeight: "800" as const },
};
