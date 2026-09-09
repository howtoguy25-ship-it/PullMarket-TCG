import React, { useMemo } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { radii, spacing, typography } from "../theme/colors";
import { useTheme } from "../lib/ThemeContext";
import type { Palette } from "../theme/palettes";

export type AnswerMode = "strong" | "extra" | "normal";

const OPTIONS: { mode: AnswerMode; label: string }[] = [
  { mode: "strong", label: "1 · Strong" },
  { mode: "extra", label: "2 · Extra info" },
  { mode: "normal", label: "3 · Normal" },
];

export function AnswerModeToggle({ value, onChange }: { value: AnswerMode; onChange: (m: AnswerMode) => void }) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  return (
    <View style={styles.container}>
      {OPTIONS.map((opt) => {
        const active = opt.mode === value;
        return (
          <TouchableOpacity
            key={opt.mode}
            onPress={() => onChange(opt.mode)}
            style={[styles.pill, active && { backgroundColor: palette.accent }]}
            activeOpacity={0.8}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{opt.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    container: { flexDirection: "row", backgroundColor: palette.bgCard, borderRadius: radii.pill, padding: 4, gap: 4 },
    pill: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radii.pill },
    label: { ...typography.caption, color: palette.textSecondary },
    labelActive: { color: "#fff", fontWeight: "700" },
  });
}
