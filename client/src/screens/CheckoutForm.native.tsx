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
import { View, StyleSheet, Text, ScrollView, TextInput, Pressable, Modal, Platform, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import { Feather } from "@expo/vector-icons";
import { CardField, useConfirmPayment, initStripe, CardFieldInput } from "@stripe/stripe-react-native";
import { Colors, Spacing, Typography, BorderRadius, Shadow } from "@/constants/theme";
import { Button } from "@/components/ui";
import { RootStackParamList } from "@/navigation/types";
import { apiJson, ApiError } from "@/lib/api";
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

function CountryPicker({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable style={[styles.input, styles.countryField]} onPress={() => setOpen(true)}>
        <Text style={styles.countryFieldText}>{SHIPPING_COUNTRY_LABELS[value] ?? value}</Text>
        <Feather name="chevron-down" size={16} color={Colors.textMuted} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Delivery country</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {SHIPPING_COUNTRIES.map((code) => (
                <Pressable
                  key={code}
                  style={[styles.countryOption, value === code && styles.countryOptionActive]}
                  onPress={() => {
                    onChange(code);
                    setOpen(false);
                  }}
                >
                  <Text style={[styles.countryOptionText, value === code && { color: Colors.primary, fontWeight: "700" }]}>{SHIPPING_COUNTRY_LABELS[code] ?? code}</Text>
                  {value === code ? <Feather name="check" size={16} color={Colors.primary} /> : null}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </>
  );
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

  const [name, setName] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [stateField, setStateField] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("AU");
  const [phone, setPhone] = useState("");
  const [cardComplete, setCardComplete] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const addressComplete = !!(name.trim() && line1.trim() && city.trim() && stateField.trim() && postalCode.trim() && phone.trim());
  const canPay = addressComplete && cardComplete && stripeReady && !!group;

  const handlePay = async () => {
    if (!group) return;
    setSubmitting(true);
    try {
      const { orderId, clientSecret } = await apiJson<{ orderId: string; clientSecret: string }>("POST", "/api/checkout/intent", {
        sellerId,
        shippingName: name.trim(),
        shippingLine1: line1.trim(),
        shippingLine2: line2.trim() || undefined,
        shippingCity: city.trim(),
        shippingState: stateField.trim(),
        shippingPostalCode: postalCode.trim(),
        shippingCountry: country,
        shippingPhone: phone.trim(),
      });

      const { error } = await confirmPayment(clientSecret, {
        paymentMethodType: "Card",
        paymentMethodData: { billingDetails: { name: name.trim(), address: { country } } },
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
        <TextInput style={styles.input} placeholder="Full name" placeholderTextColor={Colors.textMuted} value={name} onChangeText={setName} />
        <TextInput style={styles.input} placeholder="Address line 1" placeholderTextColor={Colors.textMuted} value={line1} onChangeText={setLine1} />
        <TextInput style={styles.input} placeholder="Address line 2 (optional)" placeholderTextColor={Colors.textMuted} value={line2} onChangeText={setLine2} />
        <View style={styles.row}>
          <TextInput style={[styles.input, styles.rowInput]} placeholder="City" placeholderTextColor={Colors.textMuted} value={city} onChangeText={setCity} />
          <TextInput style={[styles.input, styles.rowInput]} placeholder="State" placeholderTextColor={Colors.textMuted} value={stateField} onChangeText={setStateField} />
        </View>
        <View style={styles.row}>
          <TextInput
            style={[styles.input, styles.rowInput]}
            placeholder="Postcode"
            placeholderTextColor={Colors.textMuted}
            value={postalCode}
            onChangeText={setPostalCode}
            keyboardType="number-pad"
          />
          <View style={styles.rowInput}>
            <CountryPicker value={country} onChange={setCountry} />
          </View>
        </View>
        <TextInput style={styles.input} placeholder="Phone number" placeholderTextColor={Colors.textMuted} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      </View>

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
          <Text style={styles.summaryValue}>${(group.subtotalCents / 100).toFixed(2)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Platform fee</Text>
          <Text style={styles.summaryValue}>${(group.platformFeeCents / 100).toFixed(2)}</Text>
        </View>
        <View style={[styles.summaryRow, styles.totalRow]}>
          <Text style={styles.summaryTotalLabel}>Total</Text>
          <Text style={styles.summaryTotalValue}>${(group.totalCents / 100).toFixed(2)}</Text>
        </View>
      </View>

      <Button
        title={submitting || confirming ? "Processing…" : `Pay $${(group.totalCents / 100).toFixed(2)}`}
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
  input: { borderWidth: 1.5, borderColor: Colors.border, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.md, paddingVertical: 11, backgroundColor: Colors.surface, color: Colors.text, fontSize: 15 },
  row: { flexDirection: "row", gap: Spacing.sm },
  rowInput: { flex: 1 },
  countryField: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  countryFieldText: { fontSize: 15, color: Colors.text },
  cardField: { height: 50, marginTop: Spacing.xs },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  summaryLabel: { ...Typography.small, color: Colors.textSecondary },
  summaryValue: { ...Typography.small, color: Colors.text },
  totalRow: { borderTopWidth: 1, borderTopColor: Colors.border, marginTop: Spacing.xs, paddingTop: Spacing.sm },
  summaryTotalLabel: { ...Typography.bodyBold, color: Colors.text },
  summaryTotalValue: { ...Typography.bodyBold, color: Colors.primary, fontSize: 17 },
  secureNote: { ...Typography.small, color: Colors.textMuted, textAlign: "center", marginTop: Spacing.md },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center", padding: Spacing.xl },
  modalCard: { backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.md, width: "100%", maxWidth: 360 },
  modalTitle: { ...Typography.bodyBold, color: Colors.text, marginBottom: Spacing.sm, paddingHorizontal: Spacing.xs },
  countryOption: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, paddingHorizontal: Spacing.xs, borderRadius: BorderRadius.sm },
  countryOptionActive: { backgroundColor: Colors.surfaceAlt },
  countryOptionText: { fontSize: 15, color: Colors.text },
});
