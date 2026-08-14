import React, { useState } from "react";
import { View, StyleSheet, Text, ScrollView, Pressable, Platform, Alert } from "react-native";
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
  finalPriceCents: number;
}

interface BoostTiersResponse {
  isPro: boolean;
  tiers: BoostTierOption[];
}

export default function BoostListingScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const { listingId } = route.params;
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const [selectedTierId, setSelectedTierId] = useState<string | null>(null);

  const { data, isLoading } = useQuery<BoostTiersResponse>({ queryKey: ["/api/boost/tiers"] });

  const checkoutMutation = useMutation({
    mutationFn: (tierId: string) => {
      const returnUrl =
        Platform.OS === "web" ? `${window.location.origin}/boost-return?listingId=${listingId}` : Linking.createURL("boost-return", { queryParams: { listingId } });
      return apiJson<{ url: string }>("POST", `/api/boost/listings/${listingId}/checkout`, { tierId, returnUrl });
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
            <Text style={styles.proPillText}>PullMarket Pro — 15% off every tier below</Text>
          </View>
        ) : null}
      </LinearGradient>

      <View style={styles.body}>
        <Text style={styles.sectionLabel}>Choose a boost window</Text>

        {isLoading ? (
          <Text style={styles.loadingText}>Loading boost options…</Text>
        ) : (
          <View style={styles.tierList}>
            {tiers.map((tier) => {
              const active = tier.id === selectedTierId;
              const discounted = tier.finalPriceCents < tier.priceCents;
              return (
                <Pressable key={tier.id} onPress={() => setSelectedTierId(tier.id)} style={[styles.tierRow, active && styles.tierRowActive, Shadow.card]}>
                  <View style={[styles.tierRadio, active && styles.tierRadioActive]}>{active ? <View style={styles.tierRadioDot} /> : null}</View>
                  <View style={styles.tierInfo}>
                    <Text style={[styles.tierLabel, active && styles.tierLabelActive]}>{tier.label}</Text>
                    <Text style={styles.tierHint}>Top of feed for the full window</Text>
                  </View>
                  <View style={styles.tierPriceWrap}>
                    {discounted ? <Text style={styles.tierPriceOriginal}>${(tier.priceCents / 100).toFixed(2)}</Text> : null}
                    <Text style={[styles.tierPrice, active && styles.tierPriceActive]}>${(tier.finalPriceCents / 100).toFixed(2)}</Text>
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
  body: { padding: Spacing.lg },
  sectionLabel: { ...Typography.small, color: Colors.textSecondary, fontWeight: "700", letterSpacing: 0.5, marginBottom: Spacing.sm },
  loadingText: { ...Typography.body, color: Colors.textSecondary, textAlign: "center", marginTop: Spacing.xl },
  tierList: { gap: Spacing.sm },
  tierRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1.5,
    borderColor: Colors.border,
    padding: Spacing.md,
  },
  tierRowActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + "0D" },
  tierRadio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: Colors.border, alignItems: "center", justifyContent: "center" },
  tierRadioActive: { borderColor: Colors.primary },
  tierRadioDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: Colors.primary },
  tierInfo: { flex: 1 },
  tierLabel: { ...Typography.bodyBold, color: Colors.text },
  tierLabelActive: { color: Colors.primary },
  tierHint: { ...Typography.small, color: Colors.textMuted, marginTop: 2 },
  tierPriceWrap: { alignItems: "flex-end" },
  tierPriceOriginal: { ...Typography.small, color: Colors.textMuted, textDecorationLine: "line-through" },
  tierPrice: { ...Typography.bodyBold, color: Colors.text, fontSize: 17 },
  tierPriceActive: { color: Colors.primary },
  infoBox: { flexDirection: "row", gap: Spacing.sm, backgroundColor: Colors.surfaceAlt, padding: Spacing.md, borderRadius: BorderRadius.md, marginTop: Spacing.lg },
  infoText: { flex: 1, ...Typography.small, color: Colors.textSecondary, lineHeight: 18 },
  cancelLink: { alignSelf: "center", marginTop: Spacing.md, padding: Spacing.sm },
  cancelLinkText: { ...Typography.small, color: Colors.textMuted, fontWeight: "600" },
});
