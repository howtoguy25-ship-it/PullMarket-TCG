import React from "react";
import { View, StyleSheet, ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { StarField } from "./StarField";

/** A compact dark galaxy-gradient banner with scattered stars — the same
 * visual language as the Welcome screen's full GalaxyBackground, scaled
 * down as a header accent rather than a full-screen backdrop, so the rest
 * of a light-themed screen (listing grids, menu rows) stays readable. */
export function GalaxyHeader({
  children,
  style,
  starCount = 22,
  variant = "banner",
  colors = ["#150C2E", "#1C1040", "#2A1750"],
}: {
  children?: React.ReactNode;
  style?: ViewStyle;
  starCount?: number;
  /** "banner": full-bleed, rounded only on the bottom corners (a page's top
   * edge). "card": rounded on all corners, for use inset within a padded
   * layout instead of edge-to-edge. */
  variant?: "banner" | "card";
  /** Override the default dark-purple galaxy gradient — e.g. a warmer
   * gold-tinted variant to mark a Pro member's own profile header. */
  colors?: [string, string, ...string[]];
}) {
  return (
    <View style={[styles.container, variant === "card" ? styles.card : styles.banner, style]}>
      <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <StarField count={starCount} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: "100%", overflow: "hidden" },
  banner: { borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  card: { borderRadius: 20 },
});
