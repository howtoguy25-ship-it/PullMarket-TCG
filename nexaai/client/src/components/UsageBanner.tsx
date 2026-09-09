import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { radii, spacing, typography } from "../theme/colors";
import { useTheme } from "../lib/ThemeContext";
import type { Palette } from "../theme/palettes";

interface UsageBannerProps {
  message: string;
  resetAtIso: string;
}

/** Claude-style limit banner: shows the reset time, always including Sydney (AEST/AEDT) time. */
export function UsageBanner({ message, resetAtIso }: UsageBannerProps) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const resetAt = new Date(resetAtIso);
  const sydneyTime = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).format(resetAt);
  const localTime = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).format(resetAt);

  return (
    <View style={styles.banner}>
      <Text style={styles.message}>{message}</Text>
      <Text style={styles.subtext}>
        Resets {sydneyTime}{localTime !== sydneyTime ? ` · ${localTime} your time` : ""}
      </Text>
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
    },
    message: { ...typography.bodyBold, color: palette.textPrimary },
    subtext: { ...typography.caption, color: palette.textMuted, marginTop: 4 },
  });
}
