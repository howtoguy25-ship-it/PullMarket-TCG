import React from "react";
import { Pressable, StyleSheet, Text, View, Image, Linking } from "react-native";
import { Feather } from "@expo/vector-icons";
import { Colors, Spacing, BorderRadius, Typography, Shadow } from "@/constants/theme";
import { resolveImageUrl } from "@/lib/media";
import { PriceTag } from "./ui";

export interface EbayListingSummary {
  id: string;
  ebayItemId: string;
  title: string;
  franchise: string;
  priceCents: number;
  priceAudCents: number | null;
  currency: string;
  condition: string | null;
  imageUrl: string | null;
  affiliateUrl: string;
  sellerUsername: string | null;
  source: "ebay";
}

// Visually related to ListingCard (same card/image/price shell) but
// deliberately distinct enough that it never reads as one of this app's
// own listings: an "eBay" badge instead of the star/qty badges, no
// favorite or add-to-cart (this app never holds eBay inventory or takes
// eBay payment), and tapping hands off to eBay's own site/app via a real
// affiliate link built server-side.
export function EbayListingCard({ listing }: { listing: EbayListingSummary }) {
  const franchiseColor = listing.franchise === "pokemon" ? Colors.pokemon : Colors.onePiece;
  const franchiseLabel = listing.franchise === "pokemon" ? "Pokémon" : "One Piece";

  return (
    <Pressable onPress={() => Linking.openURL(listing.affiliateUrl)} style={[styles.card, Shadow.card]}>
      <View style={styles.imageWrap}>
        {listing.imageUrl ? (
          <Image source={{ uri: resolveImageUrl(listing.imageUrl) }} style={styles.image} resizeMode="cover" />
        ) : (
          <View style={[styles.image, styles.imagePlaceholder]}>
            <Feather name="image" size={28} color={Colors.textMuted} />
          </View>
        )}
        <View style={styles.ebayBadge}>
          <Text style={styles.ebayBadgeText}>eBay</Text>
        </View>
      </View>

      <View style={styles.info}>
        <View style={[styles.franchiseChip, { backgroundColor: franchiseColor }]}>
          <Text style={styles.franchiseChipText} numberOfLines={1}>
            {franchiseLabel}
          </Text>
        </View>
        <Text style={styles.title} numberOfLines={2}>
          {listing.title}
        </Text>
        {listing.sellerUsername ? (
          <Text style={styles.seller} numberOfLines={1}>
            eBay seller: {listing.sellerUsername}
          </Text>
        ) : null}

        <View style={styles.bottomRow}>
          <PriceTag cents={listing.priceAudCents ?? listing.priceCents} />
          <View style={styles.buyButton}>
            <Feather name="external-link" size={14} color={Colors.white} />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "47%",
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    overflow: "hidden",
    margin: Spacing.xs,
    borderWidth: 1.5,
    borderColor: "#E5352822", // eBay red, low opacity — a quiet visual tell this isn't a PullMarket listing
  },
  imageWrap: { aspectRatio: 0.8, backgroundColor: Colors.surfaceAlt, position: "relative" },
  image: { width: "100%", height: "100%" },
  imagePlaceholder: { alignItems: "center", justifyContent: "center" },
  ebayBadge: {
    position: "absolute",
    top: Spacing.xs,
    right: Spacing.xs,
    backgroundColor: Colors.white,
    borderRadius: BorderRadius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  ebayBadgeText: { color: "#E53528", fontSize: 10, fontWeight: "800" },
  info: { padding: Spacing.sm, gap: 4 },
  franchiseChip: { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 2, borderRadius: BorderRadius.pill, maxWidth: "100%" },
  franchiseChipText: { color: Colors.white, fontSize: 10, fontWeight: "800" },
  title: { ...Typography.bodyBold, color: Colors.text, minHeight: 38 },
  seller: { ...Typography.small, color: Colors.textMuted },
  bottomRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  buyButton: { backgroundColor: "#E53528", borderRadius: BorderRadius.pill, width: 30, height: 30, alignItems: "center", justifyContent: "center" },
});
