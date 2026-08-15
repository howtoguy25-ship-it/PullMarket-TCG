// The app's own custom checkout UI — an address form plus Stripe's native
// CardField component, styled to match the rest of the app, confirmed
// directly via confirmPayment. No redirect to any Stripe-hosted page.
//
// This file statically imports @stripe/stripe-react-native, a native-only
// SDK with no web build — that's safe ONLY because this file itself is
// never statically imported anywhere. CheckoutScreen.tsx loads it via a
// dynamic import() gated to native, so Metro code-splits it into a chunk
// the web bundle never evaluates (same pattern already used for
// react-native-webrtc and react-native-incall-manager elsewhere in the
// calling feature).
import React, { useEffect, useState } from "react";
import { View, StyleSheet, Text, ScrollView, Pressable, Platform, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import { Feather } from "@expo/vector-icons";
import { CardField, useConfirmPayment, initStripe, CardFieldInput, AddressSheet, AddressSheetError } from "@stripe/stripe-react-native";
import type { AddressDetails } from "@stripe/stripe-react-native";
import { Colors, Spacing, Typography, BorderRadius, Shadow } from "@/constants/theme";
import { Button } from "@/components/ui";
import { RootStackParamList } from "@/navigation/types";
import { apiJson, ApiError } from "@/lib/api";
import { formatPriceCents } from "@/lib/format";
import { SHIPPING_COUNTRIES, SHIPPING_COUNTRY_LABELS } from "@shared/validation";

type Nav = NativeStackNavigationProp<RootStackParamList, "Checkout">;
type Rt = RouteProp<RootStackParamList, "Checkout">;

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

interface CartItem {
  id: string;
  title: string;
  priceCents: number;
  quantity: number;
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

export default function CheckoutForm() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const { sellerId } = route.params;
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const queryClient = useQueryClient();
  const { confirmPayment, loading: confirming } = useConfirmPayment();

  const [stripeReady, setStripeReady] = useState(false);
  useEffect(() => {
    const publishableKey = (Constants.expoConfig?.extra?.STRIPE_PUBLISHABLE_KEY as string) || "";
    initStripe({ publishableKey, urlScheme: "pullmarket" })
      .then(() => setStripeReady(true))
      .catch((err) => console.error("Failed to init Stripe:", err));
  }, []);

  const { data: cart, isLoading } = useQuery<CartResponse>({ queryKey: ["/api/cart"] });
  const group = cart?.groups.find((g) => g.sellerId === sellerId);

  const [addressSheetVisible, setAddressSheetVisible] = useState(false);
  const [address, setAddress] = useState<AddressDetails | null>(null);
  const [cardComplete, setCardComplete] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const addressComplete = !!(address?.name?.trim() && address.address?.line1?.trim() && address.address?.city?.trim() && address.address?.postalCode?.trim() && address.address?.country?.trim() && address.phone?.trim());
  const canPay = addressComplete && cardComplete && stripeReady && !!group;

  const handlePay = async () => {
    if (!group || !address?.address) return;
    setSubmitting(true);
    try {
      const { orderId, clientSecret } = await apiJson<{ orderId: string; clientSecret: string }>("POST", "/api/checkout/intent", {
        sellerId,
        shippingName: address.name!.trim(),
        shippingLine1: address.address.line1!.trim(),
        shippingLine2: address.address.line2?.trim() || undefined,
        shippingCity: address.address.city!.trim(),
        shippingState: address.address.state?.trim() || "",
        shippingPostalCode: address.address.postalCode!.trim(),
        shippingCountry: address.address.country!,
        shippingPhone: address.phone!.trim(),
      });

      const { error } = await confirmPayment(clientSecret, {
        paymentMethodType: "Card",
        paymentMethodData: { billingDetails: { name: address.name!.trim(), address: { country: address.address.country } } },
      });

      if (error) {
        showAlert("Payment failed", error.message);
        setSubmitting(false);
        return;
      }

      queryClient.invalidateQueries({ queryKey: ["/api/cart"] });
      navigation.replace("CheckoutReturn", { status: "success", order: orderId });
    } catch (err) {
      showAlert("Couldn't complete checkout", err instanceof ApiError ? err.message : "Please try again.");
      setSubmitting(false);
    }
  };

  if (isLoading || !group) {
    return (
      <View style={[styles.container, { paddingTop: headerHeight, alignItems: "center", justifyContent: "center" }]}>
        <Text style={styles.loading}>{isLoading ? "Loading…" : "Nothing to check out from this seller."}</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: Spacing.lg, paddingTop: headerHeight + Spacing.md, paddingBottom: insets.bottom + Spacing.xl }}>
      <Text style={styles.title}>Checkout</Text>
      <Text style={styles.subtitle}>Sold by @{group.seller?.username ?? "seller"}</Text>

      <View style={[styles.card, Shadow.card]}>
        <Text style={styles.sectionTitle}>Delivery address</Text>
        {address?.address ? (
          <View style={styles.addressDisplay}>
            <View style={styles.addressDisplayRow}>
              <Feather name="map-pin" size={16} color={Colors.primary} style={{ marginTop: 2 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.addressName}>{address.name}</Text>
                <Text style={styles.addressLine}>{address.address.line1}</Text>
                {address.address.line2 ? <Text style={styles.addressLine}>{address.address.line2}</Text> : null}
                <Text style={styles.addressLine}>
                  {[address.address.city, address.address.state, address.address.postalCode].filter(Boolean).join(", ")}
                </Text>
                <Text style={styles.addressLine}>{SHIPPING_COUNTRY_LABELS[address.address.country ?? ""] ?? address.address.country}</Text>
                {address.phone ? <Text style={styles.addressPhone}>{address.phone}</Text> : null}
              </View>
            </View>
            <Pressable style={styles.editAddressBtn} onPress={() => setAddressSheetVisible(true)}>
              <Feather name="edit-2" size={13} color={Colors.primary} />
              <Text style={styles.editAddressText}>Edit address</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable style={styles.addAddressBtn} onPress={() => setAddressSheetVisible(true)}>
            <Feather name="search" size={16} color={Colors.primary} />
            <Text style={styles.addAddressText}>Search for your delivery address</Text>
          </Pressable>
        )}
        <Text style={styles.addressHint}>Start typing to search real addresses — pick one from the list so we can confirm it's correct before you pay.</Text>
      </View>

      <AddressSheet
        visible={addressSheetVisible}
        onSubmit={(result) => {
          setAddress(result);
          setAddressSheetVisible(false);
        }}
        onError={(err) => {
          setAddressSheetVisible(false);
          if (err.code !== AddressSheetError.Canceled) {
            showAlert("Couldn't save address", err.message);
          }
        }}
        defaultValues={address ?? { address: { country: "AU" } }}
        additionalFields={{ phoneNumber: "required" }}
        allowedCountries={[...SHIPPING_COUNTRIES]}
        autocompleteCountries={[...SHIPPING_COUNTRIES]}
        googlePlacesApiKey={(Constants.expoConfig?.extra?.GOOGLE_PLACES_API_KEY as string) || undefined}
        appearance={{
          colors: {
            primary: Colors.primary,
            background: Colors.background,
            componentBackground: Colors.surface,
            componentBorder: Colors.border,
            componentText: Colors.text,
            primaryText: Colors.text,
            secondaryText: Colors.textSecondary,
            placeholderText: Colors.textMuted,
          },
        }}
      />

      <View style={[styles.card, Shadow.card]}>
        <Text style={styles.sectionTitle}>Payment</Text>
        <CardField
          postalCodeEnabled={false}
          placeholders={{ number: "4242 4242 4242 4242" }}
          cardStyle={{
            backgroundColor: Colors.surface,
            textColor: Colors.text,
            placeholderColor: Colors.textMuted,
            borderColor: Colors.border,
            borderWidth: 1.5,
            borderRadius: BorderRadius.md,
            fontSize: 15,
          }}
          style={styles.cardField}
          onCardChange={(details: CardFieldInput.Details) => setCardComplete(details.complete)}
        />
      </View>

      <View style={[styles.card, Shadow.card]}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Subtotal</Text>
          <Text style={styles.summaryValue}>{formatPriceCents(group.subtotalCents)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Platform fee</Text>
          <Text style={styles.summaryValue}>{formatPriceCents(group.platformFeeCents)}</Text>
        </View>
        <View style={[styles.summaryRow, styles.totalRow]}>
          <Text style={styles.summaryTotalLabel}>Total</Text>
          <Text style={styles.summaryTotalValue}>{formatPriceCents(group.totalCents)}</Text>
        </View>
      </View>

      <Button
        title={submitting || confirming ? "Processing…" : `Pay ${formatPriceCents(group.totalCents)}`}
        onPress={handlePay}
        loading={submitting || confirming}
        disabled={!canPay}
        style={{ marginTop: Spacing.lg }}
      />
      <Text style={styles.secureNote}>Payments are processed securely by Stripe. Your card details never touch PullMarket's servers.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loading: { ...Typography.body, color: Colors.textSecondary },
  title: { ...Typography.h2, color: Colors.text },
  subtitle: { ...Typography.small, color: Colors.textSecondary, marginTop: 2, marginBottom: Spacing.md },
  card: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, marginBottom: Spacing.md, gap: Spacing.sm },
  sectionTitle: { ...Typography.bodyBold, color: Colors.text, marginBottom: 2 },
  addAddressBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderStyle: "dashed",
    borderRadius: BorderRadius.md,
    paddingVertical: 14,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.surfaceAlt,
  },
  addAddressText: { ...Typography.body, color: Colors.primary, fontWeight: "600" },
  addressDisplay: { backgroundColor: Colors.surfaceAlt, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, gap: Spacing.sm },
  addressDisplayRow: { flexDirection: "row", gap: Spacing.sm },
  addressName: { ...Typography.bodyBold, color: Colors.text, marginBottom: 2 },
  addressLine: { ...Typography.small, color: Colors.textSecondary, lineHeight: 19 },
  addressPhone: { ...Typography.small, color: Colors.textMuted, marginTop: 4 },
  editAddressBtn: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" },
  editAddressText: { ...Typography.small, color: Colors.primary, fontWeight: "600" },
  addressHint: { ...Typography.small, color: Colors.textMuted, fontSize: 12, marginTop: 2 },
  cardField: { height: 50, marginTop: Spacing.xs },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  summaryLabel: { ...Typography.small, color: Colors.textSecondary },
  summaryValue: { ...Typography.small, color: Colors.text },
  totalRow: { borderTopWidth: 1, borderTopColor: Colors.border, marginTop: Spacing.xs, paddingTop: Spacing.sm },
  summaryTotalLabel: { ...Typography.bodyBold, color: Colors.text },
  summaryTotalValue: { ...Typography.bodyBold, color: Colors.primary, fontSize: 17 },
  secureNote: { ...Typography.small, color: Colors.textMuted, textAlign: "center", marginTop: Spacing.md },
});
