import React from "react";
import { StyleSheet, View } from "react-native";
import { useTheme } from "../lib/ThemeContext";

// A flat, solid page background — deliberately not a gradient, not a
// starfield. Kept as its own small component (rather than inlining
// `backgroundColor: palette.bg` into every screen) so every screen shares
// exactly one definition of "the app background," and so screens that
// imported this under its old name don't all need touching.
export function GalaxyBackground({ children }: { children?: React.ReactNode }) {
  const { palette } = useTheme();
  return <View style={[styles.container, { backgroundColor: palette.bg }]}>{children}</View>;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
