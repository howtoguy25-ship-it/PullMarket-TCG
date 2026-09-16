import React, { useMemo } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { radii, spacing, typography } from "../theme/colors";
import { useTheme } from "../lib/ThemeContext";
import type { Palette } from "../theme/palettes";

interface UsageBannerProps {
  message: string;
  /** Real, server-computed reset instant for a rolling-window message limit (middleware/usage.ts) — null for insufficient_credit, which has no natural reset time at all (see onBuyCreditsPress). */
  resetAtIso: string | null;
  /** Present only for the insufficient_credit case — running out of credit never resets on its own, so this renders a real "Buy credits" action instead of a fake timer. */
  onBuyCreditsPress?: () => void;
}

/** "Sep 13, " if the reset lands on a different calendar day than right now (in the viewer's own timezone), otherwise "" — matches how a real rate-limit banner only shows a date when it's not implicitly "today". */
function dateLabelIfNotToday(resetAt: Date, now: Date): string {
  const sameDay = resetAt.getFullYear() === now.getFullYear() && resetAt.getMonth() === now.getMonth() && resetAt.getDate() === now.getDate();
  if (sameDay) return "";
  return `${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(resetAt)}, `;
}

/** Claude-style limit banner: a rolling window's real reset time, in the viewer's own local time — with the date included whenever the reset isn't simply "later today". */
export function UsageBanner({ message, resetAtIso, onBuyCreditsPress }: UsageBannerProps) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);

  const resetAt = resetAtIso ? new Date(resetAtIso) : null;
  const localTime = resetAt
    ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short" }).format(resetAt)
    : "";
  const dateLabel = resetAt ? dateLabelIfNotToday(resetAt, new Date()) : "";

  return (
    <View style={styles.banner}>
      <View style={styles.headerRow}>
        <Ionicons name="alert-circle" size={16} color={palette.warning} />
        <Text style={styles.message}>{message}</Text>
      </View>
      {resetAt ? (
        <Text style={styles.subtext}>
          Resets {dateLabel}
          {localTime}
        </Text>
      ) : (
        onBuyCreditsPress && (
          <TouchableOpacity style={styles.buyButton} onPress={onBuyCreditsPress}>
            <Text style={styles.buyButtonText}>Buy credits</Text>
          </TouchableOpacity>
        )
      )}
    </View>
  );
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    banner: {
      backgroundColor: palette.bgCardAlt,
      borderColor: palette.warning,
      borderWidth: 1,
      borderRadius: radii.md,
      padding: spacing.md,
      margin: spacing.md,
      gap: 8,
    },
    headerRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
    message: { ...typography.bodyBold, color: palette.textPrimary, flex: 1 },
    subtext: { ...typography.caption, color: palette.textMuted },
    buyButton: {
      backgroundColor: palette.accent,
      borderRadius: radii.pill,
      paddingVertical: 8,
      alignItems: "center",
      alignSelf: "flex-start",
      paddingHorizontal: 16,
    },
    buyButtonText: { ...typography.caption, color: "#fff", fontWeight: "700" },
  });
}
