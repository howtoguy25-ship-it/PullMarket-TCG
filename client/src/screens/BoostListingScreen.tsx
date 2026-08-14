import React, { useState } from "react";
import { View, StyleSheet, Text, ScrollView, Pressable, Platform, Alert, Switch } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Colors, Spacing, Typography, BorderRadius, Shadow } from "@/constants/theme";
import { Button } from "@/components/ui";
import { StarField } from "@/components/StarField";
import { RootStackParamList } from "@/navigation/types";
import { apiJson, describeApiError } from "@/lib/api";

type Nav = NativeStackNavigationProp<RootStackParamList, "BoostListing">;
type Rt = RouteProp<RootStackParamList, "BoostListing">;

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

interface BoostTierOption {
  id: string;
  durationHours: number;
  label: string;
  priceCents: number;
  discountEligible: boolean;
  finalPriceCents: number;
}

interface BoostTiersResponse {
  isPro: boolean;
  applyDiscount: boolean;
  tiers: BoostTierOption[];
}

// Each tier gets a color "barrier" from the app's real brand palette,
// banded by how long the boost runs — so the list reads as a gradient of
// commitment (a quick 12h nudge vs. a full 2-week takeover) rather than a
// wall of identical white rows, and a seller can tell tiers apart at a
// glance even before reading the price.
function tierColor(durationHours: number): string {
  if (durationHours <= 36) return Colors.pokemon;
  if (durationHours <= 96) return Colors.goldDark;
  if (durationHours <= 168) return Colors.primary;
  return Colors.onePiece;
}

export default function BoostListingScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const { listingId } = route.params;
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const [selectedTierId, setSelectedTierId] = useState<string | null>(null);
  // Real on/off toggle for Pro subscribers: the 15% cut only ever applies
  // to 2-day/$45+ tiers, and a Pro user can switch it off for themselves —
  // the server re-derives the actual price from this flag either way, this
  // just decides whether they're asking for it.
  const [applyDiscount, setApplyDiscount] = useState(true);

  const { data, isLoading } = useQuery<BoostTiersResponse>({
    queryKey: ["/api/boost/tiers", { applyDiscount }],
    queryFn: () => apiJson<BoostTiersResponse>("GET", `/api/boost/tiers?applyDiscount=${applyDiscount}`),
  });

  const checkoutMutation = useMutation({
    mutationFn: (tierId: string) => {
      const returnUrl =
        Platform.OS === "web" ? `${window.location.origin}/boost-return?listingId=${listingId}` : Linking.createURL("boost-return", { queryParams: { listingId } });
      return apiJson<{ url: string }>("POST", `/api/boost/listings/${listingId}/checkout`, { tierId, returnUrl, applyDiscount });
    },
    onSuccess: async (result) => {
      if (Platform.OS === "web") {
        window.location.href = result.url;
      } else {
        await WebBrowser.openAuthSessionAsync(result.url, Linking.createURL("boost-return", { queryParams: { listingId } }));
        navigation.goBack();
      }
    },
    onError: (err) => showAlert("Couldn't start checkout", describeApiError(err)),
  });

  const tiers = data?.tiers ?? [];
  const isPro = data?.isPro ?? false;
  const selectedTier = tiers.find((t) => t.id === selectedTierId) ?? null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingTop: headerHeight, paddingBottom: insets.bottom + Spacing.xxl }}>
      <LinearGradient colors={["#1C1040", "#3B1E6B", "#DB2777"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
        <StarField count={16} />
        <View style={styles.heroIcon}>
          <Feather name="zap" size={22} color={Colors.gold} />
        </View>
        <Text style={styles.heroTitle}>Boost This Listing</Text>
        <Text style={styles.heroSubtitle}>Pin it to the very top of the marketplace feed for buyers to see first.</Text>
        {isPro ? (
          <View style={styles.proPill}>
            <Feather name="award" size={12} color="#3A2A00" />
            <Text style={styles.proPillText}>PullMarket Pro — 15% off 2-day+ boosts</Text>
          </View>
        ) : null}
      </LinearGradient>

      {isPro ? (
        <View style={styles.discountToggleRow}>
          <View style={styles.discountToggleText}>
            <Text style={styles.discountToggleLabel}>Apply my Pro discount</Text>
            <Text style={styles.discountToggleHint}>15% off boosts of 2 days ($45) or longer. Shorter boosts are always full price.</Text>
          </View>
          <Switch value={applyDiscount} onValueChange={setApplyDiscount} trackColor={{ true: Colors.primary, false: Colors.border }} thumbColor={Colors.white} />
        </View>
      ) : null}

      <View style={styles.body}>
        <Text style={styles.sectionLabel}>Choose a boost window</Text>

        {isLoading ? (
          <Text style={styles.loadingText}>Loading boost options…</Text>
        ) : (
          <View style={styles.tierList}>
            {tiers.map((tier) => {
              const active = tier.id === selectedTierId;
              const discounted = tier.finalPriceCents < tier.priceCents;
              const color = tierColor(tier.durationHours);
              return (
                <Pressable
                  key={tier.id}
                  onPress={() => setSelectedTierId(tier.id)}
                  style={[styles.tierRow, { borderLeftColor: color, backgroundColor: active ? color + "1F" : color + "0D" }, active && { borderColor: color }, Shadow.card]}
                >
                  <View style={[styles.tierIcon, { backgroundColor: color + "26" }]}>
                    <Feather name="clock" size={16} color={color} />
                  </View>
                  <View style={[styles.tierRadio, active && { borderColor: color }]}>{active ? <View style={[styles.tierRadioDot, { backgroundColor: color }]} /> : null}</View>
                  <View style={styles.tierInfo}>
                    <Text style={[styles.tierLabel, active && { color }]}>{tier.label}</Text>
                    <Text style={styles.tierHint}>
                      {isPro && tier.discountEligible ? "Top of feed for the full window · Pro discount eligible" : "Top of feed for the full window"}
                    </Text>
                  </View>
                  <View style={styles.tierPriceWrap}>
                    {discounted ? <Text style={styles.tierPriceOriginal}>${(tier.priceCents / 100).toFixed(2)}</Text> : null}
                    <Text style={[styles.tierPrice, active && { color }]}>${(tier.finalPriceCents / 100).toFixed(2)}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}

        <View style={styles.infoBox}>
          <Feather name="info" size={15} color={Colors.textSecondary} />
          <Text style={styles.infoText}>Boosts stack — buying another one while a boost is still active adds the new window on top of the time remaining.</Text>
        </View>

        <Button
          title={selectedTier ? `Boost — $${(selectedTier.finalPriceCents / 100).toFixed(2)}` : "Pick a boost window"}
          onPress={() => selectedTier && checkoutMutation.mutate(selectedTier.id)}
          disabled={!selectedTier}
          loading={checkoutMutation.isPending}
          style={{ marginTop: Spacing.xl }}
        />
        <Pressable onPress={() => navigation.goBack()} style={styles.cancelLink}>
          <Text style={styles.cancelLinkText}>Not now</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  hero: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.xl, alignItems: "center" },
  heroIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center", marginBottom: Spacing.sm },
  heroTitle: { ...Typography.h2, color: Colors.white, textAlign: "center" },
  heroSubtitle: { ...Typography.small, color: "rgba(255,255,255,0.85)", textAlign: "center", marginTop: 6, maxWidth: 300 },
  proPill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: Colors.gold, borderRadius: BorderRadius.pill, paddingHorizontal: Spacing.md, paddingVertical: 6, marginTop: Spacing.md },
  proPillText: { color: "#3A2A00", fontSize: 12, fontWeight: "800" },
  discountToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1.5,
    borderColor: Colors.border,
    padding: Spacing.md,
  },
  discountToggleText: { flex: 1 },
  discountToggleLabel: { ...Typography.bodyBold, color: Colors.text },
  discountToggleHint: { ...Typography.small, color: Colors.textMuted, marginTop: 2, lineHeight: 16 },
  body: { padding: Spacing.lg },
  sectionLabel: { ...Typography.small, color: Colors.textSecondary, fontWeight: "700", letterSpacing: 0.5, marginBottom: Spacing.sm },
  loadingText: { ...Typography.body, color: Colors.textSecondary, textAlign: "center", marginTop: Spacing.xl },
  tierList: { gap: Spacing.sm },
  tierRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    borderRadius: BorderRadius.lg,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderLeftWidth: 5,
    padding: Spacing.md,
  },
  tierIcon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  tierRadio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: Colors.border, alignItems: "center", justifyContent: "center" },
  tierRadioDot: { width: 11, height: 11, borderRadius: 6 },
  tierInfo: { flex: 1 },
  tierLabel: { ...Typography.bodyBold, color: Colors.text },
  tierHint: { ...Typography.small, color: Colors.textMuted, marginTop: 2 },
  tierPriceWrap: { alignItems: "flex-end" },
  tierPriceOriginal: { ...Typography.small, color: Colors.textMuted, textDecorationLine: "line-through" },
  tierPrice: { ...Typography.bodyBold, color: Colors.text, fontSize: 17 },
  infoBox: { flexDirection: "row", gap: Spacing.sm, backgroundColor: Colors.surfaceAlt, padding: Spacing.md, borderRadius: BorderRadius.md, marginTop: Spacing.lg },
  infoText: { flex: 1, ...Typography.small, color: Colors.textSecondary, lineHeight: 18 },
  cancelLink: { alignSelf: "center", marginTop: Spacing.md, padding: Spacing.sm },
  cancelLinkText: { ...Typography.small, color: Colors.textMuted, fontWeight: "600" },
});
