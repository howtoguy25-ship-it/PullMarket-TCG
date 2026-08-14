import React from "react";
import { StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useAppTheme } from "@/contexts/AppThemeContext";

/** A decorative, non-interactive backdrop reflecting the user's chosen app
 * theme (Profile > App Background). Deliberately just a soft two-stop
 * gradient — no shapes/imagery to fight with content — so every screen
 * that renders this behind its existing white cards/sections stays exactly
 * as legible as it was on the flat cream background before this feature. */
export function AppThemeBackground() {
  const { theme } = useAppTheme();
  return <LinearGradient colors={theme.colors} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} pointerEvents="none" />;
}
