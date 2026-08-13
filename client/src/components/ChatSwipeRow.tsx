import { useRef } from "react";
import { View, StyleSheet, Text, Pressable } from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { Feather } from "@expo/vector-icons";
import { Colors, Spacing, Typography } from "@/constants/theme";

interface Props {
  children: React.ReactNode;
  muted: boolean;
  // true on the Archived screen — flips the left-swipe action from
  // "Archive" to "Unarchive" (same gesture, opposite direction of travel).
  archived?: boolean;
  onPressDelete: () => void;
  onPressMute: () => void;
  onArchive: () => void;
}

// Swipe left reveals Mute + Delete (tap to trigger — these are explicit
// choices, not gestures, since mute needs a duration picker and delete is
// destructive). Swipe right reveals Archive/Unarchive, which fires
// automatically the moment it's dragged past Swipeable's own default open
// threshold (half the row's width) and released — exactly the "pull past
// halfway and let go" behavior asked for, with zero extra gesture math
// needed: releasing before the threshold is Swipeable's own built-in
// snap-back-and-cancel, so pulling back left before letting go already
// does nothing, for free.
export function ChatSwipeRow({ children, muted, archived, onPressDelete, onPressMute, onArchive }: Props) {
  const ref = useRef<Swipeable>(null);

  return (
    <Swipeable
      ref={ref}
      overshootLeft={false}
      overshootRight={false}
      renderRightActions={() => (
        <View style={styles.rightActions}>
          <Pressable
            style={[styles.actionButton, styles.muteButton]}
            onPress={() => {
              ref.current?.close();
              onPressMute();
            }}
          >
            <Feather name={muted ? "bell-off" : "bell"} size={20} color={Colors.white} />
            <Text style={styles.actionText}>Mute</Text>
          </Pressable>
          <Pressable
            style={[styles.actionButton, styles.deleteButton]}
            onPress={() => {
              ref.current?.close();
              onPressDelete();
            }}
          >
            <Feather name="trash-2" size={20} color={Colors.white} />
            <Text style={styles.actionText}>Delete</Text>
          </Pressable>
        </View>
      )}
      renderLeftActions={() => (
        <View style={styles.leftActions}>
          <Feather name="archive" size={22} color={Colors.white} />
          <Text style={styles.actionText}>{archived ? "Unarchive" : "Archive"}</Text>
        </View>
      )}
      onSwipeableOpen={(direction) => {
        if (direction === "left") {
          ref.current?.close();
          onArchive();
        }
      }}
    >
      {children}
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  rightActions: { flexDirection: "row" },
  actionButton: { width: 76, alignItems: "center", justifyContent: "center", gap: 4 },
  muteButton: { backgroundColor: Colors.goldDark },
  deleteButton: { backgroundColor: Colors.danger },
  leftActions: { flex: 1, backgroundColor: Colors.secondary, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: Spacing.sm },
  actionText: { ...Typography.small, color: Colors.white, fontWeight: "700", fontSize: 11 },
});
