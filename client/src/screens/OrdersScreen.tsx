import React, { useState } from "react";
import { View, StyleSheet, Text, FlatList, Pressable, Image } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Colors, Spacing, Typography, BorderRadius } from "@/constants/theme";
import { Badge, EmptyState, PriceTag } from "@/components/ui";
import { RootStackParamList } from "@/navigation/types";
import { useAuth } from "@/contexts/AuthContext";
import { resolveImageUrl } from "@/lib/media";

type Nav = NativeStackNavigationProp<RootStackParamList, "Orders">;

const STATUS_META: Record<string, { label: string; color: string }> = {
  pending_payment: { label: "Awaiting payment", color: Colors.textMuted },
  paid: { label: "Paid — not shipped", color: Colors.warning },
  shipped: { label: "Shipped", color: Colors.secondary },
  delivered: { label: "Delivered", color: Colors.success },
  refund_requested: { label: "Refund requested", color: Colors.danger },
  refunded: { label: "Refunded", color: Colors.danger },
  cancelled: { label: "Cancelled", color: Colors.textMuted },
};

interface OrderRow {
  id: string;
  status: string;
  totalCents: number;
  trackingNumber: string | null;
  createdAt: string;
  items: { titleSnapshot: string; imageUrlSnapshot: string | null; quantity: number }[];
  buyer: { id: string; username: string } | null;
  seller: { id: string; username: string } | null;
}

export default function OrdersScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { user } = useAuth();
  const [role, setRole] = useState<"buyer" | "seller">("buyer");

  const { data: orders, isLoading } = useQuery<OrderRow[]>({ queryKey: [`/api/orders/mine?role=${role}`], enabled: !!user });

  return (
    <View style={[styles.container, { paddingTop: headerHeight }]}>
      <View style={styles.tabs}>
        <Pressable style={[styles.tab, role === "buyer" && styles.tabActive]} onPress={() => setRole("buyer")}>
          <Text style={[styles.tabText, role === "buyer" && styles.tabTextActive]}>Buying</Text>
        </Pressable>
        <Pressable style={[styles.tab, role === "seller" && styles.tabActive]} onPress={() => setRole("seller")}>
          <Text style={[styles.tabText, role === "seller" && styles.tabTextActive]}>Selling</Text>
        </Pressable>
      </View>

      <FlatList
        data={orders ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: Spacing.lg, paddingBottom: insets.bottom + Spacing.xl }}
        renderItem={({ item }) => {
          const meta = STATUS_META[item.status] ?? { label: item.status, color: Colors.textMuted };
          const firstItem = item.items[0];
          return (
            <Pressable style={styles.card} onPress={() => navigation.navigate("OrderDetail", { orderId: item.id })}>
              {firstItem?.imageUrlSnapshot ? <Image source={{ uri: resolveImageUrl(firstItem.imageUrlSnapshot) }} style={styles.thumb} /> : <View style={[styles.thumb, styles.thumbPlaceholder]} />}
              <View style={{ flex: 1 }}>
                <Text style={styles.title} numberOfLines={1}>
                  {firstItem?.titleSnapshot ?? "Order"}
                  {item.items.length > 1 ? ` +${item.items.length - 1} more` : ""}
                </Text>
                <Text style={styles.subtitle}>{role === "buyer" ? `Sold by @${item.seller?.username}` : `Buyer @${item.buyer?.username}`}</Text>
                <View style={styles.metaRow}>
                  <Badge label={meta.label} color={meta.color} />
                  {item.trackingNumber ? <Text style={styles.tracking}>#{item.trackingNumber}</Text> : null}
                </View>
              </View>
              <PriceTag cents={item.totalCents} style={{ fontSize: 14 }} />
            </Pressable>
          );
        }}
        ListEmptyComponent={
          !isLoading ? <EmptyState icon={<Feather name="package" size={40} color={Colors.textMuted} />} title={role === "buyer" ? "No purchases yet" : "No sales yet"} /> : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  tabs: { flexDirection: "row", gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingTop: Spacing.md },
  tab: { flex: 1, paddingVertical: 10, borderRadius: BorderRadius.pill, alignItems: "center", backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  tabActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tabText: { ...Typography.bodyBold, color: Colors.text },
  tabTextActive: { color: Colors.white },
  card: { flexDirection: "row", gap: Spacing.sm, alignItems: "center", backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.sm, marginBottom: Spacing.sm, borderWidth: 1, borderColor: Colors.border },
  thumb: { width: 52, height: 66, borderRadius: BorderRadius.sm, backgroundColor: Colors.surfaceAlt },
  thumbPlaceholder: {},
  title: { ...Typography.bodyBold, color: Colors.text, fontSize: 14 },
  subtitle: { ...Typography.small, color: Colors.textSecondary },
  metaRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, marginTop: 4 },
  tracking: { ...Typography.small, color: Colors.textMuted },
});
