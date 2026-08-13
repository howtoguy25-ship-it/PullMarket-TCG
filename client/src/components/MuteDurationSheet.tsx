import { Modal, View, StyleSheet, Text, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Colors, Spacing, Typography, BorderRadius } from "@/constants/theme";

export interface MuteChoice {
  minutes?: number;
  forever?: boolean;
  clear?: boolean;
}

const OPTIONS: { label: string; icon: keyof typeof Feather.glyphMap; choice: MuteChoice }[] = [
  { label: "5 minutes", icon: "clock", choice: { minutes: 5 } },
  { label: "1 hour", icon: "clock", choice: { minutes: 60 } },
  { label: "3 hours", icon: "clock", choice: { minutes: 180 } },
  { label: "8 hours", icon: "clock", choice: { minutes: 480 } },
  { label: "12 hours", icon: "clock", choice: { minutes: 720 } },
  { label: "24 hours", icon: "clock", choice: { minutes: 1440 } },
  { label: "48 hours", icon: "clock", choice: { minutes: 2880 } },
  { label: "Always", icon: "bell-off", choice: { forever: true } },
  { label: "Never (unmute)", icon: "bell", choice: { clear: true } },
];

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (choice: MuteChoice) => void;
}

// Re-swiping and tapping Mute again always reopens this same sheet — the
// only way mute state ever changes, so "adjusting" a mute is just picking
// a new option here again, including Never to clear it.
export function MuteDurationSheet({ visible, onClose, onSelect }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={styles.card}>
          <Text style={styles.title}>Mute notifications</Text>
          {OPTIONS.map((opt) => (
            <Pressable
              key={opt.label}
              style={styles.option}
              onPress={() => {
                onSelect(opt.choice);
                onClose();
              }}
            >
              <Feather name={opt.icon} size={17} color={Colors.text} />
              <Text style={styles.optionText}>{opt.label}</Text>
            </Pressable>
          ))}
          <Pressable style={[styles.option, styles.cancel]} onPress={onClose}>
            <Text style={styles.optionText}>Cancel</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "flex-end" },
  card: { backgroundColor: Colors.surface, borderTopLeftRadius: BorderRadius.lg, borderTopRightRadius: BorderRadius.lg, width: "100%", paddingBottom: Spacing.xl, paddingTop: Spacing.sm },
  title: { ...Typography.bodyBold, color: Colors.textSecondary, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  option: { flexDirection: "row", alignItems: "center", gap: Spacing.md, paddingHorizontal: Spacing.lg, paddingVertical: 13 },
  optionText: { ...Typography.body, color: Colors.text },
  cancel: { borderTopWidth: 1, borderTopColor: Colors.border, marginTop: 4, justifyContent: "center" },
});
