import React, { useState } from "react";
import { View, StyleSheet, Text, ScrollView, Image, TextInput, Pressable, Platform, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useRoute, RouteProp, useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Colors, Spacing, Typography, BorderRadius } from "@/constants/theme";
import { Button, Badge, PriceTag } from "@/components/ui";
import { RootStackParamList } from "@/navigation/types";
import { apiJson, ApiError } from "@/lib/api";
import { resolveImageUrl } from "@/lib/media";
import { useAuth } from "@/contexts/AuthContext";
import { COURIER_LABELS, isValidTrackingNumber } from "@shared/validation";

type Nav = NativeStackNavigationProp<RootStackParamList, "OrderDetail">;
type Rt = RouteProp<RootStackParamList, "OrderDetail">;

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

function promptText(title: string, message: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (Platform.OS === "web") {
      resolve(window.prompt(`${title}\n${message}`));
    } else if (Platform.OS === "ios") {
      Alert.prompt(title, message, [
        { text: "Cancel", style: "cancel", onPress: () => resolve(null) },
        { text: "Submit", onPress: (text?: string) => resolve(text ?? null) },
      ]);
    } else {
      resolve("Requesting a refund"); // Android has no built-in text prompt; falls back to a default reason.
    }
  });
}

const COURIERS = Object.entries(COURIER_LABELS);

interface OrderDetail {
  id: string;
  status: string;
  subtotalCents: number;
  platformFeeCents: number;
  totalCents: number;
  courier: string | null;
  trackingNumber: string | null;
  boxSizeLabel: string | null;
  shippingDeadline: string | null;
  shippedAt: string | null;
  shippingName: string | null;
  shippingPhone: string | null;
  shippingLine1: string | null;
  shippingLine2: string | null;
  shippingCity: string | null;
  shippingState: string | null;
  shippingPostalCode: string | null;
  shippingCountry: string | null;
  createdAt: string;
  items: { titleSnapshot: string; imageUrlSnapshot: string | null; quantity: number; priceCentsSnapshot: number }[];
  buyer: { id: string; username: string } | null;
  seller: { id: string; username: string } | null;
}

export default function OrderDetailScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const { orderId } = route.params;
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: order, isLoading } = useQuery<OrderDetail>({ queryKey: [`/api/orders/${orderId}`] });

  const [courier, setCourier] = useState("other");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [boxSize, setBoxSize] = useState("");

  const shipMutation = useMutation({
    mutationFn: () => apiJson("POST", `/api/orders/${orderId}/ship`, { courier, trackingNumber, boxSizeLabel: boxSize || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/orders/${orderId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders/mine"] });
      showAlert("Marked as shipped", "The buyer has been notified with the tracking number.");
    },
    onError: (err) => showAlert("Couldn't mark as shipped", err instanceof ApiError ? err.message : "Please try again."),
  });

  const markDeliveredMutation = useMutation({
    mutationFn: () => apiJson("POST", `/api/orders/${orderId}/mark-delivered`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/orders/${orderId}`] }),
  });

  const refundMutation = useMutation({
    mutationFn: (reason: string) => apiJson("POST", `/api/orders/${orderId}/refund`, { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/orders/${orderId}`] });
      showAlert("Refund requested", "Your refund is being processed.");
    },
    onError: (err) => showAlert("Couldn't process refund", err instanceof ApiError ? err.message : "Please try again."),
  });

  if (isLoading || !order) {
    return (
      <View style={[styles.container, { paddingTop: headerHeight }]}>
        <Text style={styles.loading}>Loading…</Text>
      </View>
    );
  }

  const isSeller = user?.id === order.seller?.id;
  const isBuyer = user?.id === order.buyer?.id;
  const trackingLooksValid = trackingNumber.trim().length > 0 && isValidTrackingNumber(courier, trackingNumber);

  const handleRefund = async () => {
    const reason = await promptText("Why are you requesting a refund?", "This helps the seller and our team review it.");
    if (reason) refundMutation.mutate(reason);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: Spacing.lg, paddingTop: headerHeight + Spacing.md, paddingBottom: insets.bottom + Spacing.xl }}>
      <Text style={styles.orderId}>Order #{order.id.slice(0, 8).toUpperCase()}</Text>

      {order.items.map((item, i) => (
        <View key={i} style={styles.itemRow}>
          {item.imageUrlSnapshot ? <Image source={{ uri: resolveImageUrl(item.imageUrlSnapshot) }} style={styles.itemImage} /> : <View style={[styles.itemImage, styles.itemImagePlaceholder]} />}
          <View style={{ flex: 1 }}>
            <Text style={styles.itemTitle}>{item.titleSnapshot}</Text>
            <Text style={styles.itemMeta}>Qty {item.quantity}</Text>
          </View>
          <PriceTag cents={item.priceCentsSnapshot * item.quantity} style={{ fontSize: 14 }} />
        </View>
      ))}

      <View style={styles.summaryBlock}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Subtotal</Text>
          <Text style={styles.summaryValue}>${(order.subtotalCents / 100).toFixed(2)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Platform fee</Text>
          <Text style={styles.summaryValue}>${(order.platformFeeCents / 100).toFixed(2)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryTotalLabel}>Total</Text>
          <Text style={styles.summaryTotalValue}>${(order.totalCents / 100).toFixed(2)}</Text>
        </View>
      </View>

      {order.trackingNumber ? (
        <View style={styles.trackingCard}>
          <Feather name="truck" size={18} color={Colors.secondary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.trackingCourier}>{COURIER_LABELS[order.courier ?? "other"]}</Text>
            <Text style={styles.trackingNumber}>{order.trackingNumber}</Text>
            {order.boxSizeLabel ? <Text style={styles.trackingMeta}>Box: {order.boxSizeLabel}</Text> : null}
          </View>
        </View>
      ) : null}

      {isSeller && order.shippingLine1 ? (
        <View style={styles.addressCard}>
          <Feather name="map-pin" size={18} color={Colors.secondary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.addressName}>{order.shippingName ?? "Buyer"}</Text>
            <Text style={styles.addressLine}>{order.shippingLine1}</Text>
            {order.shippingLine2 ? <Text style={styles.addressLine}>{order.shippingLine2}</Text> : null}
            <Text style={styles.addressLine}>
              {[order.shippingCity, order.shippingState, order.shippingPostalCode].filter(Boolean).join(", ")}
            </Text>
            {order.shippingCountry ? <Text style={styles.addressLine}>{order.shippingCountry}</Text> : null}
            {order.shippingPhone ? <Text style={styles.addressMeta}>{order.shippingPhone}</Text> : null}
          </View>
        </View>
      ) : null}

      {isSeller && order.status === "paid" ? (
        <View style={styles.shipForm}>
          <Text style={styles.sectionTitle}>Ship this order</Text>
          <Text style={styles.helper}>A real tracking number is required before you can mark this shipped.</Text>

          <Text style={styles.fieldLabel}>Courier (optional)</Text>
          <View style={styles.courierRow}>
            {COURIERS.map(([key, label]) => (
              <Pressable key={key} onPress={() => setCourier(key)} style={[styles.courierChip, courier === key && styles.courierChipActive]}>
                <Text style={[styles.courierChipText, courier === key && { color: Colors.white }]}>{label}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.fieldLabel}>Tracking number (required)</Text>
          <TextInput style={styles.input} placeholder="e.g. 1234567890" placeholderTextColor={Colors.textMuted} value={trackingNumber} onChangeText={setTrackingNumber} autoCapitalize="characters" />
          {trackingNumber.length > 0 && !trackingLooksValid ? (
            <Text style={styles.errorText}>That doesn't look like a valid {COURIER_LABELS[courier]} tracking number.</Text>
          ) : null}

          <Text style={styles.fieldLabel}>Box size (optional)</Text>
          <TextInput style={styles.input} placeholder="e.g. Small satchel" placeholderTextColor={Colors.textMuted} value={boxSize} onChangeText={setBoxSize} />

          <Button title="Mark as Shipped" onPress={() => shipMutation.mutate()} loading={shipMutation.isPending} disabled={!trackingLooksValid} style={{ marginTop: Spacing.md }} />
        </View>
      ) : null}

      {isBuyer && order.status === "paid" ? (
        <Button title="Request a Refund" variant="danger" onPress={handleRefund} loading={refundMutation.isPending} style={{ marginTop: Spacing.lg }} />
      ) : null}

      {isBuyer && order.status === "shipped" ? (
        <Button title="Mark as Received" variant="secondary" onPress={() => markDeliveredMutation.mutate()} loading={markDeliveredMutation.isPending} style={{ marginTop: Spacing.lg }} />
      ) : null}

      {order.status === "delivered" ? <Badge label="Delivered" color={Colors.success} style={{ alignSelf: "flex-start", marginTop: Spacing.lg }} /> : null}
      {order.status === "refunded" ? <Badge label="Refunded" color={Colors.danger} style={{ alignSelf: "flex-start", marginTop: Spacing.lg }} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loading: { textAlign: "center", marginTop: Spacing.xl, color: Colors.textSecondary },
  orderId: { ...Typography.h3, color: Colors.text, marginBottom: Spacing.md },
  itemRow: { flexDirection: "row", gap: Spacing.sm, alignItems: "center", paddingVertical: Spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  itemImage: { width: 48, height: 62, borderRadius: BorderRadius.sm, backgroundColor: Colors.surfaceAlt },
  itemImagePlaceholder: {},
  itemTitle: { ...Typography.bodyBold, color: Colors.text, fontSize: 14 },
  itemMeta: { ...Typography.small, color: Colors.textSecondary },
  summaryBlock: { marginTop: Spacing.md, paddingTop: Spacing.sm },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  summaryLabel: { ...Typography.small, color: Colors.textSecondary },
  summaryValue: { ...Typography.small, color: Colors.text },
  summaryTotalLabel: { ...Typography.bodyBold, color: Colors.text },
  summaryTotalValue: { ...Typography.bodyBold, color: Colors.primary },
  trackingCard: { flexDirection: "row", gap: Spacing.sm, backgroundColor: "#EAF1FB", padding: Spacing.md, borderRadius: BorderRadius.md, marginTop: Spacing.lg, alignItems: "center" },
  trackingCourier: { ...Typography.small, color: Colors.secondary, fontWeight: "700" },
  trackingNumber: { ...Typography.bodyBold, color: Colors.text },
  trackingMeta: { ...Typography.small, color: Colors.textSecondary },
  addressCard: { flexDirection: "row", gap: Spacing.sm, backgroundColor: Colors.surfaceAlt, padding: Spacing.md, borderRadius: BorderRadius.md, marginTop: Spacing.lg, alignItems: "flex-start" },
  addressName: { ...Typography.bodyBold, color: Colors.text, marginBottom: 2 },
  addressLine: { ...Typography.small, color: Colors.textSecondary },
  addressMeta: { ...Typography.small, color: Colors.textMuted, marginTop: 4 },
  shipForm: { marginTop: Spacing.xl, gap: Spacing.xs },
  sectionTitle: { ...Typography.bodyBold, color: Colors.text },
  helper: { ...Typography.small, color: Colors.textSecondary, marginBottom: Spacing.sm },
  fieldLabel: { ...Typography.small, color: Colors.textSecondary, fontWeight: "700", marginTop: Spacing.sm },
  courierRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  courierChip: { paddingHorizontal: Spacing.sm, paddingVertical: 6, borderRadius: BorderRadius.pill, borderWidth: 1, borderColor: Colors.border },
  courierChipActive: { backgroundColor: Colors.secondary, borderColor: Colors.secondary },
  courierChipText: { ...Typography.small, color: Colors.text },
  input: { borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.md, paddingVertical: 10, backgroundColor: Colors.surface, color: Colors.text },
  errorText: { ...Typography.small, color: Colors.danger },
});
