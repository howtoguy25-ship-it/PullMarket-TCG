import React from "react";
import { View, StyleSheet, Text, ScrollView, Pressable, Platform, Alert, Linking } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import Constants from "expo-constants";
import * as ExpoLinking from "expo-linking";
import { Colors, Spacing, Typography, BorderRadius, Shadow } from "@/constants/theme";
import { Button } from "@/components/ui";
import { StarField } from "@/components/StarField";
import { apiJson, ApiError } from "@/lib/api";
import { formatPriceCents } from "@/lib/format";
import { useApplePurchase } from "@/lib/applePurchase";
import { useAuth } from "@/contexts/AuthContext";

const FEATURES: { icon: React.ComponentProps<typeof Feather>["name"]; label: string }[] = [
  { icon: "smartphone", label: "No app-open ad when you launch PullMarket" },
  { icon: "layout", label: "No banner ad while you browse" },
  { icon: "refresh-cw", label: "Applies instantly on every device you sign into" },
];

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

interface AdsStatus {
  adsRemoved: boolean;
  priceCents: number;
}

const REMOVE_ADS_PRODUCT_ID = (Constants.expoConfig?.extra?.APPLE_IAP_REMOVE_ADS_PRODUCT_ID as string) || "";

export default function RemoveAdsScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { refreshUser } = useAuth();
  const apple = useApplePurchase({ productId: REMOVE_ADS_PRODUCT_ID, type: "in-app", verifyEndpoint: "/api/ads/remove/apple/verify" });

  const { data: status, isLoading } = useQuery<AdsStatus>({ queryKey: ["/api/ads/status"] });

  const checkoutMutation = useMutation({
    mutationFn: () => {
      const returnUrl = Platform.OS === "web" ? `${window.location.origin}/remove-ads-return` : ExpoLinking.createURL("remove-ads-return");
      return apiJson<{ url: string }>("POST", "/api/ads/remove/checkout", { returnUrl });
    },
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (err) => showAlert("Couldn't start checkout", err instanceof ApiError ? err.message : "Please try again."),
  });

  const handleApplePurchase = async () => {
    try {
      await apple.purchase();
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["/api/ads/status"] }), refreshUser()]);
    } catch (err) {
      showAlert("Purchase failed", err instanceof Error ? err.message : "Please try again.");
    }
  };

  const handleAppleRestore = async () => {
    try {
      const restored = await apple.restore();
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["/api/ads/status"] }), refreshUser()]);
      showAlert(restored ? "Restored" : "Nothing to restore", restored ? "Ads have been removed on this account." : "No previous Remove Ads purchase was found on this Apple ID.");
    } catch (err) {
      showAlert("Restore failed", err instanceof Error ? err.message : "Please try again.");
    }
  };

  const webAppUrl = (Constants.expoConfig?.extra?.API_URL as string) || "https://www.pullmarkettcg.com";
  const removed = status?.adsRemoved ?? false;
  const priceLabel = status ? formatPriceCents(status.priceCents) : "$39.99";

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xxl }}>
      <LinearGradient colors={["#0F1B42", "#1E3A8A", "#2A4FB0"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
        <StarField count={18} />
        <View style={styles.heroIcon}>
          <Feather name="slash" size={26} color={Colors.white} />
        </View>
        <Text style={styles.heroTitle}>Remove Ads</Text>
        <Text style={styles.heroPrice}>
          {priceLabel}
          <Text style={styles.heroPriceUnit}> one-time</Text>
        </Text>
        <Text style={styles.heroBody}>Buy once and every app-open ad and banner ad disappears for good — tied to your account, so it carries over to any device you sign in on.</Text>
      </LinearGradient>

      <View style={styles.body}>
        <View style={styles.featureList}>
          {FEATURES.map((f) => (
            <View key={f.label} style={styles.featureRow}>
              <View style={styles.featureIcon}>
                <Feather name={f.icon} size={16} color={Colors.secondary} />
              </View>
              <Text style={styles.featureLabel}>{f.label}</Text>
            </View>
          ))}
        </View>

        {isLoading ? null : removed ? (
          <View style={[styles.statusCard, styles.statusCardSuccess, Shadow.card]}>
            <View style={styles.statusHeader}>
              <Feather name="check-circle" size={18} color={Colors.success} />
              <Text style={styles.statusTitle}>Ads are removed on your account</Text>
            </View>
            <Text style={styles.statusBody}>You won't see app-open or banner ads anymore.</Text>
          </View>
        ) : Platform.OS === "web" ? (
          <Button title={`Buy — ${priceLabel}`} variant="gold" onPress={() => checkoutMutation.mutate()} loading={checkoutMutation.isPending} style={{ marginTop: Spacing.xl }} />
        ) : Platform.OS === "ios" ? (
          apple.available ? (
            <>
              <Button title={`Buy — ${apple.priceLabel ?? priceLabel}`} variant="gold" onPress={() => void handleApplePurchase()} loading={apple.purchasing} style={{ marginTop: Spacing.xl }} />
              <Pressable onPress={() => void handleAppleRestore()} style={styles.restoreLink} disabled={apple.restoring}>
                <Text style={styles.restoreLinkText}>{apple.restoring ? "Restoring…" : "Restore purchase"}</Text>
              </Pressable>
            </>
          ) : (
            <View style={[styles.statusCard, styles.statusCardPending, Shadow.card]}>
              <View style={styles.statusHeader}>
                <Feather name="clock" size={16} color={Colors.goldDark} />
                <Text style={styles.statusTitle}>Not quite ready here yet</Text>
              </View>
              <Text style={styles.statusBody}>Remove Ads isn't available for purchase in this build yet — check back soon.</Text>
            </View>
          )
        ) : (
          <View style={[styles.statusCard, styles.statusCardPending, Shadow.card]}>
            <Text style={styles.statusBody}>Buy Remove Ads from the PullMarket website — it'll apply here too.</Text>
            <Pressable onPress={() => Linking.openURL(webAppUrl)} style={{ marginTop: Spacing.sm }}>
              <Text style={styles.webLink}>{webAppUrl.replace(/^https?:\/\//, "")}</Text>
            </Pressable>
          </View>
        )}

        <Text style={styles.disclaimer}>One-time purchase. Already bought it before? Sign in and it applies automatically — or tap Restore purchase on iOS.</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  hero: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.xl, alignItems: "center" },
  heroIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: "rgba(255,255,255,0.16)", alignItems: "center", justifyContent: "center", marginBottom: Spacing.sm },
  heroTitle: { ...Typography.h1, color: Colors.white },
  heroPrice: { ...Typography.h2, color: Colors.gold, marginTop: Spacing.sm },
  heroPriceUnit: { ...Typography.body, color: "rgba(255,255,255,0.75)" },
  heroBody: { ...Typography.small, color: "rgba(255,255,255,0.85)", textAlign: "center", marginTop: Spacing.sm, maxWidth: 300, lineHeight: 19 },
  body: { padding: Spacing.lg },
  featureList: { gap: Spacing.sm },
  featureRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, backgroundColor: Colors.surface, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, padding: Spacing.sm },
  featureIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: "#E8EDFA", alignItems: "center", justifyContent: "center" },
  featureLabel: { ...Typography.small, color: Colors.text, flex: 1, fontWeight: "600" },
  statusCard: { borderRadius: BorderRadius.lg, borderWidth: 1, padding: Spacing.md, marginTop: Spacing.xl },
  statusCardSuccess: { backgroundColor: "#E9F9F0", borderColor: Colors.success },
  statusCardPending: { backgroundColor: Colors.surfaceAlt, borderColor: Colors.border },
  statusHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusTitle: { ...Typography.bodyBold, color: Colors.text },
  statusBody: { ...Typography.small, color: Colors.textSecondary, marginTop: 4 },
  restoreLink: { alignSelf: "center", marginTop: Spacing.md, padding: Spacing.xs },
  restoreLinkText: { ...Typography.small, color: Colors.secondary, fontWeight: "600" },
  webLink: { ...Typography.small, color: Colors.secondary, fontWeight: "700" },
  disclaimer: { ...Typography.small, color: Colors.textMuted, textAlign: "center", marginTop: Spacing.lg },
});
