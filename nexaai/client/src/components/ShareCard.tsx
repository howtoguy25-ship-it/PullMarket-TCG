import React, { forwardRef, useMemo } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { radii, spacing, typography } from "../theme/colors";
import { useTheme } from "../lib/ThemeContext";
import type { Palette } from "../theme/palettes";

export interface ShareCardProps {
  role: "user" | "assistant";
  text: string;
}

const CARD_WIDTH = 560;
// Keeps the branded card readable at a glance — a full long answer belongs
// in the real app, not squeezed into a share-sheet thumbnail.
const MAX_CHARS = 700;

/**
 * Off-screen branded "quote card" — NexaAi's real logo + wordmark, plus the
 * shared text — captured to a real PNG (react-native-view-shot) and shared
 * as an image so the logo genuinely appears in the OS share sheet's
 * preview/thumbnail, not just plain unbranded text. See MessageBubble's
 * ShareButton for how this gets captured and shared.
 */
export const ShareCard = forwardRef<View, ShareCardProps>(function ShareCard({ role, text }, ref) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const trimmed = text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS).trimEnd()}…` : text;

  return (
    <View ref={ref} collapsable={false} style={styles.card}>
      <View style={styles.brandRow}>
        <Image source={require("../../../assets/icon-transparent.png")} style={styles.logo} resizeMode="contain" />
        <Text style={styles.brand}>NexaAi</Text>
      </View>
      <Text style={styles.kicker}>{role === "user" ? "Asked NexaAi" : "NexaAi answered"}</Text>
      <Text style={styles.body}>{trimmed}</Text>
    </View>
  );
});

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    card: {
      width: CARD_WIDTH,
      backgroundColor: palette.bgCard,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      padding: spacing.xl,
      gap: spacing.md,
    },
    brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    logo: { width: 36, height: 36 },
    brand: { ...typography.h2, color: palette.textPrimary },
    kicker: { ...typography.sectionLabel, color: palette.accentBright, textTransform: "uppercase" },
    body: { ...typography.body, color: palette.textPrimary, lineHeight: 24 },
  });
}
