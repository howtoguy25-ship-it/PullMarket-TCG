import { Platform } from "react-native";

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

// react-native-web renders a browser focus outline on TextInputs by
// default. Zeroing outlineWidth alone doesn't reliably suppress it in
// every browser — some still apply `outline-style: auto`, which is what
// draws the box — so all three properties need to be set together.
// (outline-style: none is valid, real CSS that react-native-web passes
// straight through; RN's TextStyle type just doesn't have a case for it,
// hence the cast.) No-op on native, where this concept doesn't exist.
export const NoWebFocusOutline =
  Platform.OS === "web" ? ({ outlineWidth: 0, outlineStyle: "none", outlineColor: "transparent" } as Record<string, unknown>) : {};

// Baloo 2 (rounded, playful, high-impact) carries headings, prices, and
// buttons for a game-y feel; Nunito (friendly, highly readable) carries body
// text so listing details stay easy to scan at small sizes.
export const Fonts = {
  display: "Baloo2_800ExtraBold",
  displayBold: "Baloo2_700Bold",
  body: "Nunito_400Regular",
  bodySemiBold: "Nunito_600SemiBold",
  bodyBold: "Nunito_700Bold",
};

export const Typography = {
  h1: { fontSize: 30, fontFamily: Fonts.display },
  h2: { fontSize: 23, fontFamily: Fonts.display },
  h3: { fontSize: 18, fontFamily: Fonts.displayBold },
  body: { fontSize: 15, fontFamily: Fonts.body },
  bodyBold: { fontSize: 15, fontFamily: Fonts.bodyBold },
  small: { fontSize: 13, fontFamily: Fonts.body },
  price: { fontSize: 18, fontFamily: Fonts.display },
};
