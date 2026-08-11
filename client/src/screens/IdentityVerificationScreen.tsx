import React from "react";
import { View, StyleSheet, Text, Platform, Alert, Linking } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
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

  const { data: status, refetch } = useQuery<{ status: string; verifiedAt: string | null }>({ queryKey: ["/api/auth/identity/status"] });

  const startMutation = useMutation({
    mutationFn: () => apiJson<{ url: string | null; clientSecret: string }>("POST", "/api/auth/identity/start"),
    onSuccess: (data) => {
      if (data.url) Linking.openURL(data.url);
      else showAlert("Verification started", "Complete verification in the Stripe-hosted flow.");
    },
    onError: (err) => showAlert("Couldn't start verification", err instanceof ApiError ? err.message : "Please try again."),
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
      <Button title="Refresh status" variant="ghost" onPress={() => refetch()} style={{ marginTop: Spacing.sm }} />
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
