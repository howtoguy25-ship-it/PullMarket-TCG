import React, { useState } from "react";
import { View, StyleSheet, Text, FlatList, Image, TextInput, Platform, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useRoute, RouteProp } from "@react-navigation/native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { Colors, Spacing, Typography, BorderRadius } from "@/constants/theme";
import { Button, Badge } from "@/components/ui";
import { RootStackParamList } from "@/navigation/types";
import { apiJson, ApiError } from "@/lib/api";
import { resolveImageUrl } from "@/lib/media";
import { BOOST_TIERS, formatBoostDuration } from "@shared/validation";

type Rt = RouteProp<RootStackParamList, "OwnerUserDetail">;

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

interface OwnerListing {
  id: string;
  title: string;
  priceCents: number;
  status: string;
  quantityAvailable: number;
  images: string[];
  isBoosted: boolean;
  ownerNote: string | null;
}

function BoostTierPicker({ onPick, disabled }: { onPick: (tierId: string) => void; disabled: boolean }) {
  return (
    <View style={styles.tierRow}>
      {BOOST_TIERS.map((tier) => (
        <Button
          key={tier.id}
          title={formatBoostDuration(tier.durationHours)}
          variant="gold"
          disabled={disabled}
          onPress={() => onPick(tier.id)}
          style={styles.tierButton}
        />
      ))}
    </View>
  );
}

function ListingCard({ listing, onBoost, onPing, boosting, pinging }: { listing: OwnerListing; onBoost: (tierId: string) => void; onPing: () => void; boosting: boolean; pinging: boolean }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState(listing.ownerNote ?? "");
  const [showTiers, setShowTiers] = useState(false);

  const noteMutation = useMutation({
    mutationFn: (text: string) => apiJson("PATCH", `/api/owner/listings/${listing.id}/note`, { note: text }),
    onSuccess: () => queryClient.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && q.queryKey[0].startsWith("/api/owner/users/") }),
    onError: (err) => showAlert("Couldn't save note", err instanceof ApiError ? err.message : "Please try again."),
  });

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        {listing.images[0] ? <Image source={{ uri: resolveImageUrl(listing.images[0]) }} style={styles.thumb} /> : <View style={[styles.thumb, styles.thumbPlaceholder]} />}
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {listing.title}
          </Text>
          <Text style={styles.cardPrice}>${(listing.priceCents / 100).toFixed(2)}</Text>
          <View style={styles.badgeRow}>
            <Badge label={listing.status} color={listing.status === "active" ? Colors.success : Colors.textMuted} />
            {listing.isBoosted ? <Badge label="Boosted" color={Colors.gold} textColor="#3A2A00" /> : null}
            <Text style={styles.qty}>Qty: {listing.quantityAvailable}</Text>
          </View>
        </View>
      </View>

      <View style={styles.actionRow}>
        <Button
          title={listing.isBoosted ? "Boost more (free)" : "Boost free"}
          variant="gold"
          onPress={() => setShowTiers((s) => !s)}
          disabled={boosting}
          style={{ flex: 1 }}
        />
        <Button title="Ping" variant="secondary" onPress={onPing} loading={pinging} style={{ flex: 1 }} />
      </View>
      {showTiers ? (
        <BoostTierPicker
          disabled={boosting}
          onPick={(tierId) => {
            setShowTiers(false);
            onBoost(tierId);
          }}
        />
      ) : null}

      <Text style={styles.noteLabel}>Owner note (internal only)</Text>
      <TextInput
        style={styles.noteInput}
        placeholder="Add a note about this listing…"
        placeholderTextColor={Colors.textMuted}
        value={note}
        onChangeText={setNote}
        multiline
      />
      {note !== (listing.ownerNote ?? "") ? (
        <Button title="Save note" variant="outline" onPress={() => noteMutation.mutate(note)} loading={noteMutation.isPending} style={{ marginTop: Spacing.xs }} />
      ) : null}
    </View>
  );
}

export default function OwnerUserDetailScreen() {
  const route = useRoute<Rt>();
  const { userId } = route.params;
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const queryClient = useQueryClient();

  const { data: listings, isLoading } = useQuery<OwnerListing[]>({ queryKey: [`/api/owner/users/${userId}/listings`] });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: [`/api/owner/users/${userId}/listings`] });

  const boostMutation = useMutation({
    mutationFn: ({ listingId, tierId }: { listingId: string; tierId: string }) => apiJson("POST", `/api/owner/listings/${listingId}/boost`, { tierId }),
    onSuccess: () => {
      showAlert("Boosted", "This listing is now pinned to the top of the marketplace — free of charge.");
      invalidate();
    },
    onError: (err) => showAlert("Couldn't boost listing", err instanceof ApiError ? err.message : "Please try again."),
  });

  const pingMutation = useMutation({
    mutationFn: (listingId: string) => apiJson<{ pinged: boolean; notified: number }>("POST", `/api/owner/listings/${listingId}/ping`),
    onSuccess: (data) => showAlert("Pinged", `Notified ${data.notified} follower${data.notified === 1 ? "" : "s"}/subscriber${data.notified === 1 ? "" : "s"} about this listing.`),
    onError: (err) => showAlert("Couldn't ping listing", err instanceof ApiError ? err.message : "Please try again."),
  });

  const [pendingId, setPendingId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <View style={[styles.container, { paddingTop: headerHeight }]}>
        <Text style={styles.loading}>Loading…</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: headerHeight }]}>
      <FlatList
        data={listings ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: Spacing.lg, paddingBottom: insets.bottom + Spacing.xl }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Feather name="package" size={28} color={Colors.textMuted} />
            <Text style={styles.emptyText}>This user hasn't listed anything yet.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <ListingCard
            listing={item}
            boosting={boostMutation.isPending && pendingId === item.id}
            pinging={pingMutation.isPending && pendingId === item.id}
            onBoost={(tierId) => {
              setPendingId(item.id);
              boostMutation.mutate({ listingId: item.id, tierId });
            }}
            onPing={() => {
              setPendingId(item.id);
              pingMutation.mutate(item.id);
            }}
          />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loading: { textAlign: "center", marginTop: Spacing.xl, color: Colors.textSecondary },
  emptyState: { alignItems: "center", gap: Spacing.sm, marginTop: Spacing.xxl },
  emptyText: { ...Typography.body, color: Colors.textMuted },
  card: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  cardTop: { flexDirection: "row", gap: Spacing.sm },
  thumb: { width: 60, height: 78, borderRadius: BorderRadius.sm, backgroundColor: Colors.surfaceAlt },
  thumbPlaceholder: { alignItems: "center", justifyContent: "center" },
  cardTitle: { ...Typography.bodyBold, color: Colors.text },
  cardPrice: { ...Typography.small, color: Colors.textSecondary, marginTop: 2 },
  badgeRow: { flexDirection: "row", alignItems: "center", gap: Spacing.xs, marginTop: Spacing.xs, flexWrap: "wrap" },
  qty: { ...Typography.small, color: Colors.textMuted },
  actionRow: { flexDirection: "row", gap: Spacing.sm, marginTop: Spacing.md },
  tierRow: { flexDirection: "row", gap: Spacing.xs, marginTop: Spacing.sm, flexWrap: "wrap" },
  tierButton: { flexGrow: 1, minWidth: 70 },
  noteLabel: { ...Typography.small, color: Colors.textSecondary, fontWeight: "700", marginTop: Spacing.md },
  noteInput: { borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.sm, padding: Spacing.sm, backgroundColor: Colors.surfaceAlt, minHeight: 60, textAlignVertical: "top", color: Colors.text, marginTop: 4 },
});
