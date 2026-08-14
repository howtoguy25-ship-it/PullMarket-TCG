import React, { useState } from "react";
import { View, StyleSheet, Text, Image, Pressable, ActivityIndicator, Platform, Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Colors, Spacing, Typography, BorderRadius } from "@/constants/theme";
import { EmptyState } from "@/components/ui";
import { PriceTag } from "@/components/ui";
import { ListingOptionsSheet } from "@/components/ListingOptionsSheet";
import { apiJson, describeApiError } from "@/lib/api";
import { resolveImageUrl } from "@/lib/media";
import { RootStackParamList } from "@/navigation/types";
import { CONDITION_LABELS, LISTING_REVISION_LIMIT } from "@shared/validation";

type Nav = NativeStackNavigationProp<RootStackParamList>;

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

interface MyListing {
  id: string;
  title: string;
  priceCents: number;
  condition: string;
  status: string;
  quantityAvailable: number;
  revisionCount: number;
  images: string[];
}

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  active: { label: "Active", color: "#0F7A3D", bg: "#E4F6EB" },
  sold_out: { label: "Sold Out", color: "#92650B", bg: "#FEF3E2" },
  unlisted: { label: "Unlisted", color: "#6B7280", bg: "#F1F2F4" },
  removed: { label: "Removed by moderator", color: Colors.danger, bg: "#FDE8E8" },
  deleted: { label: "Deleted", color: Colors.textMuted, bg: "#F1F2F4" },
};

/** A stepper for live stock count — free to use as often as needed, unlike
 * the capped re-edit flow, since restocking is routine seller upkeep. */
function StockEditor({ listing }: { listing: MyListing }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(listing.quantityAvailable);
  const [expanded, setExpanded] = useState(false);
  const inStock = listing.quantityAvailable > 0;

  const stockMutation = useMutation({
    mutationFn: (quantityAvailable: number) => apiJson("PATCH", `/api/listings/${listing.id}/stock`, { quantityAvailable }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/listings/mine"] });
      queryClient.invalidateQueries({ queryKey: [`/api/listings/${listing.id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/listings"] });
      setExpanded(false);
    },
    onError: (err) => showAlert("Couldn't update stock", describeApiError(err)),
  });

  if (!expanded) {
    return (
      <Pressable
        onPress={(e) => {
          e.stopPropagation?.();
          setDraft(listing.quantityAvailable);
          setExpanded(true);
        }}
        style={styles.stockPill}
      >
        <View style={[styles.stockDot, { backgroundColor: inStock ? "#0F7A3D" : Colors.danger }]} />
        <Text style={[styles.stockText, { color: inStock ? "#0F7A3D" : Colors.danger }]}>{inStock ? `${listing.quantityAvailable} in stock` : "Out of stock"}</Text>
        <Feather name="edit-2" size={11} color={Colors.textMuted} />
      </Pressable>
    );
  }

  return (
    <View style={styles.stockEditorRow} onStartShouldSetResponder={() => true}>
      <Pressable onPress={() => setDraft((q) => Math.max(0, q - 1))} style={styles.stockStepBtn} hitSlop={6}>
        <Feather name="minus" size={14} color={Colors.text} />
      </Pressable>
      <Text style={styles.stockDraftValue}>{draft}</Text>
      <Pressable onPress={() => setDraft((q) => Math.min(999, q + 1))} style={styles.stockStepBtn} hitSlop={6}>
        <Feather name="plus" size={14} color={Colors.text} />
      </Pressable>
      <Pressable onPress={() => stockMutation.mutate(draft)} disabled={stockMutation.isPending} style={styles.stockSaveBtn}>
        {stockMutation.isPending ? <ActivityIndicator size="small" color={Colors.white} /> : <Text style={styles.stockSaveText}>Save</Text>}
      </Pressable>
      <Pressable onPress={() => setExpanded(false)} hitSlop={6}>
        <Feather name="x" size={16} color={Colors.textMuted} />
      </Pressable>
    </View>
  );
}

function ListingRow({ listing, onManage }: { listing: MyListing; onManage: () => void }) {
  const navigation = useNavigation<Nav>();
  const meta = STATUS_META[listing.status] ?? STATUS_META.active;
  const revisionsLeft = Math.max(0, LISTING_REVISION_LIMIT - listing.revisionCount);
  const canEditStock = listing.status === "active" || listing.status === "sold_out";

  return (
    <Pressable style={[styles.row, { borderLeftWidth: 4, borderLeftColor: meta.color }]} onPress={() => navigation.navigate("ListingDetail", { listingId: listing.id })}>
      {listing.images[0] ? (
        <Image source={{ uri: resolveImageUrl(listing.images[0]) }} style={styles.thumb} />
      ) : (
        <View style={[styles.thumb, styles.thumbPlaceholder]}>
          <Feather name="image" size={20} color={Colors.textMuted} />
        </View>
      )}
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {listing.title}
        </Text>
        <View style={styles.rowMetaLine}>
          <PriceTag cents={listing.priceCents} style={{ fontSize: 14 }} />
          <Text style={styles.rowMetaDot}>·</Text>
          <Text style={styles.rowMetaText}>{CONDITION_LABELS[listing.condition] ?? listing.condition}</Text>
        </View>
        <View style={styles.rowFooterLine}>
          <View style={[styles.statusChip, { backgroundColor: meta.bg }]}>
            <Text style={[styles.statusChipText, { color: meta.color }]}>{meta.label}</Text>
          </View>
          {listing.status !== "removed" && listing.status !== "deleted" ? (
            <Text style={styles.revisionText}>
              {revisionsLeft} edit{revisionsLeft === 1 ? "" : "s"}/unlists left
            </Text>
          ) : null}
        </View>
        {canEditStock ? <StockEditor listing={listing} /> : null}
      </View>
      <Pressable
        onPress={(e) => {
          e.stopPropagation?.();
          onManage();
        }}
        hitSlop={10}
        style={styles.moreButton}
        testID={`listing-more-${listing.id}`}
      >
        <Feather name="more-vertical" size={20} color={Colors.textSecondary} />
      </Pressable>
    </Pressable>
  );
}

/** "My Listings" — every status a seller's listing can be in, with a
 * per-listing 3-dot menu (edit/unlist/relist/delete/share), reusing the
 * same ListingOptionsSheet the listing detail page uses for consistency. */
export function MyListingsPanel() {
  const { data: listings, isLoading } = useQuery<MyListing[]>({ queryKey: ["/api/listings/mine"] });
  const [managing, setManing] = useState<MyListing | null>(null);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  if (!listings || listings.length === 0) {
    return (
      <View style={styles.emptyWrap}>
        <EmptyState icon={<Feather name="package" size={40} color={Colors.textMuted} />} title="No listings yet" subtitle="Cards you list will show up here for you to manage." />
      </View>
    );
  }

  return (
    <View style={styles.list}>
      {listings.map((listing) => (
        <ListingRow key={listing.id} listing={listing} onManage={() => setManing(listing)} />
      ))}
      <ListingOptionsSheet visible={!!managing} listing={managing} onClose={() => setManing(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { paddingVertical: Spacing.xxl, alignItems: "center" },
  emptyWrap: { paddingTop: Spacing.xxl, paddingHorizontal: Spacing.lg },
  list: { padding: Spacing.lg, paddingBottom: Spacing.xl, gap: Spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.sm,
  },
  thumb: { width: 56, height: 72, borderRadius: BorderRadius.md, backgroundColor: Colors.surfaceAlt },
  thumbPlaceholder: { alignItems: "center", justifyContent: "center" },
  rowBody: { flex: 1, gap: 4 },
  rowTitle: { ...Typography.bodyBold, color: Colors.text },
  rowMetaLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  rowMetaDot: { color: Colors.textMuted },
  rowMetaText: { ...Typography.small, color: Colors.textSecondary },
  rowFooterLine: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, marginTop: 2 },
  statusChip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: BorderRadius.pill },
  statusChipText: { fontSize: 11, fontWeight: "800" },
  revisionText: { ...Typography.small, color: Colors.textMuted, fontSize: 11 },
  moreButton: { padding: Spacing.xs },
  stockPill: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4, alignSelf: "flex-start" },
  stockDot: { width: 7, height: 7, borderRadius: 4 },
  stockText: { fontSize: 12, fontWeight: "800" },
  stockEditorRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  stockStepBtn: { width: 24, height: 24, borderRadius: 12, backgroundColor: Colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
  stockDraftValue: { ...Typography.bodyBold, color: Colors.text, minWidth: 24, textAlign: "center" },
  stockSaveBtn: { backgroundColor: Colors.primary, borderRadius: BorderRadius.pill, paddingHorizontal: 12, paddingVertical: 5 },
  stockSaveText: { color: Colors.white, fontSize: 12, fontWeight: "800" },
});
