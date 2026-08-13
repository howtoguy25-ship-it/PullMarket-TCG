import React, { useState } from "react";
import { View, StyleSheet, Text, ScrollView, Image } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useRoute, RouteProp } from "@react-navigation/native";
import { useQueryClient, InfiniteData } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { Colors, Spacing, Typography, BorderRadius, Shadow, Fonts } from "@/constants/theme";
import { RootStackParamList } from "@/navigation/types";
import { EmptyState } from "@/components/ui";
import type { PriceCard, PricesPage } from "@/screens/PricesScreen";

type Route = RouteProp<RootStackParamList, "PriceCardDetail">;

function formatUsd(cents: number | null): string {
  if (cents === null) return "—";
  return `US$${(cents / 100).toFixed(2)}`;
}

function formatAud(cents: number | null): string {
  if (cents === null) return "—";
  return `AU$${(cents / 100).toFixed(2)}`;
}

function timeAgo(ms: number | null): string {
  if (!ms) return "Unknown";
  const seconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

export default function PriceCardDetailScreen() {
  const { params } = useRoute<Route>();
  const { cardId, franchise, franchiseLabel, color } = params;
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const queryClient = useQueryClient();

  // Reads the card straight out of the Prices tab's already-fetched React
  // Query cache instead of re-fetching — JustTCG's API only supports
  // browsing by game/set, not looking up one card by id, so there's no
  // single-card endpoint to call here even if we wanted one. This works
  // for the normal in-app flow (tap a tile you just saw in the list); a
  // cold deep link or hard refresh straight into this screen without ever
  // having loaded the list has no cache to read, which is the one real
  // gap called out below.
  const cache = queryClient.getQueryData<InfiniteData<PricesPage>>(["prices", franchise]);
  const card: PriceCard | undefined = cache?.pages.flatMap((p) => p.cards).find((c) => c.id === cardId);

  return card ? (
    <PriceCardDetailBody card={card} franchiseLabel={franchiseLabel} color={color} insets={insets} headerHeight={headerHeight} />
  ) : (
    <View style={[styles.container, { paddingTop: headerHeight + Spacing.xl, alignItems: "center" }]}>
      <EmptyState
        icon={<Feather name="alert-triangle" size={40} color={Colors.textMuted} />}
        title="Card details unavailable"
        subtitle="This card's data isn't loaded — go back to Live Card Prices and tap it again from the list."
      />
    </View>
  );
}

function PriceCardDetailBody({
  card,
  franchiseLabel,
  color,
  insets,
  headerHeight,
}: {
  card: PriceCard;
  franchiseLabel: string;
  color: string;
  insets: { bottom: number };
  headerHeight: number;
}) {
  const [imageFailed, setImageFailed] = useState(!card.imageUrl);

  const change = card.priceChange24hr;
  const changeUp = change !== null && change !== undefined && change > 0;
  const changeDown = change !== null && change !== undefined && change < 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingTop: headerHeight + Spacing.lg, paddingBottom: insets.bottom + Spacing.xl }}
    >
      <View style={styles.imageWrap}>
        {!imageFailed && card.imageUrl ? (
          <Image source={{ uri: card.imageUrl }} style={styles.image} resizeMode="contain" onError={() => setImageFailed(true)} />
        ) : (
          <View style={[styles.image, styles.imagePlaceholder]}>
            <Feather name="image" size={40} color={Colors.textMuted} />
            <Text style={styles.imagePlaceholderText}>No image available for this card</Text>
          </View>
        )}
      </View>

      <View style={styles.badgeRow}>
        <View style={[styles.franchiseBadge, { backgroundColor: color }]}>
          <Text style={styles.franchiseBadgeText}>{franchiseLabel}</Text>
        </View>
        {card.rarity ? (
          <View style={styles.rarityBadge}>
            <Text style={styles.rarityBadgeText}>{card.rarity}</Text>
          </View>
        ) : null}
      </View>

      <Text style={styles.name}>{card.name}</Text>
      <Text style={styles.setName}>{card.setName}{card.number ? ` · #${card.number}` : ""}</Text>

      <View style={styles.separator} />

      <View style={styles.priceCard}>
        <Text style={styles.priceCardLabel}>Market price</Text>
        <View style={styles.priceMainRow}>
          <Text style={styles.priceAud}>{formatAud(card.marketPriceAudCents)}</Text>
          <Text style={styles.priceUsd}>{formatUsd(card.marketPriceCents)}</Text>
        </View>
        {change !== null && change !== undefined ? (
          <View style={[styles.changeBadge, changeUp && styles.changeBadgeUp, changeDown && styles.changeBadgeDown]}>
            <Feather name={changeUp ? "trending-up" : changeDown ? "trending-down" : "minus"} size={13} color={changeUp ? Colors.success : changeDown ? Colors.danger : Colors.textMuted} />
            <Text style={[styles.changeText, changeUp && styles.changeTextUp, changeDown && styles.changeTextDown]}>{Math.abs(change).toFixed(2)}% last 24h</Text>
          </View>
        ) : null}
        <View style={styles.marketNoteRow}>
          <Feather name="info" size={12} color={Colors.textMuted} />
          <Text style={styles.marketNoteText}>Live market reference price, not a specific seller's listing price on PullMarket</Text>
        </View>
      </View>

      <View style={styles.separatorInline} />

      <Text style={styles.sectionTitle}>Details</Text>
      <View style={styles.detailsCard}>
        <DetailRow label="Set" value={card.setName} />
        {card.number ? <DetailRow label="Card number" value={card.number} /> : null}
        {card.rarity ? <DetailRow label="Rarity" value={card.rarity} /> : null}
        <DetailRow label="Franchise" value={franchiseLabel} />
        <DetailRow label="Price last updated" value={timeAgo(card.lastUpdated)} />
      </View>

      <Text style={styles.disclaimer}>
        This market price is a live, volume-weighted average sourced from JustTCG and converted from USD to AUD using a live exchange rate — it's a reference figure for this card generally, not the price of any individual item for sale. Sellers on PullMarket set their own listing prices, which may be higher or lower than this market price.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  imageWrap: { paddingHorizontal: Spacing.xl, alignItems: "center" },
  image: { width: "70%", aspectRatio: 0.72, borderRadius: BorderRadius.lg, backgroundColor: Colors.surfaceAlt },
  imagePlaceholder: { alignItems: "center", justifyContent: "center", gap: Spacing.sm, paddingHorizontal: Spacing.lg },
  imagePlaceholderText: { ...Typography.small, color: Colors.textMuted, textAlign: "center" },
  badgeRow: { flexDirection: "row", gap: Spacing.sm, paddingHorizontal: Spacing.xl, marginTop: Spacing.lg },
  franchiseBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: BorderRadius.pill },
  franchiseBadgeText: { fontSize: 11, fontWeight: "800", color: Colors.white, letterSpacing: 0.3 },
  rarityBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: BorderRadius.pill, backgroundColor: Colors.surfaceAlt },
  rarityBadgeText: { fontSize: 11, fontWeight: "800", color: Colors.textSecondary, letterSpacing: 0.3, textTransform: "uppercase" },
  name: { ...Typography.h2, color: Colors.text, paddingHorizontal: Spacing.xl, marginTop: Spacing.sm },
  setName: { ...Typography.body, color: Colors.textSecondary, paddingHorizontal: Spacing.xl, marginTop: 2 },
  separator: { height: 3, backgroundColor: Colors.primary, marginTop: Spacing.lg },
  separatorInline: { height: 2, backgroundColor: Colors.primary, opacity: 0.85, marginHorizontal: Spacing.xl, marginTop: Spacing.lg },
  priceCard: {
    marginHorizontal: Spacing.xl,
    marginTop: Spacing.lg,
    padding: Spacing.lg,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.card,
  },
  priceCardLabel: { fontSize: 11, color: Colors.textMuted, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 },
  priceMainRow: { flexDirection: "row", alignItems: "flex-end", gap: Spacing.sm, marginTop: Spacing.xs },
  priceAud: { fontFamily: Fonts.display, fontSize: 32, color: Colors.goldDark },
  priceUsd: { ...Typography.body, color: Colors.textMuted, marginBottom: 4 },
  changeBadge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: BorderRadius.pill, backgroundColor: Colors.surfaceAlt, alignSelf: "flex-start", marginTop: Spacing.sm },
  changeBadgeUp: { backgroundColor: "#E3F6ED" },
  changeBadgeDown: { backgroundColor: "#FCE9E4" },
  changeText: { fontSize: 12, fontWeight: "700", color: Colors.textMuted },
  changeTextUp: { color: Colors.success },
  changeTextDown: { color: Colors.danger },
  marketNoteRow: { flexDirection: "row", alignItems: "flex-start", gap: 5, marginTop: Spacing.sm },
  marketNoteText: { fontSize: 11, color: Colors.textMuted, flex: 1, lineHeight: 15 },
  sectionTitle: { ...Typography.bodyBold, color: Colors.text, paddingHorizontal: Spacing.xl, marginTop: Spacing.lg, marginBottom: Spacing.sm },
  detailsCard: {
    marginHorizontal: Spacing.xl,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  detailRow: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.border },
  detailLabel: { ...Typography.small, color: Colors.textSecondary },
  detailValue: { ...Typography.small, color: Colors.text, fontWeight: "700" },
  disclaimer: { ...Typography.small, color: Colors.textMuted, paddingHorizontal: Spacing.xl, marginTop: Spacing.lg, lineHeight: 18 },
});
