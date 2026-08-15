import React from "react";
import { View, StyleSheet, Text, Platform, Alert, Linking } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Colors, Spacing, Typography, BorderRadius, Fonts, Shadow } from "@/constants/theme";
import { Button, Badge } from "@/components/ui";
import { apiJson, ApiError } from "@/lib/api";
import { formatPriceCents } from "@/lib/format";
import { useAuth } from "@/contexts/AuthContext";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

function confirmAsync(title: string, message: string, confirmLabel: string): Promise<boolean> {
  if (Platform.OS === "web") return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: confirmLabel, style: "destructive", onPress: () => resolve(true) },
    ]);
  });
}

function formatMoney(cents: number, currency: string | null) {
  if (currency && currency !== "USD") return formatPriceCents(cents, `${currency} `);
  return formatPriceCents(cents);
}

interface ConnectStatus {
  onboarded: boolean;
  payoutsEnabled: boolean;
  availableCents: number;
  pendingCents: number;
  currency: string | null;
}

export default function SellerPayoutSetupScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { refreshUser } = useAuth();
  const queryClient = useQueryClient();

  const { data: status, refetch, isFetching } = useQuery<ConnectStatus>({ queryKey: ["/api/checkout/connect/status"], refetchInterval: 30_000 });

  const onboardMutation = useMutation({
    mutationFn: () => apiJson<{ url: string }>("POST", "/api/checkout/connect/onboard"),
    onSuccess: (data) => {
      Linking.openURL(data.url);
    },
    onError: (err) => showAlert("Couldn't start payout setup", err instanceof ApiError ? err.message : "Please try again."),
  });

  const disconnectMutation = useMutation({
    mutationFn: () => apiJson("POST", "/api/checkout/connect/disconnect"),
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["/api/checkout/connect/status"] }), refreshUser()]);
    },
    onError: (err) => showAlert("Couldn't disconnect", err instanceof ApiError ? err.message : "Please try again."),
  });

  const handleDisconnect = async () => {
    const ok = await confirmAsync(
      "Log out of this payout account?",
      "This unlinks your connected Stripe account from PullMarket — it doesn't close your Stripe account or affect money already paid out. You won't be able to receive new sale proceeds until you connect a payout account again.",
      "Log out",
    );
    if (ok) disconnectMutation.mutate();
  };

  const handleAddNewAccount = async () => {
    const ok = await confirmAsync(
      "Add a new payout account?",
      "This logs out of your current payout account first, then opens Stripe so you can connect a different one.",
      "Continue",
    );
    if (!ok) return;
    await disconnectMutation.mutateAsync();
    onboardMutation.mutate();
  };

  const switching = disconnectMutation.isPending || onboardMutation.isPending;

  return (
    <View style={[styles.container, { paddingTop: headerHeight + Spacing.lg, paddingBottom: insets.bottom + Spacing.xl }]}>
      {status?.payoutsEnabled ? (
        <View style={[styles.iconCircle, { backgroundColor: Colors.success }]}>
          <Feather name="check" size={32} color={Colors.white} />
        </View>
      ) : (
        <LinearGradient colors={[Colors.primary, Colors.goldDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.iconCircle}>
          <Feather name="credit-card" size={32} color={Colors.white} />
        </LinearGradient>
      )}
      <Text style={styles.title}>Get paid for your sales</Text>
      <Text style={styles.subtitle}>
        PullMarket uses Stripe to send your earnings straight to your bank account. Stripe automatically transfers your payout as soon as a sale is paid for, minus our small platform fee.
      </Text>

      <View style={styles.statusRow}>
        <Badge label={status?.payoutsEnabled ? "Payouts enabled" : status?.onboarded ? "Setup in progress" : "Not set up"} color={status?.payoutsEnabled ? Colors.success : Colors.warning} />
      </View>

      {status?.payoutsEnabled ? (
        <View style={styles.balanceCard}>
          <View style={styles.balanceStat}>
            <Text style={styles.balanceLabel}>Available</Text>
            <Text style={styles.balanceAmount}>{formatMoney(status.availableCents, status.currency)}</Text>
          </View>
          <View style={styles.balanceDivider} />
          <View style={styles.balanceStat}>
            <Text style={styles.balanceLabel}>Pending</Text>
            <Text style={[styles.balanceAmount, styles.balanceAmountMuted]}>{formatMoney(status.pendingCents, status.currency)}</Text>
          </View>
        </View>
      ) : null}

      {!status?.payoutsEnabled ? (
        <Button
          title={status?.onboarded ? "Continue setup with Stripe" : "Add payout account"}
          icon={<Feather name={status?.onboarded ? "arrow-right-circle" : "plus-circle"} size={16} color={Colors.white} />}
          onPress={() => onboardMutation.mutate()}
          loading={onboardMutation.isPending}
          style={{ marginTop: Spacing.lg, width: "100%" }}
        />
      ) : (
        <View style={styles.connectedActions}>
          <Button
            title="Add new payout account"
            variant="secondary"
            icon={<Feather name="plus-circle" size={16} color={Colors.white} />}
            onPress={() => void handleAddNewAccount()}
            loading={switching}
            style={{ width: "100%" }}
          />
          <Button
            title="Log out of payout account"
            variant="outline"
            icon={<Feather name="log-out" size={16} color={Colors.danger} />}
            textColor={Colors.danger}
            onPress={() => void handleDisconnect()}
            loading={disconnectMutation.isPending}
            style={styles.logoutButton}
          />
        </View>
      )}

      <Button
        title={isFetching ? "Checking…" : "Refresh status"}
        variant="outline"
        icon={<Feather name="refresh-cw" size={15} color={Colors.secondary} />}
        textColor={Colors.secondary}
        onPress={() => refetch()}
        disabled={isFetching}
        style={styles.refreshButton}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, alignItems: "center", paddingHorizontal: Spacing.xl },
  iconCircle: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", marginBottom: Spacing.lg },
  title: { ...Typography.h2, color: Colors.text, textAlign: "center" },
  subtitle: { ...Typography.body, color: Colors.textSecondary, textAlign: "center", marginTop: Spacing.sm },
  statusRow: { marginTop: Spacing.lg },
  balanceCard: {
    flexDirection: "row",
    width: "100%",
    marginTop: Spacing.lg,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: Spacing.lg,
    ...Shadow.card,
  },
  balanceStat: { flex: 1, alignItems: "center", gap: 4 },
  balanceDivider: { width: StyleSheet.hairlineWidth, backgroundColor: Colors.border },
  balanceLabel: { ...Typography.small, color: Colors.textSecondary, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  balanceAmount: { fontFamily: Fonts.display, fontSize: 26, color: Colors.success },
  balanceAmountMuted: { color: Colors.textSecondary },
  connectedActions: { width: "100%", gap: Spacing.sm, marginTop: Spacing.lg },
  logoutButton: { width: "100%", borderColor: Colors.danger, backgroundColor: Colors.danger + "0D" },
  refreshButton: { width: "100%", marginTop: Spacing.md, borderColor: Colors.secondary, backgroundColor: Colors.secondary + "0D" },
});
