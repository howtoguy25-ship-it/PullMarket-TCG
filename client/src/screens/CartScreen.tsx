import React from "react";
import { View, StyleSheet, Text, ScrollView, Image, Pressable, Platform, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { Colors, Spacing, Typography, BorderRadius, Shadow } from "@/constants/theme";
import { Button, PriceTag, EmptyState } from "@/components/ui";
import { RootStackParamList } from "@/navigation/types";
import { apiJson, ApiError } from "@/lib/api";
import { resolveImageUrl } from "@/lib/media";

type Nav = NativeStackNavigationProp<RootStackParamList>;

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

interface CartItem {
  id: string;
  listingId: string;
  title: string;
  priceCents: number;
  quantity: number;
  quantityAvailable: number;
  image: string | null;
  status: string;
}
interface CartGroup {
  sellerId: string;
  seller: { id: string; username: string } | null;
  items: CartItem[];
  subtotalCents: number;
  platformFeeCents: number;
  totalCents: number;
}
interface CartResponse {
  groups: CartGroup[];
  grandTotalCents: number;
}

export default function CartScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const queryClient = useQueryClient();

  const { data: cart, isLoading } = useQuery<CartResponse>({ queryKey: ["/api/cart"] });

  const updateQty = useMutation({
    mutationFn: ({ itemId, quantity }: { itemId: string; quantity: number }) => apiJson("PATCH", `/api/cart/${itemId}`, { quantity }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/cart"] }),
  });
  const removeItem = useMutation({
    mutationFn: (itemId: string) => apiJson("DELETE", `/api/cart/${itemId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/cart"] }),
  });
  const payMutation = useMutation({
    mutationFn: (sellerId: string) => {
      const returnUrl = Linking.createURL("checkout-return");
      return apiJson<{ url: string }>("POST", "/api/checkout/session", { sellerId, returnUrl });
    },
    onSuccess: async (data) => {
      if (Platform.OS === "web") {
        window.location.href = data.url;
      } else {
        await WebBrowser.openAuthSessionAsync(data.url, Linking.createURL("checkout-return"));
      }
      queryClient.invalidateQueries({ queryKey: ["/api/cart"] });
    },
    onError: (err) => showAlert("Couldn't start checkout", err instanceof ApiError ? err.message : "Please try again."),
  });

  if (!isLoading && (!cart || cart.groups.length === 0)) {
    return (
      <View style={[styles.container, { paddingTop: headerHeight }]}>
        <EmptyState icon={<Feather name="shopping-cart" size={40} color={Colors.textMuted} />} title="Your cart is empty" subtitle="Browse the marketplace to find your next card" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: Spacing.lg, paddingTop: headerHeight + Spacing.md, paddingBottom: insets.bottom + Spacing.xl }}>
      {cart?.groups.map((group) => (
        <View key={group.sellerId} style={[styles.groupCard, Shadow.card]}>
          <View style={styles.groupHeader}>
            <Feather name="user" size={14} color={Colors.textSecondary} />
            <Text style={styles.groupHeaderText}>Sold by @{group.seller?.username ?? "seller"}</Text>
          </View>

          {group.items.map((item) => (
            <View key={item.id} style={styles.itemRow}>
              {item.image ? <Image source={{ uri: resolveImageUrl(item.image) }} style={styles.itemImage} /> : <View style={[styles.itemImage, styles.itemImagePlaceholder]} />}
              <View style={{ flex: 1 }}>
                <Text style={styles.itemTitle} numberOfLines={2}>
                  {item.title}
                </Text>
                <PriceTag cents={item.priceCents} style={{ fontSize: 15 }} />
                <View style={styles.qtyRow}>
                  <Pressable onPress={() => updateQty.mutate({ itemId: item.id, quantity: Math.max(1, item.quantity - 1) })} style={styles.qtyButton}>
                    <Feather name="minus" size={14} color={Colors.text} />
                  </Pressable>
                  <Text style={styles.qtyValue}>{item.quantity}</Text>
                  <Pressable
                    onPress={() => updateQty.mutate({ itemId: item.id, quantity: Math.min(item.quantityAvailable, item.quantity + 1) })}
                    style={styles.qtyButton}
                    disabled={item.quantity >= item.quantityAvailable}
                  >
                    <Feather name="plus" size={14} color={item.quantity >= item.quantityAvailable ? Colors.textMuted : Colors.text} />
                  </Pressable>
                </View>
              </View>
              <Pressable onPress={() => removeItem.mutate(item.id)} hitSlop={8}>
                <Feather name="trash-2" size={18} color={Colors.danger} />
              </Pressable>
            </View>
          ))}

          <Pressable onPress={() => navigation.navigate("MainTabs")} style={styles.addMoreRow}>
            <Feather name="plus-circle" size={15} color={Colors.primary} />
            <Text style={styles.addMoreText}>Add more from the marketplace</Text>
          </Pressable>

          <View style={styles.summaryBlock}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Subtotal</Text>
              <Text style={styles.summaryValue}>${(group.subtotalCents / 100).toFixed(2)}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Platform fee</Text>
              <Text style={styles.summaryValue}>${(group.platformFeeCents / 100).toFixed(2)}</Text>
            </View>
            <View style={[styles.summaryRow, { marginTop: 4 }]}>
              <Text style={styles.summaryTotalLabel}>Total</Text>
              <Text style={styles.summaryTotalValue}>${(group.totalCents / 100).toFixed(2)}</Text>
            </View>
          </View>

          <Button title={`Pay Now — $${(group.totalCents / 100).toFixed(2)}`} onPress={() => payMutation.mutate(group.sellerId)} loading={payMutation.isPending} style={{ marginTop: Spacing.md }} />
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  groupCard: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.lg, borderWidth: 1, borderColor: Colors.border },
  groupHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: Spacing.sm },
  groupHeaderText: { ...Typography.small, color: Colors.textSecondary, fontWeight: "700" },
  itemRow: { flexDirection: "row", gap: Spacing.sm, alignItems: "center", paddingVertical: Spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  itemImage: { width: 56, height: 72, borderRadius: BorderRadius.sm, backgroundColor: Colors.surfaceAlt },
  itemImagePlaceholder: {},
  itemTitle: { ...Typography.bodyBold, color: Colors.text, fontSize: 14 },
  qtyRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, marginTop: 4 },
  qtyButton: { width: 26, height: 26, borderRadius: 13, backgroundColor: Colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
  qtyValue: { ...Typography.bodyBold, minWidth: 18, textAlign: "center" },
  addMoreRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: Spacing.sm },
  addMoreText: { ...Typography.small, color: Colors.primary, fontWeight: "700" },
  summaryBlock: { marginTop: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  summaryLabel: { ...Typography.small, color: Colors.textSecondary },
  summaryValue: { ...Typography.small, color: Colors.text },
  summaryTotalLabel: { ...Typography.bodyBold, color: Colors.text },
  summaryTotalValue: { ...Typography.bodyBold, color: Colors.primary, fontSize: 17 },
});
