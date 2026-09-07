import React, { useEffect, useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radii, spacing, typography } from "../theme/colors";
import { useTheme } from "../lib/ThemeContext";
import { api } from "../lib/api";

export type FocusMode = "quick" | "build" | "auto" | "gorilla";
export type PlanTier = "beginner" | "pro" | "max";

interface FocusModeDefinition {
  mode: FocusMode;
  label: string;
  tagline: string;
  minPlanTier: PlanTier;
  creditMultiplier: number;
}

const TIER_RANK: Record<PlanTier, number> = { beginner: 0, pro: 1, max: 2 };

interface FocusModeSelectorProps {
  value: FocusMode;
  onChange: (mode: FocusMode) => void;
  planTier: PlanTier;
  onNavigateToPlans?: () => void;
}

export function FocusModeSelector({ value, onChange, planTier, onNavigateToPlans }: FocusModeSelectorProps) {
  const { palette } = useTheme();
  const [modes, setModes] = useState<FocusModeDefinition[]>([]);

  useEffect(() => {
    api<{ focusModes: FocusModeDefinition[] }>("/api/plans/focus-modes").then((r) => setModes(r.focusModes));
  }, []);

  const isAllowed = (mode: FocusModeDefinition) => TIER_RANK[planTier] >= TIER_RANK[mode.minPlanTier];

  const press = (mode: FocusModeDefinition) => {
    if (isAllowed(mode)) {
      onChange(mode.mode);
      return;
    }
    Alert.alert(
      `${mode.label} needs ${mode.minPlanTier[0].toUpperCase()}${mode.minPlanTier.slice(1)}`,
      `${mode.tagline}. Upgrade your plan to unlock it — it costs ${mode.creditMultiplier}x the usual credits per message.`,
      [
        { text: "Not now", style: "cancel" },
        { text: "See plans", onPress: onNavigateToPlans },
      ],
    );
  };

  return (
    <View style={styles.container}>
      {modes.map((mode) => {
        const active = mode.mode === value;
        const allowed = isAllowed(mode);
        return (
          <TouchableOpacity
            key={mode.mode}
            onPress={() => press(mode)}
            style={[styles.pill, active && allowed && { backgroundColor: palette.accent }, !allowed && styles.pillLocked]}
            activeOpacity={0.8}
          >
            {!allowed && <Ionicons name="lock-closed" size={11} color={colors.textMuted} style={styles.lockIcon} />}
            <Text style={[styles.label, active && allowed && styles.labelActive, !allowed && styles.labelLocked]}>{mode.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: "row", backgroundColor: colors.bgCard, borderRadius: radii.pill, padding: 4, gap: 4 },
  pill: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radii.pill, gap: 4 },
  pillLocked: { opacity: 0.6 },
  lockIcon: { marginRight: 2 },
  label: { ...typography.caption, color: colors.textSecondary },
  labelActive: { color: "#fff", fontWeight: "700" },
  labelLocked: { color: colors.textMuted },
});
