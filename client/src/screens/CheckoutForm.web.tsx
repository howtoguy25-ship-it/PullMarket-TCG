// Web never actually renders this — CartScreen routes web checkout through
// the original Stripe-hosted-page flow (@stripe/stripe-react-native has no
// web build at all, so CheckoutForm.native.tsx can't run here). This stub
// only exists so Metro's platform-suffix resolution has a `.web.tsx` to
// pick instead of ever touching the `.native.tsx` file, which statically
// imports React Native internals that fail to even resolve on web.
import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Colors, Spacing, Typography } from "@/constants/theme";

export default function CheckoutForm() {
  return (
    <View style={styles.center}>
      <Text style={styles.text}>Checkout isn't available here — use the Pay Now button on your cart.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: Colors.background, paddingHorizontal: Spacing.xl },
  text: { ...Typography.body, color: Colors.textSecondary, textAlign: "center" },
});
