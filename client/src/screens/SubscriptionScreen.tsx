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
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { apiJson, ApiError } from "@/lib/api";
import { useApplePurchase } from "@/lib/applePurchase";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

interface SubscriptionStatus {
  active: boolean;
  proStatus: "none" | "active" | "past_due" | "canceled";
  proSource: "stripe" | "apple" | null;
  proCurrentPeriodEnd: string | null;
  proCancelAtPeriodEnd: boolean;
  priceCents: number;
}

const PERKS: { icon: keyof typeof Feather.glyphMap; title: string; body: string }[] = [
  { icon: "users", title: "Followers", body: "Unlock a real Follow button on your profile — anyone can follow you, and you get a Followers tab to see who's following you, with a handshake icon for followers who are also your friends." },
  { icon: "check-circle", title: "Verified tick", body: "A green tick appears next to your username everywhere it shows up — your profile, search results, and chats." },
  { icon: "trending-up", title: "48h listing boost", body: "Every new listing you publish gets pinned near the top of the homepage feed for its first 48 hours." },
  { icon: "search", title: "Search recognition", body: "When someone's typing a name or card search that matches you or your listing, you get a little extra prominence among equally-relevant results." },
];

const PRO_PRODUCT_ID = (Constants.expoConfig?.extra?.APPLE_IAP_PRODUCT_ID as string) || "";

export default function SubscriptionScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const apple = useApplePurchase({ productId: PRO_PRODUCT_ID, type: "subs", verifyEndpoint: "/api/subscription/apple/verify" });

  const { data: status, isLoading } = useQuery<SubscriptionStatus>({ queryKey: ["/api/subscription/status"] });

  const checkoutMutation = useMutation({
    mutationFn: () => {
      const returnUrl = Platform.OS === "web" ? `${window.location.origin}/subscription-return` : ExpoLinking.createURL("subscription-return");
      return apiJson<{ url: string }>("POST", "/api/subscription/checkout", { returnUrl });
    },
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (err) => showAlert("Couldn't start checkout", err instanceof ApiError ? err.message : "Please try again."),
  });

  const portalMutation = useMutation({
    mutationFn: () => apiJson<{ url: string }>("POST", "/api/subscription/portal"),
    onSuccess: (data) => {
      if (Platform.OS === "web") window.location.href = data.url;
      else Linking.openURL(data.url);
    },
    onError: (err) => showAlert("Couldn't open billing", err instanceof ApiError ? err.message : "Please try again."),
  });

  const handleApplePurchase = async () => {
    try {
      await apple.purchase();
      await queryClient.invalidateQueries({ queryKey: ["/api/subscription/status"] });
    } catch (err) {
      showAlert("Purchase failed", err instanceof Error ? err.message : "Please try again.");
    }
  };

  const handleAppleRestore = async () => {
    try {
      const restored = await apple.restore();
      await queryClient.invalidateQueries({ queryKey: ["/api/subscription/status"] });
      showAlert(restored ? "Restored" : "Nothing to restore", restored ? "Your Pro membership has been restored." : "No previous purchase was found on this Apple ID.");
    } catch (err) {
      showAlert("Restore failed", err instanceof Error ? err.message : "Please try again.");
    }
  };

  const webAppUrl = (Constants.expoConfig?.extra?.API_URL as string) || "https://www.pullmarkettcg.com";
  const active = status?.active ?? false;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xxl }}>
      <LinearGradient colors={["#1C1040", "#5B2A8E", "#D97706"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
        <StarField count={18} />
        <View style={styles.heroIcon}>
          <Feather name="star" size={26} color={Colors.gold} />
        </View>
        <View style={styles.heroRow}>
          <Text style={styles.heroTitle}>PullMarket Pro</Text>
          <VerifiedBadge size={20} />
        </View>
        <Text style={styles.heroPrice}>
          $19.99<Text style={styles.heroPriceUnit}>/month</Text>
        </Text>
        <Text style={styles.heroBody}>Followers, a verified tick, listing boosts, and search recognition — everything below, unlocked.</Text>
      </LinearGradient>

      <View style={styles.body}>
        <View style={styles.perksCard}>
          {PERKS.map((perk) => (
            <View key={perk.title} style={styles.perkRow}>
              <View style={styles.perkIcon}>
                <Feather name={perk.icon} size={18} color={Colors.goldDark} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.perkTitle}>{perk.title}</Text>
                <Text style={styles.perkBody}>{perk.body}</Text>
              </View>
            </View>
          ))}
        </View>

        {isLoading ? null : active ? (
          <View style={[styles.statusCard, styles.statusCardSuccess, Shadow.card]}>
            <View style={styles.statusHeader}>
              <VerifiedBadge size={18} />
              <Text style={styles.statusTitle}>You're a Pro member</Text>
            </View>
            {status?.proCurrentPeriodEnd ? (
              <Text style={styles.statusBody}>
                {status.proCancelAtPeriodEnd ? "Cancels" : "Renews"} on {new Date(status.proCurrentPeriodEnd).toLocaleDateString()}
              </Text>
            ) : null}
            {status?.proSource === "stripe" ? (
              <Button title="Manage billing" variant="outline" onPress={() => portalMutation.mutate()} loading={portalMutation.isPending} style={{ marginTop: Spacing.md }} />
            ) : (
              <Text style={styles.statusBody}>Manage or cancel from your iPhone's Settings {">"} [your name] {">"} Subscriptions.</Text>
            )}
          </View>
        ) : Platform.OS === "web" ? (
          <Button title="Subscribe — $19.99/mo" variant="gold" onPress={() => checkoutMutation.mutate()} loading={checkoutMutation.isPending} style={{ marginTop: Spacing.xl }} />
        ) : Platform.OS === "ios" ? (
          apple.available ? (
            <>
              <Button title={`Subscribe — ${apple.priceLabel ?? "$19.99/mo"}`} variant="gold" onPress={() => void handleApplePurchase()} loading={apple.purchasing} style={{ marginTop: Spacing.xl }} />
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
              <Text style={styles.statusBody}>Pro isn't available for purchase in this build yet — check back soon.</Text>
            </View>
          )
        ) : (
          <View style={[styles.statusCard, styles.statusCardPending, Shadow.card]}>
            <Text style={styles.statusBody}>Subscribe to Pro from the PullMarket website — your membership will apply here too.</Text>
            <Pressable onPress={() => Linking.openURL(webAppUrl)} style={{ marginTop: Spacing.sm }}>
              <Text style={styles.webLink}>{webAppUrl.replace(/^https?:\/\//, "")}</Text>
            </Pressable>
          </View>
        )}

        <Text style={styles.disclaimer}>Cancel anytime. Billed monthly.</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  hero: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.xl, alignItems: "center" },
  heroIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: "rgba(255,255,255,0.16)", alignItems: "center", justifyContent: "center", marginBottom: Spacing.sm },
  heroRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  heroTitle: { ...Typography.h1, color: Colors.white },
  heroPrice: { ...Typography.h2, color: Colors.gold, marginTop: Spacing.sm },
  heroPriceUnit: { ...Typography.body, color: "rgba(255,255,255,0.75)" },
  heroBody: { ...Typography.small, color: "rgba(255,255,255,0.85)", textAlign: "center", marginTop: Spacing.sm, maxWidth: 300, lineHeight: 19 },
  body: { padding: Spacing.lg },
  perksCard: { backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, gap: Spacing.md },
  perkRow: { flexDirection: "row", gap: Spacing.sm },
  perkIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#FDF3D8", alignItems: "center", justifyContent: "center" },
  perkTitle: { ...Typography.bodyBold, color: Colors.text },
  perkBody: { ...Typography.small, color: Colors.textSecondary, marginTop: 2 },
  statusCard: { borderRadius: BorderRadius.lg, borderWidth: 1, padding: Spacing.md, marginTop: Spacing.xl },
  statusCardSuccess: { backgroundColor: "#E9F9F0", borderColor: Colors.success },
  statusCardPending: { backgroundColor: Colors.surfaceAlt, borderColor: Colors.border },
  statusHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusTitle: { ...Typography.bodyBold, color: Colors.text },
  statusBody: { ...Typography.small, color: Colors.textSecondary, marginTop: 4 },
  restoreLink: { alignSelf: "center", marginTop: Spacing.md, padding: Spacing.xs },
  restoreLinkText: { ...Typography.small, color: Colors.goldDark, fontWeight: "600" },
  webLink: { ...Typography.small, color: Colors.goldDark, fontWeight: "700" },
  disclaimer: { ...Typography.small, color: Colors.textMuted, textAlign: "center", marginTop: Spacing.lg },
});
