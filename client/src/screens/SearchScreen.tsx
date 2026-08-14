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
  { key: "pokemon", label: "Pokémon" },
  { key: "one_piece", label: "One Piece" },
];
const CONDITION_OPTIONS = Object.entries(CONDITION_LABELS).map(([key, label]) => ({ key, label }));

function MultiSelectRow({ options, selected, onToggle }: { options: { key: string; label: string }[]; selected: string[]; onToggle: (key: string) => void }) {
  return (
    <View style={styles.multiRow}>
      {options.map((opt) => {
        const active = selected.includes(opt.key);
        return (
          <Pressable key={opt.key} onPress={() => onToggle(opt.key)} style={[styles.optionChip, active && styles.optionChipActive]}>
            {active ? <Feather name="check" size={13} color={Colors.white} /> : null}
            <Text style={[styles.optionChipText, active && { color: Colors.white }]}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function SearchScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [franchises, setFranchises] = useState<string[]>([]);
  const [conditions, setConditions] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (franchises.length) params.set("franchise", franchises.join(","));
    if (conditions.length) params.set("condition", conditions.join(","));
    const s = params.toString();
    return s ? `?${s}` : "";
  }, [query, franchises, conditions]);

  const { data: listings, isLoading } = useQuery<ListingSummary[]>({ queryKey: [`/api/listings${queryString}`], enabled: query.length > 0 || franchises.length > 0 || conditions.length > 0 });
  const { data: favorites } = useQuery<ListingSummary[]>({ queryKey: ["/api/favorites"], enabled: !!user });
  const favoritedIds = useMemo(() => new Set((favorites ?? []).map((f) => f.id)), [favorites]);

  const toggle = (list: string[], setList: (v: string[]) => void, key: string) => {
    setList(list.includes(key) ? list.filter((x) => x !== key) : [...list, key]);
  };

  const activeFilterCount = franchises.length + conditions.length;
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
        <Pressable onPress={() => setFiltersOpen((v) => !v)} style={[styles.filterButton, activeFilterCount > 0 && styles.filterButtonActive]}>
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
  optionChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: Spacing.sm, paddingVertical: 6, borderRadius: BorderRadius.pill, borderWidth: 1, borderColor: Colors.border },
  optionChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  optionChipText: { ...Typography.small, color: Colors.text },
});
