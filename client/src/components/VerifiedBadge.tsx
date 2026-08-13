import React from "react";
import { View, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Colors } from "@/constants/theme";

// The green tick shown next to a username for active Pro members (see
// isActivePro in shared/validation.ts) — every place a username is
// rendered decides for itself whether to show this based on that same
// check against the user object it already has (proStatus +
// proCurrentPeriodEnd), so there's a single source of truth for "is this
// person Pro" but no central registry of where the tick appears.
export function VerifiedBadge({ size = 14 }: { size?: number }) {
  return (
    <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }]}>
      <Feather name="check" size={size * 0.65} color={Colors.white} />
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { backgroundColor: Colors.success, alignItems: "center", justifyContent: "center" },
});
