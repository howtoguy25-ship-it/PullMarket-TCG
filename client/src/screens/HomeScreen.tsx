import React, { useMemo, useRef, useState } from "react";
import { View, StyleSheet, Text, FlatList, Pressable, TextInput, RefreshControl, Platform, Alert, Animated } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Colors, Spacing, Typography, BorderRadius, Fonts, NoWebFocusOutline } from "@/constants/theme";
import { ListingCard, ListingSummary } from "@/components/ListingCard";
import { EmptyState } from "@/components/ui";
import { GalaxyBackground } from "@/components/GalaxyBackground";
import { FloatingHoloCards } from "@/components/FloatingHoloCards";
import { RootStackParamList } from "@/navigation/types";
import { apiJson } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useCartCount } from "@/hooks/useCartCount";
import { useUnreadNotifications } from "@/hooks/useUnreadNotifications";

type Nav = NativeStackNavigationProp<RootStackParamList>;

const FRANCHISE_FILTERS: { key: string; label: string; color: string }[] = [
  { key: "pokemon", label: "Pokémon", color: Colors.pokemon },
  { key: "one_piece", label: "One Piece", color: Colors.onePiece },
];

function glowShadow(color: string) {
  return { shadowColor: color, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.5, shadowRadius: 10, elevation: 6 };
}

export default function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [franchises, setFranchises] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const cartCount = useCartCount();
  const unreadCount = useUnreadNotifications();

  // Collapsing header: scrolling down hides the search bar + franchise
  // chips together; scrolling back up (without reaching the top) brings
  // back just the search bar; only landing back at the very top restores
  // both. headerModeRef mirrors the state to avoid re-triggering the same
  // animation on every scroll tick.
  const headerModeRef = useRef<"full" | "searchOnly" | "hidden">("full");
  const lastScrollY = useRef(0);
  const searchAnim = useRef(new Animated.Value(1)).current;
  const chipsAnim = useRef(new Animated.Value(1)).current;

  const setHeaderModeAnimated = (mode: "full" | "searchOnly" | "hidden") => {
    if (headerModeRef.current === mode) return;
    headerModeRef.current = mode;
    Animated.parallel([
      Animated.timing(searchAnim, { toValue: mode === "hidden" ? 0 : 1, duration: 200, useNativeDriver: false }),
      Animated.timing(chipsAnim, { toValue: mode === "full" ? 1 : 0, duration: 200, useNativeDriver: false }),
    ]).start();
  };

  const SCROLL_DEAD_ZONE = 10;
  const handleScroll = (e: { nativeEvent: { contentOffset: { y: number } } }) => {
    const y = e.nativeEvent.contentOffset.y;
    const delta = y - lastScrollY.current;
    lastScrollY.current = y;

    if (y <= 0) setHeaderModeAnimated("full");
    else if (delta > SCROLL_DEAD_ZONE) setHeaderModeAnimated("hidden");
    else if (delta < -SCROLL_DEAD_ZONE) setHeaderModeAnimated("searchOnly");
  };

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (franchises.length) params.set("franchise", franchises.join(","));
    const s = params.toString();
    return s ? `?${s}` : "";
  }, [query, franchises]);

  const { data: listings, isLoading } = useQuery<ListingSummary[]>({
    queryKey: [`/api/listings${queryString}`],
  });

  const { data: favorites } = useQuery<ListingSummary[]>({ queryKey: ["/api/favorites"], enabled: !!user });
  const favoritedIds = useMemo(() => new Set((favorites ?? []).map((f) => f.id)), [favorites]);

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
    await queryClient.invalidateQueries({ queryKey: ["/api/listings"] });
    setRefreshing(false);
  };

  return (
    <GalaxyBackground>
      <FloatingHoloCards />
      <View style={[styles.container, { paddingTop: insets.top + Spacing.sm }]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>PullMarket TCG</Text>
          <View style={styles.headerIcons}>
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

        <Animated.View style={{ maxHeight: searchAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 80] }), opacity: searchAnim, overflow: "hidden" }}>
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
          data={listings ?? []}
          keyExtractor={(item) => item.id}
          numColumns={2}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          contentContainerStyle={{ padding: Spacing.sm, paddingBottom: insets.bottom + Spacing.xl }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
          renderItem={({ item }) => (
            <ListingCard
              listing={{ ...item, isFavorited: favoritedIds.has(item.id) }}
              onPress={() => navigation.navigate("ListingDetail", { listingId: item.id })}
              onRequireAuth={requireAuth}
              dark
            />
          )}
          ListEmptyComponent={
            !isLoading ? (
              <View style={styles.emptyPanel}>
                <EmptyState icon={<Feather name="inbox" size={40} color={Colors.textMuted} />} title="No cards yet" subtitle="Be the first to list a Pokémon or One Piece card!" />
              </View>
            ) : null
          }
        />
      </View>
    </GalaxyBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: Spacing.lg },
  headerTitle: { ...Typography.h2, color: Colors.gold },
  headerIcons: { flexDirection: "row", gap: Spacing.md },
  iconButton: { position: "relative" },
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
});
