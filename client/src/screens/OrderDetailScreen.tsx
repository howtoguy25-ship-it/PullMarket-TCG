import React, { useState } from "react";
import { View, StyleSheet, Text, ScrollView, Image, TextInput, Pressable, Platform, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useRoute, RouteProp, useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Colors, Spacing, Typography, BorderRadius, Shadow, Fonts } from "@/constants/theme";
import { Button, Badge, PriceTag } from "@/components/ui";
import { RootStackParamList } from "@/navigation/types";
import { apiJson, ApiError } from "@/lib/api";
import { formatPriceCents } from "@/lib/format";
import { resolveImageUrl } from "@/lib/media";
import { useAuth } from "@/contexts/AuthContext";
import * as Linking from "expo-linking";
import { COURIER_LABELS, isValidTrackingNumber, buildTrackingUrl } from "@shared/validation";
import { useShippingInfoScreenCapture } from "@/hooks/useShippingInfoScreenCapture";

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

const STATUS_META: Record<string, { label: string; color: string }> = {
  pending_payment: { label: "Awaiting payment", color: Colors.textMuted },
  paid: { label: "Paid — not shipped", color: Colors.warning },
  shipped: { label: "Shipped", color: Colors.secondary },
  delivered: { label: "Delivered", color: Colors.success },
  refund_requested: { label: "Refund requested", color: Colors.danger },
  refunded: { label: "Refunded", color: Colors.danger },
  cancelled: { label: "Cancelled", color: Colors.textMuted },
};

interface OrderDetail {
  id: string;
  status: string;
  subtotalCents: number;
  platformFeeCents: number;
  totalCents: number;
  courier: string | null;
  trackingNumber: string | null;
  boxSizeLabel: string | null;
  customBusinessDeclared: string | null;
  customBusinessDetected: string | null;
  customTrackingVerified: boolean | null;
  customTrackingNote: string | null;
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
  const [customBusiness, setCustomBusiness] = useState("");

  const shipMutation = useMutation({
    mutationFn: () =>
      apiJson("POST", `/api/orders/${orderId}/ship`, {
        courier,
        trackingNumber,
        boxSizeLabel: boxSize || undefined,
        customBusinessDeclared: courier === "custom" ? customBusiness : undefined,
      }),
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

  const isSellerViewingAddress = !!order && user?.id === order.seller?.id && !!order.shippingLine1;
  useShippingInfoScreenCapture(orderId, isSellerViewingAddress);

  if (isLoading || !order) {
    return (
      <View style={[styles.container, { paddingTop: headerHeight }]}>
        <Text style={styles.loading}>Loading…</Text>
      </View>
    );
  }

  const isSeller = user?.id === order.seller?.id;
  const isBuyer = user?.id === order.buyer?.id;
  // "Custom" can't be format-checked client-side — Claude verifies it
  // server-side against the declared business when the order is shipped.
  const trackingLooksValid =
    courier === "custom"
      ? trackingNumber.trim().length >= 4 && customBusiness.trim().length > 0
      : trackingNumber.trim().length > 0 && isValidTrackingNumber(courier, trackingNumber);

  const handleRefund = async () => {
    const reason = await promptText("Why are you requesting a refund?", "This helps the seller and our team review it.");
    if (reason) refundMutation.mutate(reason);
  };

  const statusMeta = STATUS_META[order.status] ?? { label: order.status, color: Colors.textMuted };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: Spacing.lg, paddingTop: headerHeight + Spacing.md, paddingBottom: insets.bottom + Spacing.xl }}>
      <View style={styles.headerRow}>
        <Text style={styles.orderId}>Order #{order.id.slice(0, 8).toUpperCase()}</Text>
        <Badge label={statusMeta.label} color={statusMeta.color} />
      </View>

      <View style={[styles.sectionCard, styles.itemsCard]}>
        <View style={styles.sectionHeaderRow}>
          <View style={[styles.sectionIcon, { backgroundColor: Colors.primary }]}>
            <Feather name="package" size={13} color={Colors.white} />
          </View>
          <Text style={styles.sectionTitle}>Items</Text>
        </View>
        {order.items.map((item, i) => (
          <View key={i} style={[styles.itemRow, i > 0 && styles.rowDivider]}>
            {item.imageUrlSnapshot ? <Image source={{ uri: resolveImageUrl(item.imageUrlSnapshot) }} style={styles.itemImage} /> : <View style={[styles.itemImage, styles.itemImagePlaceholder]} />}
            <View style={{ flex: 1 }}>
              <Text style={styles.itemTitle}>{item.titleSnapshot}</Text>
              <Text style={styles.itemMeta}>Qty {item.quantity}</Text>
            </View>
            <PriceTag cents={item.priceCentsSnapshot * item.quantity} style={{ fontSize: 14 }} />
          </View>
        ))}
      </View>

      <View style={[styles.sectionCard, styles.summaryCard]}>
        <View style={styles.sectionHeaderRow}>
          <View style={[styles.sectionIcon, { backgroundColor: Colors.goldDark }]}>
            <Feather name="dollar-sign" size={13} color={Colors.white} />
          </View>
          <Text style={styles.sectionTitle}>Summary</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Subtotal</Text>
          <Text style={styles.summaryValue}>{formatPriceCents(order.subtotalCents)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Platform fee</Text>
          <Text style={styles.summaryValue}>{formatPriceCents(order.platformFeeCents)}</Text>
        </View>
        <View style={[styles.summaryRow, styles.summaryTotalRow]}>
          <Text style={styles.summaryTotalLabel}>Total</Text>
          <Text style={styles.summaryTotalValue}>{formatPriceCents(order.totalCents)}</Text>
        </View>
      </View>

      {order.trackingNumber ? (
        <View style={[styles.sectionCard, styles.trackingCardOuter]}>
          <View style={styles.sectionHeaderRow}>
            <View style={[styles.sectionIcon, { backgroundColor: Colors.secondary }]}>
              <Feather name="truck" size={13} color={Colors.white} />
            </View>
            <Text style={styles.sectionTitle}>Tracking</Text>
          </View>
          <Text style={styles.trackingCourier}>
            {order.courier === "custom" ? `Custom · ${order.customBusinessDeclared ?? "Third-party"}` : COURIER_LABELS[order.courier ?? "other"]}
          </Text>
          {(() => {
            const trackingUrl = buildTrackingUrl(order.courier ?? "other", order.trackingNumber ?? "");
            if (!trackingUrl) return <Text style={styles.trackingNumber}>{order.trackingNumber}</Text>;
            return (
              <Pressable
                onPress={() =>
                  Linking.openURL(trackingUrl).catch(() => showAlert("Couldn't open tracking", "Please try again, or track this number directly on the courier's website."))
                }
                style={styles.trackingLinkRow}
                hitSlop={6}
              >
                <Text style={[styles.trackingNumber, styles.trackingNumberLink]}>{order.trackingNumber}</Text>
                <Feather name="external-link" size={14} color={Colors.secondary} />
              </Pressable>
            );
          })()}
          {order.boxSizeLabel ? <Text style={styles.trackingMeta}>Box: {order.boxSizeLabel}</Text> : null}
          {order.courier === "custom" && order.customTrackingNote ? (
            <View style={styles.customNoteBox}>
              <Feather name="info" size={11} color={Colors.textMuted} />
              <Text style={styles.customNoteText}>{order.customTrackingNote}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {isSeller && order.shippingLine1 ? (
        <View style={[styles.sectionCard, styles.addressCardOuter]}>
          <View style={styles.sectionHeaderRow}>
            <View style={[styles.sectionIcon, { backgroundColor: Colors.warning }]}>
              <Feather name="map-pin" size={13} color={Colors.white} />
            </View>
            <Text style={styles.sectionTitle}>Delivery address</Text>
          </View>
          <Text style={styles.addressName}>{order.shippingName ?? "Buyer"}</Text>
          <Text style={styles.addressLine}>{order.shippingLine1}</Text>
          {order.shippingLine2 ? <Text style={styles.addressLine}>{order.shippingLine2}</Text> : null}
          <Text style={styles.addressLine}>{[order.shippingCity, order.shippingState, order.shippingPostalCode].filter(Boolean).join(", ")}</Text>
          {order.shippingCountry ? <Text style={styles.addressLine}>{order.shippingCountry}</Text> : null}
          {order.shippingPhone ? <Text style={styles.addressMeta}>{order.shippingPhone}</Text> : null}
        </View>
      ) : null}

      {isSeller && order.status === "paid" ? (
        <View style={[styles.sectionCard, styles.shipCardOuter]}>
          <View style={styles.sectionHeaderRow}>
            <View style={[styles.sectionIcon, { backgroundColor: Colors.primary }]}>
              <Feather name="send" size={13} color={Colors.white} />
            </View>
            <Text style={styles.sectionTitle}>Ship this order</Text>
          </View>
          <Text style={styles.helper}>A real tracking number is required before you can mark this shipped.</Text>

          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>Courier (optional)</Text>
            <View style={styles.courierRow}>
              {COURIERS.map(([key, label]) => (
                <Pressable key={key} onPress={() => setCourier(key)} style={[styles.courierChip, courier === key && styles.courierChipActive]}>
                  <Text style={[styles.courierChipText, courier === key && { color: Colors.white }]}>{label}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          {courier === "custom" ? (
            <View style={styles.fieldBlock}>
              <Text style={styles.fieldLabel}>Shipping from which business? (required)</Text>
              <Text style={styles.helper}>
                For third-party shipping (a courier not listed above). AI checks the tracking number's format actually matches this business before you can ship.
              </Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Sendle, China Post, Yun Express…"
                placeholderTextColor={Colors.textMuted}
                value={customBusiness}
                onChangeText={setCustomBusiness}
              />
            </View>
          ) : null}

          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>Tracking number (required)</Text>
            <TextInput style={styles.input} placeholder="e.g. 1234567890" placeholderTextColor={Colors.textMuted} value={trackingNumber} onChangeText={setTrackingNumber} autoCapitalize="characters" />
            {courier !== "custom" && trackingNumber.length > 0 && !trackingLooksValid ? (
              <Text style={styles.errorText}>That doesn't look like a valid {COURIER_LABELS[courier]} tracking number.</Text>
            ) : null}
            {courier === "custom" && trackingLooksValid ? <Text style={styles.helper}>AI will verify this matches "{customBusiness}" when you mark as shipped.</Text> : null}
          </View>

          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>Box size (optional)</Text>
            <TextInput style={styles.input} placeholder="e.g. Small satchel" placeholderTextColor={Colors.textMuted} value={boxSize} onChangeText={setBoxSize} />
          </View>

          <Button title="Mark as Shipped" onPress={() => shipMutation.mutate()} loading={shipMutation.isPending} disabled={!trackingLooksValid} style={{ marginTop: Spacing.sm }} />
        </View>
      ) : null}

      {isBuyer && order.status === "paid" ? (
        <Button title="Request a Refund" variant="danger" onPress={handleRefund} loading={refundMutation.isPending} style={{ marginTop: Spacing.lg }} />
      ) : null}

      {isBuyer && order.status === "shipped" ? (
        <Button title="Mark as Received" variant="secondary" onPress={() => markDeliveredMutation.mutate()} loading={markDeliveredMutation.isPending} style={{ marginTop: Spacing.lg }} />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loading: { textAlign: "center", marginTop: Spacing.xl, color: Colors.textSecondary },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: Spacing.sm, marginBottom: Spacing.xs },
  orderId: { ...Typography.h3, color: Colors.text },

  // Shared "table barrier" card shell — every section on this screen sits
  // inside one of these, with a colored icon badge + Baloo display-font
  // title as the header, so each block of info reads as its own bordered
  // module instead of everything running together in one long list.
  sectionCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1.5,
    borderColor: Colors.border,
    marginTop: Spacing.lg,
    padding: Spacing.md,
    ...Shadow.card,
  },
  itemsCard: { borderColor: Colors.primary + "33" },
  summaryCard: { borderColor: Colors.goldDark + "40" },
  trackingCardOuter: { borderColor: Colors.secondary + "33" },
  addressCardOuter: { borderColor: Colors.warning + "40" },
  shipCardOuter: { borderColor: Colors.primary + "33" },

  sectionHeaderRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, marginBottom: Spacing.sm },
  sectionIcon: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  sectionTitle: { fontFamily: Fonts.displayBold, fontSize: 16, color: Colors.text },

  // Divider rule between rows inside a card — the literal "table barrier"
  // between entries (items, summary lines) rather than a floating list.
  rowDivider: { borderTopWidth: 1, borderTopColor: Colors.border, marginTop: Spacing.xs, paddingTop: Spacing.sm },

  itemRow: { flexDirection: "row", gap: Spacing.sm, alignItems: "center", paddingVertical: Spacing.xs },
  itemImage: { width: 48, height: 62, borderRadius: BorderRadius.sm, backgroundColor: Colors.surfaceAlt },
  itemImagePlaceholder: {},
  itemTitle: { ...Typography.bodyBold, color: Colors.text, fontSize: 14 },
  itemMeta: { ...Typography.small, color: Colors.textSecondary },

  summaryRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  summaryLabel: { ...Typography.small, color: Colors.textSecondary },
  summaryValue: { ...Typography.small, color: Colors.text, fontWeight: "600" },
  summaryTotalRow: { borderTopWidth: 1, borderTopColor: Colors.border, marginTop: Spacing.xs, paddingTop: Spacing.sm },
  summaryTotalLabel: { fontFamily: Fonts.displayBold, fontSize: 15, color: Colors.text },
  summaryTotalValue: { fontFamily: Fonts.display, fontSize: 20, color: Colors.goldDark },

  trackingCourier: { ...Typography.small, color: Colors.secondary, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3 },
  trackingNumber: { fontFamily: Fonts.displayBold, fontSize: 17, color: Colors.text, marginTop: 2 },
  trackingLinkRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2, alignSelf: "flex-start" },
  trackingNumberLink: { color: Colors.secondary, marginTop: 0, textDecorationLine: "underline" },
  trackingMeta: { ...Typography.small, color: Colors.textSecondary, marginTop: 2 },
  customNoteBox: { flexDirection: "row", alignItems: "flex-start", gap: 5, marginTop: Spacing.sm, backgroundColor: Colors.surfaceAlt, borderRadius: BorderRadius.sm, padding: Spacing.sm },
  customNoteText: { fontSize: 11, color: Colors.textMuted, flex: 1, lineHeight: 15 },

  addressName: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.text, marginBottom: 2 },
  addressLine: { ...Typography.small, color: Colors.textSecondary },
  addressMeta: { ...Typography.small, color: Colors.textMuted, marginTop: 4 },

  helper: { ...Typography.small, color: Colors.textSecondary, marginBottom: Spacing.xs },
  fieldBlock: { marginTop: Spacing.md },
  fieldLabel: { fontSize: 12, color: Colors.secondary, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: Spacing.xs },
  courierRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  courierChip: { paddingHorizontal: Spacing.sm, paddingVertical: 7, borderRadius: BorderRadius.pill, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.surfaceAlt },
  courierChipActive: { backgroundColor: Colors.secondary, borderColor: Colors.secondary },
  courierChipText: { ...Typography.small, color: Colors.text, fontWeight: "600" },
  input: {
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 11,
    backgroundColor: Colors.surface,
    color: Colors.text,
    fontSize: 15,
  },
  errorText: { ...Typography.small, color: Colors.danger, marginTop: Spacing.xs },
});
