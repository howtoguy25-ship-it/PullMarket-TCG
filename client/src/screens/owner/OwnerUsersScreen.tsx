import React from "react";
import { View, StyleSheet, Text, FlatList, Pressable, Platform, Alert, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { Colors, Spacing, Typography, BorderRadius } from "@/constants/theme";
import { Badge } from "@/components/ui";
import { apiJson } from "@/lib/api";

function promptText(title: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (Platform.OS === "web") {
      resolve(window.prompt(title));
    } else {
      Alert.prompt(title, undefined, [
        { text: "Cancel", style: "cancel", onPress: () => resolve(null) },
        { text: "Suspend", style: "destructive", onPress: (text?: string) => resolve(text ?? "Suspended by owner") },
      ]);
    }
  });
}

interface OwnerUser {
  id: string;
  username: string;
  email: string | null;
  phoneNumber: string | null;
  isSuspended: boolean;
  isOwner: boolean;
  createdAt: string;
}

export default function OwnerUsersScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const queryClient = useQueryClient();

  // Polls while this screen is mounted so a new signup shows up without the
  // owner having to back out and reopen the panel. The interval is cleared
  // automatically when the screen unmounts (React Query only polls while an
  // observer is active), so it doesn't run in the background.
  const {
    data: users,
    isLoading,
    isRefetching,
    refetch,
  } = useQuery<OwnerUser[]>({
    queryKey: ["/api/owner/users"],
    refetchInterval: 10_000,
  });

  const suspendMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => apiJson("POST", `/api/owner/users/${id}/suspend`, { reason }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/owner/users"] }),
  });
  const unsuspendMutation = useMutation({
    mutationFn: (id: string) => apiJson("POST", `/api/owner/users/${id}/unsuspend`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/owner/users"] }),
  });

  const handleToggleSuspend = async (u: OwnerUser) => {
    if (u.isSuspended) {
      unsuspendMutation.mutate(u.id);
      return;
    }
    const reason = await promptText(`Suspend @${u.username}? Enter a reason:`);
    if (reason) suspendMutation.mutate({ id: u.id, reason });
  };

  return (
    <View style={[styles.container, { paddingTop: headerHeight }]}>
      <FlatList
        data={users ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: Spacing.lg, paddingBottom: insets.bottom + Spacing.xl }}
        refreshControl={<RefreshControl refreshing={!isLoading && isRefetching} onRefresh={refetch} tintColor={Colors.primary} />}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <View style={styles.nameRow}>
                <Text style={styles.username}>@{item.username}</Text>
                {item.isOwner ? <Badge label="Owner" color={Colors.gold} textColor="#3A2A00" /> : null}
                {item.isSuspended ? <Badge label="Suspended" color={Colors.danger} /> : null}
              </View>
              <Text style={styles.contact}>{item.email ?? item.phoneNumber ?? "—"}</Text>
            </View>
            {!item.isOwner ? (
              <Pressable onPress={() => handleToggleSuspend(item)} style={[styles.actionButton, item.isSuspended && styles.actionButtonUnsuspend]}>
                <Feather name={item.isSuspended ? "unlock" : "lock"} size={14} color={item.isSuspended ? Colors.success : Colors.danger} />
                <Text style={[styles.actionText, { color: item.isSuspended ? Colors.success : Colors.danger }]}>{item.isSuspended ? "Unsuspend" : "Suspend"}</Text>
              </Pressable>
            ) : null}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  row: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm, borderWidth: 1, borderColor: Colors.border },
  nameRow: { flexDirection: "row", alignItems: "center", gap: Spacing.xs },
  username: { ...Typography.bodyBold, color: Colors.text },
  contact: { ...Typography.small, color: Colors.textSecondary },
  actionButton: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: Spacing.sm, paddingVertical: 6, borderRadius: BorderRadius.pill, backgroundColor: "#FCE4E4" },
  actionButtonUnsuspend: { backgroundColor: "#E3F5E9" },
  actionText: { ...Typography.small, fontWeight: "700" },
});
