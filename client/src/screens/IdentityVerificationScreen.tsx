import React from "react";
import { View, StyleSheet, Text, Platform, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { Colors, Spacing, Typography } from "@/constants/theme";
import { Button, Badge } from "@/components/ui";
import { apiJson, ApiError } from "@/lib/api";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

export default function IdentityVerificationScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();

  const { data: status, refetch, isFetching } = useQuery<{ status: string; verifiedAt: string | null }>({ queryKey: ["/api/auth/identity/status"] });

  const startMutation = useMutation({
    mutationFn: () => {
      const returnUrl = Linking.createURL("identity-verification");
      return apiJson<{ url: string | null; clientSecret: string }>("POST", "/api/auth/identity/start", { returnUrl });
    },
    onSuccess: async (data) => {
      if (!data.url) {
        showAlert("Verification started", "Complete verification in the Stripe-hosted flow.");
        return;
      }
      // Handing this off with Linking.openURL used to open a new browser
      // tab on web — one more tab competing for memory with however many
      // others the user already had open, and the flow would get silently
      // reloaded mid-way by the browser reclaiming that memory right as the
      // user was finishing it. Same-tab navigation on web, and an isolated
      // in-app auth session on native (same pattern Stripe Checkout already
      // uses), both close the loop back to this screen when done.
      if (Platform.OS === "web") {
        window.location.href = data.url;
      } else {
        await WebBrowser.openAuthSessionAsync(data.url, Linking.createURL("identity-verification"));
        void refetch();
      }
    },
    onError: (err) => {
      const message = err instanceof ApiError ? err.message : "Please try again.";
      const detail = err instanceof ApiError ? err.detail : undefined;
      showAlert("Couldn't start verification", detail ? `${message}\n\n${detail}` : message);
    },
  });

  const verified = status?.status === "verified";
  const pending = status?.status === "pending";
  const failed = status?.status === "failed";

  const badge = verified
    ? { label: "Verified", color: Colors.success }
    : pending
      ? { label: "Pending review", color: Colors.warning }
      : failed
        ? { label: "Verification failed", color: Colors.danger }
        : { label: "Not verified", color: Colors.warning };

  return (
    <View style={[styles.container, { paddingTop: headerHeight + Spacing.lg, paddingBottom: insets.bottom + Spacing.xl }]}>
      {verified || failed ? (
        <View style={[styles.iconCircle, { backgroundColor: verified ? Colors.success : Colors.danger }]}>
          <Feather name={verified ? "check" : "x"} size={32} color={Colors.white} />
        </View>
      ) : (
        <LinearGradient colors={[Colors.primary, Colors.goldDark]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.iconCircle}>
          <Feather name="shield" size={32} color={Colors.white} />
        </LinearGradient>
      )}
      <Text style={styles.title}>Identity verification</Text>
      <Text style={styles.subtitle}>
        {failed
          ? "We couldn't verify your identity. Double-check your ID is valid and unexpired, then try again in good lighting."
          : "To keep the marketplace safe, we verify sellers with Stripe Identity — a government ID scan and a live selfie match, plus your name, address, and date of birth. This helps prevent fraud and protects buyers."}
      </Text>

      <View style={styles.statusRow}>
        <Badge label={badge.label} color={badge.color} />
      </View>

      {!verified && !pending ? (
        <Button title={failed ? "Try verification again" : "Start verification"} onPress={() => startMutation.mutate()} loading={startMutation.isPending} style={{ marginTop: Spacing.lg }} />
      ) : null}
      <Button
        title={isFetching ? "Checking…" : "Refresh status"}
        variant="ghost"
        icon={<Feather name="refresh-cw" size={15} color={Colors.primary} />}
        onPress={() => refetch()}
        disabled={isFetching}
        style={{ marginTop: Spacing.sm }}
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
});
