import React from "react";
import { View, StyleSheet, Text, ScrollView, Image, Pressable, Platform, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { Colors, Spacing, Typography, BorderRadius } from "@/constants/theme";
import { EmptyState } from "@/components/ui";
import { apiJson, apiRequest } from "@/lib/api";
import { resolveImageUrl } from "@/lib/media";

interface BlockedUser {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  blockedAt: string;
}

function confirmAsync(title: string, message: string, confirmLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (Platform.OS === "web") {
      resolve(window.confirm(`${title}\n${message}`));
    } else {
      Alert.alert(title, message, [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: confirmLabel, onPress: () => resolve(true) },
      ]);
    }
  });
}

export default function BlockedUsersScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const queryClient = useQueryClient();

  const { data: blocked, isLoading } = useQuery<BlockedUser[]>({ queryKey: ["/api/blocks"] });

  const unblockMutation = useMutation({
    mutationFn: (userId: string) => apiRequest("DELETE", `/api/blocks/${userId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/blocks"] }),
  });

  const handleUnblock = async (user: BlockedUser) => {
    const ok = await confirmAsync("Unblock user", `Unblock @${user.username}? They'll be able to message and friend-request you again.`, "Unblock");
    if (ok) unblockMutation.mutate(user.id);
  };

  const blockedUsers = blocked ?? [];

  return (
    <ScrollView style={[styles.container, { paddingTop: headerHeight }]} contentContainerStyle={{ paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: insets.bottom + Spacing.xxl, flexGrow: 1 }}>
      {blockedUsers.length > 0 ? (
        <>
          <Text style={styles.sectionHeader}>Blocked</Text>
          <View style={styles.section}>
            {blockedUsers.map((item, i) => (
              <View key={item.id} style={[styles.row, i > 0 && styles.rowDivider]}>
                {item.avatarUrl ? (
                  <Image source={{ uri: resolveImageUrl(item.avatarUrl) }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarPlaceholder]}>
                    <Feather name="user" size={18} color={Colors.textMuted} />
                  </View>
                )}
                <Text style={styles.username}>@{item.username}</Text>
                <Pressable onPress={() => void handleUnblock(item)} style={styles.unblockButton} disabled={unblockMutation.isPending}>
                  <Text style={styles.unblockButtonText}>Unblock</Text>
                </Pressable>
              </View>
            ))}
          </View>
        </>
      ) : !isLoading ? (
        <EmptyState icon={<Feather name="user-x" size={36} color={Colors.textMuted} />} title="No blocked users" subtitle="People you block won't be able to message or friend-request you." />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  sectionHeader: { ...Typography.small, color: Colors.textSecondary, fontWeight: "700", marginBottom: Spacing.xs, letterSpacing: 0.5 },
  section: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.surfaceAlt },
  avatarPlaceholder: { alignItems: "center", justifyContent: "center" },
  username: { ...Typography.body, color: Colors.text, flex: 1 },
  unblockButton: { paddingHorizontal: Spacing.md, paddingVertical: 8, borderRadius: BorderRadius.pill, borderWidth: 1, borderColor: Colors.danger },
  unblockButtonText: { ...Typography.small, color: Colors.danger, fontWeight: "700" },
});
