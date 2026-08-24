// Real in-app card payment for a Card Hunt entry — same CardField +
// confirmPayment pattern as the marketplace's own custom checkout
// (CheckoutForm.native.tsx), just without an address step since entry
// doesn't ship anything.
import React, { useEffect, useState } from "react";
import { View, StyleSheet, Text, Platform, Alert } from "react-native";
import Constants from "expo-constants";
import { CardField, useConfirmPayment, initStripe, CardFieldInput } from "@stripe/stripe-react-native";
import { Colors, Spacing, Typography, BorderRadius } from "@/constants/theme";
import { Button } from "@/components/ui";
import { apiJson, ApiError } from "@/lib/api";
import { formatPriceCents } from "@/lib/format";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

export function HuntEntryPay({ gameId, priceCents, onPaid }: { gameId: string; priceCents: number; onPaid: () => void }) {
  const { confirmPayment, loading: confirming } = useConfirmPayment();
  const [stripeReady, setStripeReady] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [cardComplete, setCardComplete] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const publishableKey = (Constants.expoConfig?.extra?.STRIPE_PUBLISHABLE_KEY as string) || "";
    initStripe({ publishableKey, urlScheme: "pullmarket" })
      .then(() => setStripeReady(true))
      .catch((err) => console.error("Failed to init Stripe:", err));
  }, []);

  const handlePay = async () => {
    setSubmitting(true);
    try {
      const { clientSecret } = await apiJson<{ clientSecret: string }>("POST", `/api/hunt/${gameId}/enter`, {});
      const { error } = await confirmPayment(clientSecret, { paymentMethodType: "Card" });
      if (error) {
        showAlert("Payment failed", error.message);
        setSubmitting(false);
        return;
      }
      onPaid();
    } catch (err) {
      showAlert("Couldn't enter the hunt", err instanceof ApiError ? err.message : "Please try again.");
      setSubmitting(false);
    }
  };

  if (!expanded) {
    return <Button title={`Enter for ${formatPriceCents(priceCents)}`} onPress={() => setExpanded(true)} style={styles.enterButton} />;
  }

  return (
    <View style={styles.card}>
      <Text style={styles.label}>Card details</Text>
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
      <Button
        title={submitting || confirming ? "Processing…" : `Pay ${formatPriceCents(priceCents)} & enter`}
        onPress={handlePay}
        loading={submitting || confirming}
        disabled={!cardComplete || !stripeReady}
        style={{ marginTop: Spacing.sm }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  enterButton: { marginTop: Spacing.md },
  card: { marginTop: Spacing.md, backgroundColor: Colors.surface, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md },
  label: { ...Typography.small, color: Colors.textSecondary, marginBottom: 6 },
  cardField: { height: 50 },
});
