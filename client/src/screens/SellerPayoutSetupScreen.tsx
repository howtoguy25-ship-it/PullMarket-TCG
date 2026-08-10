import React from "react";
import { View, StyleSheet, Text, Platform, Alert, Linking } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { Colors, Spacing, Typography } from "@/constants/theme";
import { Button, Badge } from "@/components/ui";
import { apiJson, ApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

export default function SellerPayoutSetupScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  useAuth();

  const { data: status, refetch } = useQuery<{ onboarded: boolean; payoutsEnabled: boolean }>({ queryKey: ["/api/checkout/connect/status"] });

  const onboardMutation = useMutation({
    mutationFn: () => apiJson<{ url: string }>("POST", "/api/checkout/connect/onboard"),
    onSuccess: (data) => {
      Linking.openURL(data.url);
    },
    onError: (err) => showAlert("Couldn't start payout setup", err instanceof ApiError ? err.message : "Please try again."),
  });

  return (
    <View style={[styles.container, { paddingTop: headerHeight + Spacing.lg, paddingBottom: insets.bottom + Spacing.xl }]}>
      <View style={styles.iconCircle}>
        <Feather name="credit-card" size={32} color={Colors.white} />
      </View>
      <Text style={styles.title}>Get paid for your sales</Text>
      <Text style={styles.subtitle}>
        PullMarket uses Stripe to send your earnings straight to your bank account. Stripe automatically transfers your payout as soon as a sale is paid for, minus our small platform fee.
      </Text>

      <View style={styles.statusRow}>
        <Badge label={status?.payoutsEnabled ? "Payouts enabled" : status?.onboarded ? "Setup in progress" : "Not set up"} color={status?.payoutsEnabled ? Colors.success : Colors.warning} />
      </View>

      <Button title={status?.onboarded ? "Continue setup with Stripe" : "Set up payouts with Stripe"} onPress={() => onboardMutation.mutate()} loading={onboardMutation.isPending} style={{ marginTop: Spacing.lg }} />
      <Button title="Refresh status" variant="ghost" onPress={() => refetch()} style={{ marginTop: Spacing.sm }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, alignItems: "center", paddingHorizontal: Spacing.xl },
  iconCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.secondary, alignItems: "center", justifyContent: "center", marginBottom: Spacing.lg },
  title: { ...Typography.h2, color: Colors.text, textAlign: "center" },
  subtitle: { ...Typography.body, color: Colors.textSecondary, textAlign: "center", marginTop: Spacing.sm },
  statusRow: { marginTop: Spacing.lg },
});
