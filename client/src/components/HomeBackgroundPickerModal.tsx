import React from "react";
import { View, StyleSheet, Text, Modal, Pressable } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import { Colors, Spacing, Typography, BorderRadius } from "@/constants/theme";
import { HOME_BACKGROUNDS } from "@/lib/homeBackgrounds";
import { useHomeBackground } from "@/contexts/HomeBackgroundContext";

/** Lets a user pick which of the 5 built-in animated backdrops shows behind
 * the homepage marketplace feed — same idea as the "App Background" picker
 * in Settings, but for Home's dark animated scenes instead of the light
 * pastel gradients used elsewhere. */
export function HomeBackgroundPickerModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { backgroundId, selectBackground } = useHomeBackground();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation?.()}>
          <View style={styles.header}>
            <Text style={styles.title}>Homepage Background</Text>
            <Pressable onPress={onClose} hitSlop={10} style={styles.closeButton} testID="home-bg-close">
              <Feather name="x" size={20} color={Colors.text} />
            </Pressable>
          </View>
          <Text style={styles.hint}>Pick the animated scene behind the marketplace feed.</Text>

          <View style={styles.list}>
            {HOME_BACKGROUNDS.map((bg) => {
              const active = bg.id === backgroundId;
              return (
                <Pressable key={bg.id} testID={`home-bg-option-${bg.id}`} onPress={() => selectBackground(bg.id)} style={[styles.row, active && styles.rowActive]}>
                  <LinearGradient colors={bg.swatch} style={styles.swatch} />
                  <View style={styles.rowText}>
                    <Text style={styles.rowLabel}>{bg.label}</Text>
                    <Text style={styles.rowDescription}>{bg.description}</Text>
                  </View>
                  {active ? <Feather name="check-circle" size={20} color={Colors.primary} /> : null}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: Colors.surface, borderTopLeftRadius: BorderRadius.xl, borderTopRightRadius: BorderRadius.xl, paddingBottom: Spacing.xl, paddingTop: Spacing.md, paddingHorizontal: Spacing.lg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { ...Typography.bodyBold, color: Colors.text, fontSize: 17 },
  closeButton: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: Colors.surfaceAlt },
  hint: { ...Typography.small, color: Colors.textSecondary, marginTop: 4, marginBottom: Spacing.md },
  list: { gap: Spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.lg,
    borderWidth: 1.5,
    borderColor: Colors.border,
    padding: Spacing.md,
  },
  rowActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + "0D" },
  swatch: { width: 40, height: 40, borderRadius: 12 },
  rowText: { flex: 1 },
  rowLabel: { ...Typography.bodyBold, color: Colors.text },
  rowDescription: { ...Typography.small, color: Colors.textMuted, marginTop: 2 },
});
