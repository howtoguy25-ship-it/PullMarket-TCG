import React, { useEffect, useState } from "react";
import { View, StyleSheet, Text, FlatList, Pressable, TextInput, ActivityIndicator, Image } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming, Easing } from "react-native-reanimated";
import { Colors, Spacing, Typography, BorderRadius, Shadow, Fonts, NoWebFocusOutline } from "@/constants/theme";
import { EmptyState } from "@/components/ui";
import { SkyBackground } from "@/components/SkyBackground";
import { apiJson, ApiError } from "@/lib/api";
import { RootStackParamList } from "@/navigation/types";

type Nav = NativeStackNavigationProp<RootStackParamList>;

function LiveDot() {
  const opacity = useSharedValue(1);
  useEffect(() => {
    opacity.value = withRepeat(withSequence(withTiming(0.25, { duration: 700, easing: Easing.inOut(Easing.sin) }), withTiming(1, { duration: 700, easing: Easing.inOut(Easing.sin) })), -1, true);
  }, [opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[styles.liveDot, style]} />;
}

function timeAgo(ms: number): string {
  if (!ms) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ago`;
}

type Franchise = "pokemon" | "one_piece";

export interface PriceCard {
  id: string;
  name: string;
  setName: string;
  number: string | null;
  rarity: string | null;
  marketPriceCents: number | null;
  marketPriceAudCents: number | null;
  priceChange24hr: number | null;
  lastUpdated: number | null;
  imageUrl: string | null;
}

export interface PricesPage {
  cards: PriceCard[];
  total: number;
  hasMore: boolean;
  fxRateUsdToAud: number;
}

const PAGE_SIZE = 40;

const FRANCHISES: { key: Franchise; label: string; color: string }[] = [
  { key: "pokemon", label: "Pokémon", color: Colors.pokemon },
  { key: "one_piece", label: "One Piece", color: Colors.onePiece },
];

function formatUsd(cents: number | null): string {
  if (cents === null) return "—";
  return `US$${(cents / 100).toFixed(2)}`;
}

function formatAud(cents: number | null): string {
  if (cents === null) return "—";
  return `AU$${(cents / 100).toFixed(2)}`;
}

function CardImage({ uri }: { uri: string | null }) {
  const [failed, setFailed] = useState(!uri);
  if (!uri || failed) {
    return (
      <View style={[styles.cardImage, styles.cardImagePlaceholder]}>
        <Feather name="image" size={22} color={Colors.textMuted} />
      </View>
    );
  }
  return <Image source={{ uri }} style={styles.cardImage} resizeMode="contain" onError={() => setFailed(true)} />;
}

function PriceCardTile({ card, color, franchise, franchiseLabel, navigation }: { card: PriceCard; color: string; franchise: Franchise; franchiseLabel: string; navigation: Nav }) {
  const change = card.priceChange24hr;
  const changeUp = change !== null && change !== undefined && change > 0;
  const changeDown = change !== null && change !== undefined && change < 0;

  return (
    <Pressable
      style={[styles.tile, { borderTopColor: color }]}
      onPress={() => navigation.navigate("PriceCardDetail", { cardId: card.id, franchise, franchiseLabel, color })}
    >
      <CardImage uri={card.imageUrl} />
      {card.rarity ? <Text style={styles.rarity}>{card.rarity}</Text> : null}
      {/* Full name and set, no truncation — these can run to a couple of
         lines for longer product names (e.g. "Pokemon Base Set
         (Shadowless) [1st Edition]"), which is preferable to cutting off
         real information a buyer would want to see. */}
      <Text style={styles.cardName}>{card.name}</Text>
      <Text style={styles.setName}>{card.setName}</Text>
      <View style={styles.priceRow}>
        <View>
          <Text style={styles.priceLabel}>Market price</Text>
          <Text style={styles.price}>{formatAud(card.marketPriceAudCents)}</Text>
          <Text style={styles.priceUsd}>{formatUsd(card.marketPriceCents)}</Text>
        </View>
        {change !== null && change !== undefined ? (
          <View style={[styles.changeBadge, changeUp && styles.changeBadgeUp, changeDown && styles.changeBadgeDown]}>
            <Feather name={changeUp ? "trending-up" : changeDown ? "trending-down" : "minus"} size={11} color={changeUp ? Colors.success : changeDown ? Colors.danger : Colors.textMuted} />
            <Text style={[styles.changeText, changeUp && styles.changeTextUp, changeDown && styles.changeTextDown]}>{Math.abs(change).toFixed(2)}%</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

export default function PricesScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const [franchise, setFranchise] = useState<Franchise>("pokemon");
  const [filterText, setFilterText] = useState("");

  const statusQuery = useQuery({
    queryKey: ["prices-status"],
    queryFn: () => apiJson<{ configured: boolean }>("GET", "/api/prices/status"),
  });
  const configured = statusQuery.data?.configured ?? true;

  const {
    data,
    isLoading,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
    error,
    dataUpdatedAt,
  } = useInfiniteQuery({
    queryKey: ["prices", franchise],
    queryFn: async ({ pageParam }) => apiJson<PricesPage>("GET", `/api/prices?franchise=${franchise}&offset=${pageParam}&limit=${PAGE_SIZE}`),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length * PAGE_SIZE : undefined),
    enabled: configured,
    // Server caches each page for 10 min, so refetching every 5 min here
    // mostly hits that cache rather than burning JustTCG's daily request
    // quota, while still keeping what's on screen genuinely current —
    // only the first (already-loaded) page re-fetches, not the whole
    // scrollback, so this stays cheap even after paging through a lot of
    // cards.
    refetchInterval: 5 * 60 * 1000,
    refetchIntervalInBackground: false,
  });

  const allCards = (data?.pages ?? []).flatMap((p) => p.cards);
  const filtered = filterText.trim() ? allCards.filter((c) => c.name.toLowerCase().includes(filterText.trim().toLowerCase())) : allCards;
  const activeColor = FRANCHISES.find((f) => f.key === franchise)!.color;

  return (
    <SkyBackground>
      <View style={[styles.container, { paddingTop: insets.top + Spacing.sm }]}>
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <Text style={styles.headerTitle}>Live Card Prices</Text>
            {configured ? (
              <View style={styles.liveBadge}>
                <LiveDot />
                <Text style={styles.liveBadgeText}>LIVE</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.headerSubtitle}>
            {configured && dataUpdatedAt ? `Market prices from JustTCG · updated ${timeAgo(dataUpdatedAt)}` : "Real-time market prices from JustTCG"}
          </Text>
        </View>

        <View style={styles.chipsRow}>
          {FRANCHISES.map((f) => {
            const active = franchise === f.key;
            return (
              <Pressable key={f.key} onPress={() => setFranchise(f.key)} style={[styles.chip, { borderColor: f.color }, active && { backgroundColor: f.color }]}>
                <Text style={[styles.chipText, { color: active ? Colors.white : f.color }]}>{f.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {configured ? (
          <View style={styles.filterBar}>
            <Feather name="search" size={16} color={Colors.textMuted} />
            <TextInput
              style={styles.filterInput}
              placeholder={`Filter loaded ${franchise === "pokemon" ? "Pokémon" : "One Piece"} cards…`}
              placeholderTextColor={Colors.textMuted}
              value={filterText}
              onChangeText={setFilterText}
            />
          </View>
        ) : null}

        {!configured ? (
          <EmptyState
            icon={<Feather name="trending-up" size={40} color={Colors.textMuted} />}
            title="Live prices aren't set up yet"
            subtitle="The app owner needs to add a JustTCG API key to enable real-time card prices."
          />
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            numColumns={2}
            contentContainerStyle={{ padding: Spacing.sm, paddingBottom: insets.bottom + Spacing.xl }}
            renderItem={({ item }) => (
              <View style={styles.tileWrap}>
                <PriceCardTile card={item} color={activeColor} franchise={franchise} franchiseLabel={FRANCHISES.find((f) => f.key === franchise)!.label} navigation={navigation} />
              </View>
            )}
            onEndReachedThreshold={0.4}
            onEndReached={() => {
              if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
            }}
            ListFooterComponent={isFetchingNextPage ? <ActivityIndicator style={{ marginVertical: Spacing.lg }} color={Colors.primary} /> : null}
            ListEmptyComponent={
              !isLoading ? (
                error ? (
                  <EmptyState icon={<Feather name="alert-triangle" size={40} color={Colors.textMuted} />} title="Couldn't load prices" subtitle={error instanceof ApiError ? error.message : "Try again shortly."} />
                ) : (
                  <EmptyState icon={<Feather name="search" size={40} color={Colors.textMuted} />} title="No cards found" subtitle="Try a different filter" />
                )
              ) : (
                <ActivityIndicator style={{ marginTop: Spacing.xxl }} color={Colors.primary} />
              )
            }
          />
        )}
      </View>
    </SkyBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm },
  titleRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  headerTitle: { ...Typography.h2, color: Colors.text },
  headerSubtitle: { ...Typography.small, color: Colors.textSecondary, marginTop: 2 },
  liveBadge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, paddingVertical: 4, borderRadius: BorderRadius.pill, backgroundColor: "#E3F6ED" },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.success },
  liveBadgeText: { fontSize: 10, fontWeight: "800", color: Colors.success, letterSpacing: 0.5 },
  chipsRow: { flexDirection: "row", gap: Spacing.sm, paddingHorizontal: Spacing.lg, marginTop: Spacing.xs },
  chip: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: BorderRadius.lg, borderWidth: 2 },
  chipText: { fontFamily: Fonts.displayBold, fontSize: 14 },
  filterBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.card,
  },
  filterInput: { flex: 1, color: Colors.text, fontSize: 14, ...NoWebFocusOutline },
  tileWrap: { flex: 1, margin: Spacing.xs },
  tile: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    borderTopWidth: 4,
    padding: Spacing.sm,
    gap: 2,
    ...Shadow.card,
  },
  cardImage: { width: "100%", aspectRatio: 1, borderRadius: BorderRadius.sm, marginBottom: Spacing.xs, backgroundColor: Colors.surfaceAlt },
  cardImagePlaceholder: { alignItems: "center", justifyContent: "center" },
  rarity: { ...Typography.small, color: Colors.textMuted, fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 },
  cardName: { ...Typography.bodyBold, color: Colors.text },
  setName: { ...Typography.small, color: Colors.textSecondary },
  priceRow: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginTop: Spacing.xs },
  priceLabel: { fontSize: 9, color: Colors.textMuted, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.3 },
  price: { fontFamily: Fonts.display, fontSize: 18, color: Colors.goldDark },
  priceUsd: { fontSize: 10, color: Colors.textMuted, fontWeight: "600" },
  changeBadge: { flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 6, paddingVertical: 3, borderRadius: BorderRadius.pill, backgroundColor: Colors.surfaceAlt },
  changeBadgeUp: { backgroundColor: "#E3F6ED" },
  changeBadgeDown: { backgroundColor: "#FCE9E4" },
  changeText: { fontSize: 10, fontWeight: "700", color: Colors.textMuted },
  changeTextUp: { color: Colors.success },
  changeTextDown: { color: Colors.danger },
});
