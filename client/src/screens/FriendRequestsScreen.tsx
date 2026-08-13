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
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { RootStackParamList } from "@/navigation/types";
import { apiJson, apiRequest } from "@/lib/api";
import { isActivePro } from "@shared/validation";

type Nav = NativeStackNavigationProp<RootStackParamList>;

interface PersonSummary {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  proStatus: string;
  proCurrentPeriodEnd: string | null;
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

  // Live, matching the same ~4s cadence chat screens poll at — this list
  // previously only ever refetched on remount/manual invalidation, so a
  // request accepted via a different path (e.g. the auto-accept when the
  // other person requests you back) could sit stale here indefinitely.
  const { data, isLoading } = useQuery<{ incoming: FriendRequestRow[]; outgoing: FriendRequestRow[] }>({ queryKey: ["/api/friends/requests"], refetchInterval: 4000 });

  // A friendship can also be read/derived from a user's own profile or the
  // search screen's status pill — invalidate those too so accepting or
  // cancelling here doesn't leave those screens showing an outdated status.
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/friends/requests"] });
    queryClient.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0].startsWith("/api/users/") || q.queryKey[0].startsWith("/api/friends/status/")) });
  };

  const acceptMutation = useMutation({ mutationFn: (id: string) => apiJson("POST", `/api/friends/${id}/accept`), onSuccess: invalidate });
  const declineMutation = useMutation({ mutationFn: (id: string) => apiJson("POST", `/api/friends/${id}/decline`), onSuccess: invalidate });
  const cancelMutation = useMutation({ mutationFn: (userId: string) => apiRequest("DELETE", `/api/friends/${userId}`), onSuccess: invalidate });

  const incoming = data?.incoming ?? [];
  const outgoing = data?.outgoing ?? [];

  return (
    <View style={[styles.container, { paddingTop: headerHeight + Spacing.md, paddingBottom: insets.bottom }]}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xl }}>
        <View style={[styles.sectionCard, styles.incomingCard]}>
          <View style={styles.sectionHeaderRow}>
            <View style={[styles.sectionIcon, { backgroundColor: Colors.primary }]}>
              <Feather name="user-plus" size={15} color={Colors.white} />
            </View>
            <Text style={styles.sectionTitle}>Incoming</Text>
            <View style={styles.countPill}>
              <Text style={styles.countPillText}>{incoming.length}</Text>
            </View>
          </View>
          {incoming.length === 0 ? (
            <Text style={styles.emptyRowText}>No pending requests</Text>
          ) : (
            incoming.map((req, i) => (
              <View key={req.id} style={[styles.row, i > 0 && styles.rowDivider]}>
                <Pressable style={styles.rowInfo} onPress={() => req.requester && navigation.navigate("UserProfile", { userId: req.requester.id })}>
                  <Avatar avatarUrl={req.requester?.avatarUrl} seed={req.requester?.username ?? req.id} size={44} />
                  <View style={styles.usernameRow}>
                    <Text style={styles.username}>@{req.requester?.username ?? "Unknown"}</Text>
                    {req.requester && isActivePro(req.requester) ? <VerifiedBadge size={13} /> : null}
                  </View>
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
        </View>

        <View style={[styles.sectionCard, styles.sentCard]}>
          <View style={styles.sectionHeaderRow}>
            <View style={[styles.sectionIcon, { backgroundColor: Colors.secondary }]}>
              <Feather name="send" size={14} color={Colors.white} />
            </View>
            <Text style={styles.sectionTitle}>Sent</Text>
            <View style={[styles.countPill, { backgroundColor: Colors.secondary + "22" }]}>
              <Text style={[styles.countPillText, { color: Colors.secondary }]}>{outgoing.length}</Text>
            </View>
          </View>
          {outgoing.length === 0 ? (
            <Text style={styles.emptyRowText}>No sent requests</Text>
          ) : (
            outgoing.map((req, i) => (
              <View key={req.id} style={[styles.row, i > 0 && styles.rowDivider]}>
                <Pressable style={styles.rowInfo} onPress={() => req.recipient && navigation.navigate("UserProfile", { userId: req.recipient.id })}>
                  <Avatar avatarUrl={req.recipient?.avatarUrl} seed={req.recipient?.username ?? req.id} size={44} />
                  <View style={styles.usernameRow}>
                    <Text style={styles.username}>@{req.recipient?.username ?? "Unknown"}</Text>
                    {req.recipient && isActivePro(req.recipient) ? <VerifiedBadge size={13} /> : null}
                  </View>
                </Pressable>
                <Pressable onPress={() => req.recipient && cancelMutation.mutate(req.recipient.id)} style={styles.cancelButton}>
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </Pressable>
              </View>
            ))
          )}
        </View>

        {!isLoading && incoming.length === 0 && outgoing.length === 0 ? (
          <EmptyState icon={<Feather name="users" size={40} color={Colors.textMuted} />} title="No friend requests" subtitle="Search for people to send a friend request" />
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  sectionCard: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    borderWidth: 1.5,
    marginTop: Spacing.md,
    paddingVertical: Spacing.sm,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  incomingCard: { borderColor: Colors.primary + "33" },
  sentCard: { borderColor: Colors.secondary + "33" },
  sectionHeaderRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm },
  sectionIcon: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  sectionTitle: { ...Typography.bodyBold, color: Colors.text, fontSize: 15, flex: 1 },
  countPill: { backgroundColor: Colors.primary + "22", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  countPillText: { ...Typography.small, color: Colors.primary, fontWeight: "800" },
  emptyRowText: { ...Typography.small, color: Colors.textMuted, paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  rowDivider: { borderTopWidth: 1, borderTopColor: Colors.border },
  rowInfo: { flex: 1, flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  usernameRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  username: { ...Typography.bodyBold, color: Colors.text, fontSize: 15 },
  actions: { flexDirection: "row", gap: Spacing.xs },
  actionButton: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  acceptButton: { backgroundColor: Colors.success },
  declineButton: { backgroundColor: Colors.danger },
  cancelButton: { paddingHorizontal: Spacing.md, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: Colors.border },
  cancelButtonText: { ...Typography.small, color: Colors.textSecondary, fontWeight: "700" },
});
