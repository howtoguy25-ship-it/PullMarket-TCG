import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, StyleSheet, Text, FlatList, Pressable, TextInput, RefreshControl, Platform, Alert, Animated } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Colors, Spacing, Typography, BorderRadius, Fonts, NoWebFocusOutline } from "@/constants/theme";
import { ListingCard, ListingSummary } from "@/components/ListingCard";
import { EbayListingCard, EbayListingSummary } from "@/components/EbayListingCard";
import { mergeListingsWithEbay } from "@/lib/mergeFeed";
import { EmptyState } from "@/components/ui";
import { GalaxyBackground } from "@/components/GalaxyBackground";
import { OceanBackground } from "@/components/OceanBackground";
import { AuroraBackground } from "@/components/AuroraBackground";
import { EmberBackground } from "@/components/EmberBackground";
import { ForestBackground } from "@/components/ForestBackground";
import { HomeBackgroundPickerModal } from "@/components/HomeBackgroundPickerModal";
import { FloatingHoloCards } from "@/components/FloatingHoloCards";
import { useHomeBackground } from "@/contexts/HomeBackgroundContext";
import { RootStackParamList } from "@/navigation/types";
import { apiJson } from "@/lib/api";
import { invalidateListingsQueries } from "@/lib/queryClient";
import { useAuth } from "@/contexts/AuthContext";
import { useCartCount } from "@/hooks/useCartCount";
import { useUnreadNotifications } from "@/hooks/useUnreadNotifications";

type Nav = NativeStackNavigationProp<RootStackParamList>;

const FRANCHISE_FILTERS: { key: string; label: string; color: string }[] = [
  { key: "pokemon", label: "Pokémon", color: Colors.pokemon },
  { key: "one_piece", label: "One Piece", color: Colors.onePiece },
];

const HIDE_BOOSTED_STORAGE_KEY = "pullmarket_hide_boosted_listings";

function glowShadow(color: string) {
  return { shadowColor: color, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.5, shadowRadius: 10, elevation: 6 };
}

const HOME_BACKGROUND_COMPONENTS: Record<string, React.ComponentType<{ children?: React.ReactNode }>> = {
  galaxy: GalaxyBackground,
  ocean: OceanBackground,
  aurora: AuroraBackground,
  ember: EmberBackground,
  forest: ForestBackground,
};

export default function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { backgroundId } = useHomeBackground();
  const [backgroundPickerVisible, setBackgroundPickerVisible] = useState(false);
  const HomeBackground = HOME_BACKGROUND_COMPONENTS[backgroundId] ?? GalaxyBackground;
  const [query, setQuery] = useState("");
  const [franchises, setFranchises] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [hideBoosted, setHideBoosted] = useState(false);
  const cartCount = useCartCount();
  const unreadCount = useUnreadNotifications();

  useEffect(() => {
    AsyncStorage.getItem(HIDE_BOOSTED_STORAGE_KEY)
      .then((raw) => {
        if (raw === "1") setHideBoosted(true);
      })
      .catch(() => {});
  }, []);

  const toggleHideBoosted = () => {
    setHideBoosted((prev) => {
      const next = !prev;
      AsyncStorage.setItem(HIDE_BOOSTED_STORAGE_KEY, next ? "1" : "0").catch(() => {});
      return next;
    });
  };

  // Collapsing header: scrolling down hides the search bar + franchise
  // chips together; scrolling back up (without reaching the top) brings
  // back a compact search bar only; landing back at the very top restores
  // both at full size. searchAnim runs 0 (hidden) -> 0.5 (compact) -> 1
  // (full) so the search bar can be a distinct smaller size mid-scroll,
  // not just shown/hidden.
  const headerModeRef = useRef<"full" | "searchOnly" | "hidden">("full");
  const lastScrollY = useRef(0);
  // Accumulates movement in the CURRENT scroll direction, resetting on any
  // direction reversal — a real finger-driven scroll gesture on a phone is
  // full of tiny sub-pixel direction reversals (deceleration curves, bounce
  // near the top), and reacting to every single raw onScroll delta made the
  // header flicker/pop back open mid-gesture. Only committing to a new mode
  // once movement has been consistently one-way for SCROLL_TRIGGER px
  // filters that jitter out.
  const scrollAccum = useRef(0);
  const scrollDir = useRef<1 | -1 | 0>(0);
  const searchAnim = useRef(new Animated.Value(1)).current;
  const chipsAnim = useRef(new Animated.Value(1)).current;

  const setHeaderModeAnimated = (mode: "full" | "searchOnly" | "hidden") => {
    if (headerModeRef.current === mode) return;
    headerModeRef.current = mode;
    Animated.parallel([
      Animated.timing(searchAnim, { toValue: mode === "hidden" ? 0 : mode === "searchOnly" ? 0.5 : 1, duration: 200, useNativeDriver: false }),
      Animated.timing(chipsAnim, { toValue: mode === "full" ? 1 : 0, duration: 200, useNativeDriver: false }),
    ]).start();
  };

  const SCROLL_TRIGGER = 30;
  const handleScroll = (e: { nativeEvent: { contentOffset: { y: number } } }) => {
    const y = Math.max(0, e.nativeEvent.contentOffset.y); // ignore iOS's negative overscroll-bounce values
    const delta = y - lastScrollY.current;
    lastScrollY.current = y;

    if (y <= 0) {
      scrollAccum.current = 0;
      scrollDir.current = 0;
      setHeaderModeAnimated("full");
      return;
    }
    if (Math.abs(delta) < 0.5) return;

    const dir = delta > 0 ? 1 : -1;
    if (dir !== scrollDir.current) {
      scrollDir.current = dir;
      scrollAccum.current = 0;
    }
    scrollAccum.current += Math.abs(delta);

    if (scrollAccum.current >= SCROLL_TRIGGER) {
      setHeaderModeAnimated(dir === 1 ? "hidden" : "searchOnly");
      scrollAccum.current = 0;
    }
  };

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (franchises.length) params.set("franchise", franchises.join(","));
    // hideBoosted never removes anything from the feed — every active
    // listing always shows. It only decides positioning: off (default)
    // weaves boosted listings into sponsored slots; on requests plain
    // chronological order from the server, so a boosted listing sits in
    // its natural, unpromoted spot instead of a special slot.
    if (hideBoosted) params.set("plainOrder", "1");
    const s = params.toString();
    return s ? `?${s}` : "";
  }, [query, franchises, hideBoosted]);

  const { data: listings, isLoading } = useQuery<ListingSummary[]>({
    queryKey: [`/api/listings${queryString}`],
  });

  const { data: favorites } = useQuery<ListingSummary[]>({ queryKey: ["/api/favorites"], enabled: !!user });
  const favoritedIds = useMemo(() => new Set((favorites ?? []).map((f) => f.id)), [favorites]);

  const ebayQueryString = useMemo(() => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (franchises.length) params.set("franchise", franchises.join(","));
    const s = params.toString();
    return s ? `?${s}` : "";
  }, [query, franchises]);

  // A 404/503 (not configured) is expected and silent — real eBay listings
  // are an enhancement on top of the core feed, never a requirement for it.
  const { data: ebayResponse } = useQuery<{ listings: EbayListingSummary[] }>({
    queryKey: [`/api/ebay-listings${ebayQueryString}`],
    retry: false,
  });

  const feedItems = useMemo(() => mergeListingsWithEbay(listings ?? [], ebayResponse?.listings ?? []), [listings, ebayResponse]);

  const toggleFranchise = (key: string) => {
    setFranchises((prev) => (prev.includes(key) ? prev.filter((f) => f !== key) : [...prev, key]));
  };

  const requireAuth = () => {
    if (!user) {
      if (Platform.OS === "web") window.alert("Sign in to do that");
      else Alert.alert("Sign in required", "Sign in to favorite or buy cards.");
      return false;
    }
    return true;
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await invalidateListingsQueries(queryClient);
    setRefreshing(false);
  };

  return (
    <HomeBackground>
      <FloatingHoloCards />
      <HomeBackgroundPickerModal visible={backgroundPickerVisible} onClose={() => setBackgroundPickerVisible(false)} />
      <View style={[styles.container, { paddingTop: insets.top + Spacing.sm }]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>PullMarket TCG</Text>
          <View style={styles.headerIcons}>
            <Pressable onPress={() => setBackgroundPickerVisible(true)} style={styles.iconButton} hitSlop={8} testID="home-background-button">
              <Feather name="image" size={20} color={Colors.white} />
            </Pressable>
            <Pressable onPress={toggleHideBoosted} style={[styles.iconButton, hideBoosted && styles.iconButtonActive]} hitSlop={8}>
              <Feather name={hideBoosted ? "zap-off" : "zap"} size={20} color={hideBoosted ? Colors.gold : Colors.white} />
            </Pressable>
            <Pressable onPress={() => navigation.navigate("Notifications")} style={styles.iconButton} hitSlop={8}>
              <Feather name="bell" size={22} color={Colors.white} />
              {unreadCount > 0 ? <View style={styles.dot} /> : null}
            </Pressable>
            <Pressable onPress={() => navigation.navigate("Cart")} style={styles.iconButton} hitSlop={8}>
              <Feather name="shopping-cart" size={22} color={Colors.white} />
              {cartCount > 0 ? (
                <View style={styles.cartBadge}>
                  <Text style={styles.cartBadgeText}>{cartCount}</Text>
                </View>
              ) : null}
            </Pressable>
          </View>
        </View>

        <Animated.View
          style={{
            maxHeight: searchAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 52, 80] }),
            opacity: searchAnim.interpolate({ inputRange: [0, 0.15, 0.5, 1], outputRange: [0, 1, 1, 1] }),
            transform: [{ scale: searchAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.9, 0.94, 1] }) }],
            overflow: "hidden",
          }}
        >
          <View style={styles.searchBar}>
            <Feather name="search" size={20} color="rgba(255,255,255,0.85)" />
            <TextInput
              style={styles.searchInput}
              placeholder="Search cards, sets, characters…"
              placeholderTextColor="rgba(255,255,255,0.55)"
              value={query}
              onChangeText={setQuery}
            />
            {query ? (
              <Pressable onPress={() => setQuery("")} hitSlop={8}>
                <Feather name="x" size={20} color="rgba(255,255,255,0.85)" />
              </Pressable>
            ) : null}
          </View>
        </Animated.View>

        <Animated.View style={{ maxHeight: chipsAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 90] }), opacity: chipsAnim, overflow: "hidden" }}>
          <View style={styles.chipsRow}>
            {FRANCHISE_FILTERS.map((f) => {
              const active = franchises.includes(f.key);
              return (
                <Pressable
                  key={f.key}
                  onPress={() => toggleFranchise(f.key)}
                  style={[styles.chip, active ? { backgroundColor: f.color, borderColor: f.color, ...glowShadow(f.color) } : { backgroundColor: `${f.color}22`, borderColor: f.color }]}
                >
                  <Text style={[styles.chipText, { color: active ? Colors.white : f.color }]}>{f.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </Animated.View>

        <FlatList
          data={feedItems}
          keyExtractor={(item) => item.key}
          numColumns={2}
          columnWrapperStyle={styles.columnWrapper}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          contentContainerStyle={{ padding: Spacing.sm, paddingBottom: insets.bottom + Spacing.xl }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
          ListHeaderComponent={
            <Pressable onPress={() => navigation.navigate("Hunt")} style={styles.huntBanner}>
              <View style={styles.huntBannerRing}>
                <Feather name="compass" size={22} color={Colors.gold} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.huntBannerTitle}>Card Hunt</Text>
                <Text style={styles.huntBannerSubtitle}>A real card, hidden somewhere real — tap to join</Text>
              </View>
              <Feather name="chevron-right" size={20} color={Colors.gold} />
            </Pressable>
          }
          renderItem={({ item }) =>
            item.kind === "ebay" ? (
              <EbayListingCard listing={item.data} />
            ) : (
              <ListingCard
                listing={{ ...item.data, isFavorited: favoritedIds.has(item.data.id) }}
                onPress={() => navigation.navigate("ListingDetail", { listingId: item.data.id })}
                onRequireAuth={requireAuth}
                dark
              />
            )
          }
          ListEmptyComponent={
            !isLoading ? (
              <View style={styles.emptyPanel}>
                <EmptyState icon={<Feather name="inbox" size={40} color={Colors.textMuted} />} title="No cards yet" subtitle="Be the first to list a Pokémon or One Piece card!" />
              </View>
            ) : null
          }
        />
      </View>
    </HomeBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  columnWrapper: { justifyContent: "flex-start", gap: 0 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: Spacing.lg },
  headerTitle: { ...Typography.h2, color: Colors.gold },
  headerIcons: { flexDirection: "row", gap: Spacing.md },
  iconButton: { position: "relative" },
  iconButtonActive: { opacity: 0.9 },
  dot: { position: "absolute", top: -2, right: -2, width: 9, height: 9, borderRadius: 5, backgroundColor: Colors.danger },
  cartBadge: { position: "absolute", top: -6, right: -8, backgroundColor: Colors.primary, borderRadius: 10, minWidth: 16, height: 16, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  cartBadgeText: { color: Colors.white, fontSize: 10, fontWeight: "800" },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 14,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: BorderRadius.pill,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.3)",
  },
  searchInput: { flex: 1, color: Colors.white, fontSize: 16, fontFamily: Fonts.bodySemiBold, ...NoWebFocusOutline },
  chipsRow: { flexDirection: "row", gap: Spacing.md, paddingHorizontal: Spacing.lg, marginTop: Spacing.lg },
  chip: { flex: 1, alignItems: "center", paddingVertical: 14, borderRadius: BorderRadius.lg, borderWidth: 2 },
  chipText: { fontFamily: Fonts.displayBold, fontSize: 16 },
  emptyPanel: { margin: Spacing.lg, marginTop: Spacing.xxl, backgroundColor: "rgba(255,255,255,0.92)", borderRadius: BorderRadius.lg, paddingVertical: Spacing.lg },
  huntBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    margin: Spacing.sm,
    marginBottom: Spacing.md,
    padding: Spacing.md,
    backgroundColor: "rgba(255,203,5,0.1)",
    borderRadius: BorderRadius.lg,
    borderWidth: 1.5,
    borderColor: Colors.gold,
  },
  huntBannerRing: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: Colors.gold, borderStyle: "dashed", alignItems: "center", justifyContent: "center" },
  huntBannerTitle: { color: Colors.gold, fontWeight: "800", fontSize: 16, letterSpacing: 0.5 },
  huntBannerSubtitle: { color: "rgba(255,255,255,0.75)", fontSize: 12, marginTop: 2 },
});
