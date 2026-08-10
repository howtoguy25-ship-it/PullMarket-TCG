import React from "react";
import { View, StyleSheet, Text, FlatList, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Colors, Spacing, Typography, BorderRadius } from "@/constants/theme";
import { EmptyState, Button } from "@/components/ui";
import { RootStackParamList } from "@/navigation/types";
import { apiJson } from "@/lib/api";

type Nav = NativeStackNavigationProp<RootStackParamList, "Notifications">;

const TYPE_ICONS: Record<string, keyof typeof Feather.glyphMap> = {
  purchase: "shopping-bag",
  sale: "dollar-sign",
  shipped: "truck",
  delivered: "check-circle",
  new_listing_match: "star",
  refund: "rotate-ccw",
  report_update: "flag",
};

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
  data: Record<string, unknown>;
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function NotificationsScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const queryClient = useQueryClient();

  const { data: notifications, isLoading } = useQuery<Notification[]>({ queryKey: ["/api/notifications"] });

  const readMutation = useMutation({
    mutationFn: (id: string) => apiJson("POST", `/api/notifications/${id}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });
  const readAllMutation = useMutation({
    mutationFn: () => apiJson("POST", "/api/notifications/read-all"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  const handlePress = (n: Notification) => {
    if (!n.isRead) readMutation.mutate(n.id);
    const orderId = n.data?.orderId as string | undefined;
    const listingId = n.data?.listingId as string | undefined;
    if (orderId) navigation.navigate("OrderDetail", { orderId });
    else if (listingId) navigation.navigate("ListingDetail", { listingId });
  };

  return (
    <View style={[styles.container, { paddingTop: headerHeight }]}>
      {(notifications ?? []).some((n) => !n.isRead) ? (
        <Pressable onPress={() => readAllMutation.mutate()} style={styles.markAllRow}>
          <Text style={styles.markAllText}>Mark all as read</Text>
        </Pressable>
      ) : null}
      <FlatList
        data={notifications ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: Spacing.lg, paddingBottom: insets.bottom + Spacing.xl }}
        renderItem={({ item }) => (
          <Pressable onPress={() => handlePress(item)} style={[styles.card, !item.isRead && styles.cardUnread]}>
            <View style={styles.iconCircle}>
              <Feather name={TYPE_ICONS[item.type] ?? "bell"} size={16} color={Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.body}>{item.body}</Text>
              <Text style={styles.time}>{timeAgo(item.createdAt)}</Text>
            </View>
            {!item.isRead ? <View style={styles.dot} /> : null}
          </Pressable>
        )}
        ListEmptyComponent={!isLoading ? <EmptyState icon={<Feather name="bell-off" size={40} color={Colors.textMuted} />} title="No notifications yet" /> : null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  markAllRow: { alignItems: "flex-end", paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
  markAllText: { ...Typography.small, color: Colors.primary, fontWeight: "700" },
  card: { flexDirection: "row", gap: Spacing.sm, alignItems: "flex-start", backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm, borderWidth: 1, borderColor: Colors.border },
  cardUnread: { backgroundColor: Colors.surfaceAlt, borderColor: Colors.gold },
  iconCircle: { width: 32, height: 32, borderRadius: 16, backgroundColor: "#FCE9E4", alignItems: "center", justifyContent: "center" },
  title: { ...Typography.bodyBold, color: Colors.text, fontSize: 14 },
  body: { ...Typography.small, color: Colors.textSecondary, marginTop: 2 },
  time: { ...Typography.small, color: Colors.textMuted, marginTop: 4, fontSize: 11 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.primary, marginTop: 4 },
});
