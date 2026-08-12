import React from "react";
import { View, StyleSheet, Text, ScrollView, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Colors, Spacing, Typography } from "@/constants/theme";
import { EmptyState } from "@/components/ui";
import { Avatar } from "@/components/Avatar";
import { RootStackParamList } from "@/navigation/types";
import { apiJson, apiRequest } from "@/lib/api";

type Nav = NativeStackNavigationProp<RootStackParamList>;

interface PersonSummary {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

interface FriendRequestRow {
  id: string;
  requesterId: string;
  recipientId: string;
  status: string;
  createdAt: string;
  requester: PersonSummary | null;
  recipient: PersonSummary | null;
}

export default function FriendRequestsScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<{ incoming: FriendRequestRow[]; outgoing: FriendRequestRow[] }>({ queryKey: ["/api/friends/requests"] });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/friends/requests"] });

  const acceptMutation = useMutation({ mutationFn: (id: string) => apiJson("POST", `/api/friends/${id}/accept`), onSuccess: invalidate });
  const declineMutation = useMutation({ mutationFn: (id: string) => apiJson("POST", `/api/friends/${id}/decline`), onSuccess: invalidate });
  const cancelMutation = useMutation({ mutationFn: (userId: string) => apiRequest("DELETE", `/api/friends/${userId}`), onSuccess: invalidate });

  const incoming = data?.incoming ?? [];
  const outgoing = data?.outgoing ?? [];

  return (
    <View style={[styles.container, { paddingTop: headerHeight + Spacing.md, paddingBottom: insets.bottom }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: Spacing.xl }}>
        <Text style={styles.sectionTitle}>Incoming · {incoming.length}</Text>
            {incoming.length === 0 ? (
              <Text style={styles.emptyRowText}>No pending requests</Text>
            ) : (
              incoming.map((req) => (
                <View key={req.id} style={styles.row}>
                  <Pressable style={styles.rowInfo} onPress={() => req.requester && navigation.navigate("UserProfile", { userId: req.requester.id })}>
                    <Avatar avatarUrl={req.requester?.avatarUrl} seed={req.requester?.username ?? req.id} size={44} />
                    <Text style={styles.username}>@{req.requester?.username ?? "Unknown"}</Text>
                  </Pressable>
                  <View style={styles.actions}>
                    <Pressable onPress={() => declineMutation.mutate(req.id)} style={[styles.actionButton, styles.declineButton]} hitSlop={6}>
                      <Feather name="x" size={16} color={Colors.white} />
                    </Pressable>
                    <Pressable onPress={() => acceptMutation.mutate(req.id)} style={[styles.actionButton, styles.acceptButton]} hitSlop={6}>
                      <Feather name="check" size={16} color={Colors.white} />
                    </Pressable>
                  </View>
                </View>
              ))
            )}

            <Text style={styles.sectionTitle}>Sent · {outgoing.length}</Text>
            {outgoing.length === 0 ? (
              <Text style={styles.emptyRowText}>No sent requests</Text>
            ) : (
              outgoing.map((req) => (
                <View key={req.id} style={styles.row}>
                  <Pressable style={styles.rowInfo} onPress={() => req.recipient && navigation.navigate("UserProfile", { userId: req.recipient.id })}>
                    <Avatar avatarUrl={req.recipient?.avatarUrl} seed={req.recipient?.username ?? req.id} size={44} />
                    <Text style={styles.username}>@{req.recipient?.username ?? "Unknown"}</Text>
                  </Pressable>
                  <Pressable onPress={() => req.recipient && cancelMutation.mutate(req.recipient.id)} style={styles.cancelButton}>
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </Pressable>
                </View>
              ))
            )}

        {!isLoading && incoming.length === 0 && outgoing.length === 0 ? (
          <EmptyState icon={<Feather name="users" size={40} color={Colors.textMuted} />} title="No friend requests" subtitle="Search for people to send a friend request" />
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  sectionTitle: { ...Typography.small, color: Colors.textSecondary, fontWeight: "700", paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.xs, letterSpacing: 0.3 },
  emptyRowText: { ...Typography.small, color: Colors.textMuted, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  rowInfo: { flex: 1, flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  username: { ...Typography.bodyBold, color: Colors.text, fontSize: 15 },
  actions: { flexDirection: "row", gap: Spacing.xs },
  actionButton: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  acceptButton: { backgroundColor: Colors.success },
  declineButton: { backgroundColor: Colors.danger },
  cancelButton: { paddingHorizontal: Spacing.md, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: Colors.border },
  cancelButtonText: { ...Typography.small, color: Colors.textSecondary, fontWeight: "700" },
});
