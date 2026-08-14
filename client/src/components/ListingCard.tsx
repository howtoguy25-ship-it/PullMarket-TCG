import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View, Image, Platform, Alert } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Colors, Spacing, BorderRadius, Typography, Shadow } from "@/constants/theme";
import { apiJson, describeApiError } from "@/lib/api";
import { resolveImageUrl } from "@/lib/media";
import { PriceTag, Badge } from "./ui";
import { StarField } from "./StarField";
import { CONDITION_LABELS } from "@shared/validation";

export interface ListingSummary {
  id: string;
  title: string;
  priceCents: number;
  condition: string;
  franchise: string;
  quantityAvailable: number;
  status: string;
  images: string[];
  favoriteCount?: number;
  seller: { id: string; username: string } | null;
  isFavorited?: boolean;
}

export function ListingCard({
  listing,
  onPress,
  onRequireAuth,
  dark = false,
}: {
  listing: ListingSummary;
  onPress: () => void;
  onRequireAuth?: () => boolean;
  /** Renders the info panel (title/condition/price) as a dim galaxy panel
   * instead of a plain white card — used on screens with a galaxy
   * backdrop of their own (currently just Home) so the card doesn't sit
   * as a stark white block on a dark page. Screens still on the light
   * background (Search, Favorites, a seller's public profile) leave this
   * off and keep the original look. */
  dark?: boolean;
}) {
  const queryClient = useQueryClient();
  const [justAdded, setJustAdded] = useState(false);

  const showError = (message: string) => {
    if (Platform.OS === "web") window.alert(message);
    else Alert.alert("Couldn't add to cart", message);
  };

  const favoriteMutation = useMutation({
    mutationFn: () => apiJson<{ favorited: boolean }>("POST", `/api/favorites/${listing.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/favorites"] });
      queryClient.invalidateQueries({ queryKey: ["/api/listings"] });
    },
    onError: (err) => showError(describeApiError(err)),
  });

  const cartMutation = useMutation({
    mutationFn: () => apiJson("POST", "/api/cart", { listingId: listing.id, quantity: 1 }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cart"] });
      setJustAdded(true);
      setTimeout(() => setJustAdded(false), 1400);
    },
    onError: (err) => showError(describeApiError(err)),
  });

  const franchiseColor = listing.franchise === "pokemon" ? Colors.pokemon : listing.franchise === "one_piece" ? Colors.onePiece : Colors.gold;
  const franchiseLabel = listing.franchise === "pokemon" ? "Pokémon" : listing.franchise === "one_piece" ? "One Piece" : "Pokémon + One Piece";

  const handleGuarded = (action: () => void) => {
    if (onRequireAuth && !onRequireAuth()) return;
    action();
  };

  return (
    <Pressable onPress={onPress} style={[styles.card, Shadow.card, dark && styles.cardDark]}>
      <View style={styles.imageWrap}>
        {listing.images[0] ? (
          <Image source={{ uri: resolveImageUrl(listing.images[0]) }} style={styles.image} resizeMode="cover" />
        ) : (
          <View style={[styles.image, styles.imagePlaceholder]}>
            <Feather name="image" size={28} color={Colors.textMuted} />
          </View>
        )}

        <Pressable
          onPress={(e) => {
            e.stopPropagation?.();
            handleGuarded(() => favoriteMutation.mutate());
          }}
          style={styles.starButton}
          hitSlop={8}
        >
          <Ionicons name={listing.isFavorited ? "star" : "star-outline"} size={18} color={listing.isFavorited ? Colors.gold : Colors.white} />
        </Pressable>

        {listing.quantityAvailable > 1 ? <Badge label={`Qty ${listing.quantityAvailable}`} color={Colors.overlay} style={styles.qtyBadge} /> : null}

        {listing.status === "sold_out" ? (
          <View style={styles.soldOutOverlay}>
            <Text style={styles.soldOutText}>SOLD OUT</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.info}>
        {dark ? (
          <>
            <LinearGradient colors={["#1C1040", "#150C2E"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            <StarField count={7} />
          </>
        ) : null}
        <View style={[styles.franchiseChip, { backgroundColor: franchiseColor }]}>
          <Text style={styles.franchiseChipText} numberOfLines={1}>
            {franchiseLabel}
          </Text>
        </View>
        <Text style={[styles.title, dark && styles.titleDark]} numberOfLines={2}>
          {listing.title}
        </Text>
        <Text style={[styles.condition, dark && styles.conditionDark]}>{CONDITION_LABELS[listing.condition] ?? listing.condition}</Text>

        <View style={styles.bottomRow}>
          <PriceTag cents={listing.priceCents} style={dark ? styles.priceDark : undefined} />
          <Pressable
            onPress={(e) => {
              e.stopPropagation?.();
              handleGuarded(() => cartMutation.mutate());
            }}
            style={[styles.addButton, justAdded && styles.addButtonSuccess]}
            hitSlop={8}
            disabled={listing.status === "sold_out" || cartMutation.isPending}
          >
            <Feather name={justAdded ? "check" : "plus"} size={18} color={Colors.white} />
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    overflow: "hidden",
    margin: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardDark: { borderColor: "rgba(255,255,255,0.18)" },
  imageWrap: { aspectRatio: 0.8, backgroundColor: Colors.surfaceAlt, position: "relative" },
  image: { width: "100%", height: "100%" },
  imagePlaceholder: { alignItems: "center", justifyContent: "center" },
  starButton: {
    position: "absolute",
    top: Spacing.xs,
    right: Spacing.xs,
    backgroundColor: Colors.overlay,
    borderRadius: BorderRadius.pill,
    padding: 6,
  },
  qtyBadge: { position: "absolute", left: Spacing.xs, bottom: Spacing.xs },
  soldOutOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  soldOutText: { color: Colors.white, fontWeight: "800", fontSize: 13, letterSpacing: 1 },
  info: { padding: Spacing.sm, gap: 4, position: "relative" },
  franchiseChip: { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 2, borderRadius: BorderRadius.pill, maxWidth: "100%" },
  franchiseChipText: { color: Colors.white, fontSize: 10, fontWeight: "800" },
  title: { ...Typography.bodyBold, color: Colors.text, minHeight: 38 },
  titleDark: { color: Colors.white },
  condition: { ...Typography.small, color: Colors.textSecondary },
  conditionDark: { color: "rgba(255,255,255,0.7)" },
  priceDark: { color: Colors.gold },
  bottomRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  addButton: { backgroundColor: Colors.primary, borderRadius: BorderRadius.pill, width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  addButtonSuccess: { backgroundColor: Colors.success },
});
