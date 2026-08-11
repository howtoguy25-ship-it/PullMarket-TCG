import React from "react";
import { View, StyleSheet, Text, FlatList, Pressable, Platform, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Colors, Spacing, Typography, BorderRadius } from "@/constants/theme";
import { EmptyState } from "@/components/ui";
import { RootStackParamList } from "@/navigation/types";
import { apiJson, apiRequest } from "@/lib/api";
import { timeAgo } from "@/lib/timeAgo";

type Nav = NativeStackNavigationProp<RootStackParamList, "Notifications">;

const ACCENT: [string, string] = [Colors.primary, Colors.goldDark];

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

function confirmClearAll(): Promise<boolean> {
  return new Promise((resolve) => {
    if (Platform.OS === "web") {
      resolve(window.confirm("Clear all notifications?\nThis can't be undone."));
    } else {
      Alert.alert("Clear all notifications?", "This can't be undone.", [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: "Clear all", style: "destructive", onPress: () => resolve(true) },
      ]);
    }
  });
}

export default function NotificationsScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const queryClient = useQueryClient();

  const { data: notifications, isLoading } = useQuery<Notification[]>({ queryKey: ["/api/notifications"] });
  const hasUnread = (notifications ?? []).some((n) => !n.isRead);
  const hasAny = (notifications ?? []).length > 0;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
  };

  const readMutation = useMutation({
    mutationFn: (id: string) => apiJson("POST", `/api/notifications/${id}/read`),
    onSuccess: invalidate,
  });
  const readAllMutation = useMutation({
    mutationFn: () => apiJson("POST", "/api/notifications/read-all"),
    onSuccess: invalidate,
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/notifications/${id}`),
    onSuccess: invalidate,
  });
  const clearAllMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/notifications"),
    onSuccess: invalidate,
  });

  const handlePress = (n: Notification) => {
    if (!n.isRead) readMutation.mutate(n.id);
    const orderId = n.data?.orderId as string | undefined;
    const listingId = n.data?.listingId as string | undefined;
    if (orderId) navigation.navigate("OrderDetail", { orderId });
    else if (listingId) navigation.navigate("ListingDetail", { listingId });
  };

  const handleClearAll = async () => {
    if (await confirmClearAll()) clearAllMutation.mutate();
  };

  return (
    <View style={[styles.container, { paddingTop: headerHeight }]}>
      {hasAny ? (
        <LinearGradient colors={ACCENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.actionBar}>
          <Pressable onPress={() => hasUnread && readAllMutation.mutate()} disabled={!hasUnread} style={styles.actionButton}>
            <Feather name="check-circle" size={14} color={hasUnread ? Colors.white : "rgba(255,255,255,0.5)"} />
            <Text style={[styles.actionText, !hasUnread && styles.actionTextDisabled]}>Mark all read</Text>
          </Pressable>
          <View style={styles.actionDivider} />
          <Pressable onPress={handleClearAll} style={styles.actionButton}>
            <Feather name="trash-2" size={14} color={Colors.white} />
            <Text style={styles.actionText}>Clear all</Text>
          </Pressable>
        </LinearGradient>
      ) : null}
      <FlatList
        data={notifications ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: Spacing.lg, paddingBottom: insets.bottom + Spacing.xl }}
        renderItem={({ item }) => (
          <Pressable onPress={() => handlePress(item)} style={[styles.card, !item.isRead && styles.cardUnread]}>
            <LinearGradient colors={ACCENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.iconCircle}>
              <Feather name={TYPE_ICONS[item.type] ?? "bell"} size={16} color={Colors.white} />
            </LinearGradient>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.body}>{item.body}</Text>
              <Text style={styles.time}>{timeAgo(item.createdAt)}</Text>
            </View>
            {!item.isRead ? <View style={styles.dot} /> : null}
            <Pressable onPress={() => deleteMutation.mutate(item.id)} hitSlop={10} style={styles.deleteButton}>
              <Feather name="x" size={16} color={Colors.textMuted} />
            </Pressable>
          </Pressable>
        )}
        ListEmptyComponent={!isLoading ? <EmptyState icon={<Feather name="bell-off" size={40} color={Colors.textMuted} />} title="No notifications yet" /> : null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  actionBar: { flexDirection: "row", alignItems: "center", marginHorizontal: Spacing.lg, marginTop: Spacing.sm, borderRadius: BorderRadius.pill, overflow: "hidden" },
  actionButton: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 11 },
  actionDivider: { width: StyleSheet.hairlineWidth, height: "60%", backgroundColor: "rgba(255,255,255,0.35)" },
  actionText: { ...Typography.small, color: Colors.white, fontWeight: "700" },
  actionTextDisabled: { color: "rgba(255,255,255,0.5)" },
  card: { flexDirection: "row", gap: Spacing.sm, alignItems: "flex-start", backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm, borderWidth: 1, borderColor: Colors.border },
  cardUnread: { backgroundColor: Colors.surfaceAlt, borderColor: Colors.gold },
  iconCircle: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  title: { ...Typography.bodyBold, color: Colors.text, fontSize: 14 },
  body: { ...Typography.small, color: Colors.textSecondary, marginTop: 2 },
  time: { ...Typography.small, color: Colors.textMuted, marginTop: 4, fontSize: 11 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.primary, marginTop: 4 },
  deleteButton: { padding: 2 },
});
