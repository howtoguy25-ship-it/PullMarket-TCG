import React from "react";
import { View, StyleSheet, Text, ScrollView, Pressable, Platform, Alert, Linking } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import Constants from "expo-constants";
import * as ExpoLinking from "expo-linking";
import { Colors, Spacing, Typography, BorderRadius, Shadow } from "@/constants/theme";
import { Button } from "@/components/ui";
import { apiJson, ApiError } from "@/lib/api";
import { useApplePurchase } from "@/lib/applePurchase";

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
  const headerHeight = useHeaderHeight();
  const queryClient = useQueryClient();
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
      await queryClient.invalidateQueries({ queryKey: ["/api/ads/status"] });
    } catch (err) {
      showAlert("Purchase failed", err instanceof Error ? err.message : "Please try again.");
    }
  };

  const handleAppleRestore = async () => {
    try {
      const restored = await apple.restore();
      await queryClient.invalidateQueries({ queryKey: ["/api/ads/status"] });
      showAlert(restored ? "Restored" : "Nothing to restore", restored ? "Ads have been removed on this account." : "No previous Remove Ads purchase was found on this Apple ID.");
    } catch (err) {
      showAlert("Restore failed", err instanceof Error ? err.message : "Please try again.");
    }
  };

  const webAppUrl = (Constants.expoConfig?.extra?.API_URL as string) || "https://www.pullmarkettcg.com";
  const removed = status?.adsRemoved ?? false;
  const priceLabel = status ? `$${(status.priceCents / 100).toFixed(2)}` : "$39.99";

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingTop: headerHeight + Spacing.lg, paddingBottom: insets.bottom + Spacing.xl, paddingHorizontal: Spacing.lg }}>
      <View style={styles.heroRow}>
        <View style={styles.heroIcon}>
          <Feather name="slash" size={22} color={Colors.white} />
        </View>
        <Text style={styles.heroTitle}>Remove Ads</Text>
      </View>
      <Text style={styles.heroPrice}>
        {priceLabel}
        <Text style={styles.heroPriceUnit}> one-time</Text>
      </Text>
      <Text style={styles.heroBody}>Buy once and every app-open ad and banner ad disappears for good — tied to your account, so it carries over to any device you sign in on.</Text>

      {isLoading ? null : removed ? (
        <View style={[styles.statusCard, Shadow.card]}>
          <View style={styles.statusHeader}>
            <Feather name="check-circle" size={18} color={Colors.success} />
            <Text style={styles.statusTitle}>Ads are removed on your account</Text>
          </View>
          <Text style={styles.statusBody}>You won't see app-open or banner ads anymore.</Text>
        </View>
      ) : Platform.OS === "web" ? (
        <Button title={`Buy — ${priceLabel}`} onPress={() => checkoutMutation.mutate()} loading={checkoutMutation.isPending} style={{ marginTop: Spacing.lg }} />
      ) : Platform.OS === "ios" ? (
        apple.available ? (
          <>
            <Button title={`Buy — ${apple.priceLabel ?? priceLabel}`} onPress={() => void handleApplePurchase()} loading={apple.purchasing} style={{ marginTop: Spacing.lg }} />
            <Pressable onPress={() => void handleAppleRestore()} style={styles.restoreLink} disabled={apple.restoring}>
              <Text style={styles.restoreLinkText}>{apple.restoring ? "Restoring…" : "Restore purchase"}</Text>
            </Pressable>
          </>
        ) : (
          <View style={[styles.statusCard, Shadow.card]}>
            <Text style={styles.statusBody}>Remove Ads isn't available for purchase here yet — check back soon.</Text>
          </View>
        )
      ) : (
        <View style={[styles.statusCard, Shadow.card]}>
          <Text style={styles.statusBody}>Buy Remove Ads from the PullMarket website — it'll apply here too.</Text>
          <Pressable onPress={() => Linking.openURL(webAppUrl)} style={{ marginTop: Spacing.sm }}>
            <Text style={styles.webLink}>{webAppUrl.replace(/^https?:\/\//, "")}</Text>
          </Pressable>
        </View>
      )}

      <Text style={styles.disclaimer}>One-time purchase. Already bought it before? Sign in and it applies automatically — or tap Restore purchase on iOS.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  heroRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  heroIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.secondary, alignItems: "center", justifyContent: "center" },
  heroTitle: { ...Typography.h1, color: Colors.text },
  heroPrice: { ...Typography.h2, color: Colors.primary, marginTop: Spacing.sm },
  heroPriceUnit: { ...Typography.body, color: Colors.textSecondary },
  heroBody: { ...Typography.body, color: Colors.textSecondary, marginTop: Spacing.sm },
  statusCard: { backgroundColor: Colors.surfaceAlt, borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, marginTop: Spacing.lg },
  statusHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusTitle: { ...Typography.bodyBold, color: Colors.text },
  statusBody: { ...Typography.small, color: Colors.textSecondary, marginTop: 4 },
  restoreLink: { alignSelf: "center", marginTop: Spacing.md, padding: Spacing.xs },
  restoreLinkText: { ...Typography.small, color: Colors.primary, fontWeight: "600" },
  webLink: { ...Typography.small, color: Colors.primary, fontWeight: "700" },
  disclaimer: { ...Typography.small, color: Colors.textMuted, textAlign: "center", marginTop: Spacing.lg },
});
