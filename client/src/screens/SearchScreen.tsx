import React, { useMemo, useState } from "react";
import { View, StyleSheet, Text, FlatList, Pressable, TextInput, Keyboard } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Colors, Spacing, Typography, BorderRadius, Shadow, NoWebFocusOutline } from "@/constants/theme";
import { ListingCard, ListingSummary } from "@/components/ListingCard";
import { AppThemeBackground } from "@/components/AppThemeBackground";
import { EmptyState } from "@/components/ui";
import { RootStackParamList } from "@/navigation/types";
import { CONDITION_LABELS } from "@shared/validation";
import { useAuth } from "@/contexts/AuthContext";

type Nav = NativeStackNavigationProp<RootStackParamList>;

const FRANCHISE_OPTIONS = [
  { key: "pokemon", label: "Pokémon", color: Colors.pokemon },
  { key: "one_piece", label: "One Piece", color: Colors.onePiece },
];
const CONDITION_OPTIONS = Object.entries(CONDITION_LABELS).map(([key, label]) => ({ key, label, color: Colors.secondary }));

// Franchise chips pick up each franchise's real brand color (matching the
// same blue/red used on Home's filter chips and every listing's franchise
// pill), rather than a single flat accent for every chip regardless of
// what it means — condition chips get their own distinct navy accent so
// the two filter groups read as clearly different categories.
function MultiSelectRow({ options, selected, onToggle }: { options: { key: string; label: string; color: string }[]; selected: string[]; onToggle: (key: string) => void }) {
  return (
    <View style={styles.multiRow}>
      {options.map((opt) => {
        const active = selected.includes(opt.key);
        return (
          <Pressable key={opt.key} onPress={() => onToggle(opt.key)} style={[styles.optionChip, active ? { backgroundColor: opt.color, borderColor: opt.color } : { borderColor: opt.color + "55" }]}>
            {active ? <Feather name="check" size={13} color={Colors.white} /> : null}
            <Text style={[styles.optionChipText, active ? { color: Colors.white } : { color: opt.color }]}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

interface PriceRange {
  minCents: number | null;
  maxCents: number | null;
}

export default function SearchScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [franchises, setFranchises] = useState<string[]>([]);
  const [conditions, setConditions] = useState<string[]>([]);
  const [minPriceInput, setMinPriceInput] = useState("");
  const [maxPriceInput, setMaxPriceInput] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  // The real lowest/highest price among listings that already match every
  // OTHER active filter (franchise, condition, search text) — recomputed
  // whenever those change, so "$5 – $29,499" always reflects what's
  // actually available right now rather than a guessed/fixed range.
  const rangeQueryString = useMemo(() => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (franchises.length) params.set("franchise", franchises.join(","));
    if (conditions.length) params.set("condition", conditions.join(","));
    return params.toString();
  }, [query, franchises, conditions]);
  const { data: priceRange } = useQuery<PriceRange>({ queryKey: [`/api/listings/price-range?${rangeQueryString}`] });

  const minPrice = minPriceInput.trim() ? Number(minPriceInput) : undefined;
  const maxPrice = maxPriceInput.trim() ? Number(maxPriceInput) : undefined;
  const priceInputsValid = (minPrice === undefined || !Number.isNaN(minPrice)) && (maxPrice === undefined || !Number.isNaN(maxPrice));

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (franchises.length) params.set("franchise", franchises.join(","));
    if (conditions.length) params.set("condition", conditions.join(","));
    if (priceInputsValid && minPrice !== undefined) params.set("minPrice", String(minPrice));
    if (priceInputsValid && maxPrice !== undefined) params.set("maxPrice", String(maxPrice));
    const s = params.toString();
    return s ? `?${s}` : "";
  }, [query, franchises, conditions, minPrice, maxPrice, priceInputsValid]);

  const hasPriceFilter = priceInputsValid && (minPrice !== undefined || maxPrice !== undefined);
  const { data: listings, isLoading } = useQuery<ListingSummary[]>({
    queryKey: [`/api/listings${queryString}`],
    enabled: query.length > 0 || franchises.length > 0 || conditions.length > 0 || hasPriceFilter,
  });
  const { data: favorites } = useQuery<ListingSummary[]>({ queryKey: ["/api/favorites"], enabled: !!user });
  const favoritedIds = useMemo(() => new Set((favorites ?? []).map((f) => f.id)), [favorites]);

  const toggle = (list: string[], setList: (v: string[]) => void, key: string) => {
    setList(list.includes(key) ? list.filter((x) => x !== key) : [...list, key]);
  };

  const activeFilterCount = franchises.length + conditions.length + (hasPriceFilter ? 1 : 0);
  const hasQuery = query.length > 0 || activeFilterCount > 0;

  const clearSearch = () => {
    setQuery("");
    Keyboard.dismiss();
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + Spacing.sm }]}>
      <AppThemeBackground />
      <View style={styles.searchRow}>
        <View style={styles.searchBar}>
          <Feather name="search" size={18} color={Colors.textMuted} />
          <TextInput style={styles.searchInput} placeholder="Search for a card…" placeholderTextColor={Colors.textMuted} value={query} onChangeText={setQuery} autoFocus />
        </View>
        <Pressable onPress={() => setFiltersOpen((v) => !v)} style={[styles.filterButton, activeFilterCount > 0 && styles.filterButtonActive]} testID="search-filter-button">
          <Feather name="sliders" size={18} color={activeFilterCount > 0 ? Colors.white : Colors.text} />
          {activeFilterCount > 0 ? <Text style={styles.filterCount}>{activeFilterCount}</Text> : null}
        </Pressable>
        <Pressable onPress={clearSearch} hitSlop={8}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </View>

      {filtersOpen ? (
        <View style={styles.filtersPanel}>
          <Text style={styles.filterLabel}>Franchise (select multiple)</Text>
          <MultiSelectRow options={FRANCHISE_OPTIONS} selected={franchises} onToggle={(k) => toggle(franchises, setFranchises, k)} />
          <Text style={styles.filterLabel}>Condition (select multiple)</Text>
          <MultiSelectRow options={CONDITION_OPTIONS} selected={conditions} onToggle={(k) => toggle(conditions, setConditions, k)} />

          <Text style={styles.filterLabel}>Price range</Text>
          <View style={styles.priceRow}>
            <View style={styles.priceInputWrap}>
              <Text style={styles.priceDollar}>$</Text>
              <TextInput
                style={styles.priceInput}
                placeholder={priceRange?.minCents != null ? (priceRange.minCents / 100).toFixed(0) : "Min"}
                placeholderTextColor={Colors.textMuted}
                value={minPriceInput}
                onChangeText={setMinPriceInput}
                keyboardType="decimal-pad"
              />
            </View>
            <Text style={styles.priceDash}>–</Text>
            <View style={styles.priceInputWrap}>
              <Text style={styles.priceDollar}>$</Text>
              <TextInput
                style={styles.priceInput}
                placeholder={priceRange?.maxCents != null ? (priceRange.maxCents / 100).toFixed(0) : "Max"}
                placeholderTextColor={Colors.textMuted}
                value={maxPriceInput}
                onChangeText={setMaxPriceInput}
                keyboardType="decimal-pad"
              />
            </View>
            {minPriceInput || maxPriceInput ? (
              <Pressable
                onPress={() => {
                  setMinPriceInput("");
                  setMaxPriceInput("");
                }}
                hitSlop={8}
              >
                <Feather name="x-circle" size={18} color={Colors.textMuted} />
              </Pressable>
            ) : null}
          </View>
          {priceRange?.minCents != null && priceRange?.maxCents != null ? (
            <Text style={styles.priceHint}>
              Available now: ${(priceRange.minCents / 100).toLocaleString()} – ${(priceRange.maxCents / 100).toLocaleString()}
            </Text>
          ) : null}
          {!priceInputsValid ? <Text style={styles.priceError}>Enter a number for min/max price</Text> : null}
        </View>
      ) : null}

      {hasQuery ? (
        <FlatList
          data={listings ?? []}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={styles.columnWrapper}
          contentContainerStyle={{ padding: Spacing.sm, paddingBottom: insets.bottom + Spacing.xl }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          renderItem={({ item }) => (
            <ListingCard listing={{ ...item, isFavorited: favoritedIds.has(item.id) }} onPress={() => navigation.navigate("ListingDetail", { listingId: item.id })} />
          )}
          ListEmptyComponent={!isLoading ? <EmptyState icon={<Feather name="search" size={40} color={Colors.textMuted} />} title="No matches" subtitle="Try a different search or filters" /> : null}
        />
      ) : (
        <Pressable style={styles.emptyFill} onPress={() => Keyboard.dismiss()}>
          <EmptyState icon={<Feather name="search" size={40} color={Colors.textMuted} />} title="Search PullMarket" subtitle="Search by card name, or filter by franchise and condition" />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, overflow: "hidden" },
  columnWrapper: { justifyContent: "flex-start", gap: 0 },
  searchRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, paddingHorizontal: Spacing.lg },
  searchBar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 11,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.card,
  },
  searchInput: { flex: 1, color: Colors.text, fontSize: 15, ...NoWebFocusOutline },
  cancelText: { ...Typography.body, color: Colors.primary, fontWeight: "600" },
  emptyFill: { flex: 1 },
  filterButton: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  filterButtonActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterCount: { position: "absolute", top: -4, right: -4, backgroundColor: Colors.gold, color: "#3A2A00", fontSize: 10, fontWeight: "800", borderRadius: 8, minWidth: 16, textAlign: "center" },
  filtersPanel: { backgroundColor: Colors.surface, margin: Spacing.lg, marginBottom: 0, padding: Spacing.md, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, gap: Spacing.sm },
  filterLabel: { ...Typography.small, color: Colors.textSecondary, fontWeight: "700", marginTop: Spacing.xs },
  multiRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  optionChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: Spacing.sm, paddingVertical: 6, borderRadius: BorderRadius.pill, borderWidth: 1.5 },
  optionChipText: { ...Typography.small, fontWeight: "600" },
  priceRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  priceInputWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 8,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  priceDollar: { ...Typography.small, color: Colors.textMuted, fontWeight: "700" },
  priceInput: { flex: 1, color: Colors.text, fontSize: 14, ...NoWebFocusOutline },
  priceDash: { color: Colors.textMuted, fontWeight: "700" },
  priceHint: { ...Typography.small, color: Colors.textMuted, fontSize: 11 },
  priceError: { ...Typography.small, color: Colors.danger, fontSize: 11 },
});
