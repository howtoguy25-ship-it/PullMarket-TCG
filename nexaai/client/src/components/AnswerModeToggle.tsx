import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { colors, radii, spacing, typography } from "../theme/colors";

export type AnswerMode = "strong" | "extra" | "normal";

const OPTIONS: { mode: AnswerMode; label: string }[] = [
  { mode: "strong", label: "1 · Strong" },
  { mode: "extra", label: "2 · Extra info" },
  { mode: "normal", label: "3 · Normal" },
];

export function AnswerModeToggle({ value, onChange }: { value: AnswerMode; onChange: (m: AnswerMode) => void }) {
  return (
    <View style={styles.container}>
      {OPTIONS.map((opt) => {
        const active = opt.mode === value;
        return (
          <TouchableOpacity
            key={opt.mode}
            onPress={() => onChange(opt.mode)}
            style={[styles.pill, active && styles.pillActive]}
            activeOpacity={0.8}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{opt.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: "row", backgroundColor: colors.bgCard, borderRadius: radii.pill, padding: 4, gap: 4 },
  pill: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radii.pill },
  pillActive: { backgroundColor: colors.accent },
  label: { ...typography.caption, color: colors.textSecondary },
  labelActive: { color: "#fff", fontWeight: "700" },
});
