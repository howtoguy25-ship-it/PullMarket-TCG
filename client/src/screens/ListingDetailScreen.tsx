import React, { useState } from "react";
import { View, StyleSheet, Text, ScrollView, Image, Pressable, Dimensions, Platform, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Colors, Spacing, Typography, BorderRadius, Shadow } from "@/constants/theme";
import { Button, PriceTag } from "@/components/ui";
import { Avatar } from "@/components/Avatar";
import { RootStackParamList } from "@/navigation/types";
import { apiJson, ApiError } from "@/lib/api";
import { resolveImageUrl } from "@/lib/media";
import { useAuth } from "@/contexts/AuthContext";
import { CONDITION_LABELS, SHIPPING_DEADLINE_BUSINESS_DAYS } from "@shared/validation";

type Nav = NativeStackNavigationProp<RootStackParamList, "ListingDetail">;
type Rt = RouteProp<RootStackParamList, "ListingDetail">;

const { width } = Dimensions.get("window");

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

interface ListingDetail {
  id: string;
  title: string;
  description: string;
  franchise: string;
  priceCents: number;
  condition: string;
  quantityAvailable: number;
  status: string;
  images: string[];
  seller: { id: string; username: string; avatarUrl: string | null } | null;
}

export default function ListingDetailScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const { listingId } = route.params;
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeImage, setActiveImage] = useState(0);

  const { data: listing, isLoading } = useQuery<ListingDetail>({ queryKey: [`/api/listings/${listingId}`] });
  const { data: favorites } = useQuery<{ id: string }[]>({ queryKey: ["/api/favorites"], enabled: !!user });
  const isFavorited = (favorites ?? []).some((f) => f.id === listingId);

  const favoriteMutation = useMutation({
    mutationFn: () => apiJson("POST", `/api/favorites/${listingId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/favorites"] }),
  });

  const cartMutation = useMutation({
    mutationFn: () => apiJson("POST", "/api/cart", { listingId, quantity: 1 }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cart"] });
      showAlert("Added to cart", "This card was added to your cart.");
    },
    onError: (err) => showAlert("Couldn't add to cart", err instanceof ApiError ? err.message : "Please try again."),
  });

  const requireAuth = (action: () => void) => {
    if (!user) {
      showAlert("Sign in required", "Sign in to favorite, buy, or report a listing.");
      return;
    }
    action();
  };

  if (isLoading || !listing) {
    return (
      <View style={[styles.container, { paddingTop: headerHeight }]}>
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    );
  }

  const franchiseLabel = listing.franchise === "pokemon" ? "Pokémon" : listing.franchise === "one_piece" ? "One Piece" : "Pokémon + One Piece";
  const isOwnListing = user?.id === listing.seller?.id;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xl }}>
      <View>
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => setActiveImage(Math.round(e.nativeEvent.contentOffset.x / width))}
        >
          {(listing.images.length ? listing.images : [null]).map((img, i) => (
            <Pressable key={i} onPress={() => img && navigation.navigate("ImageViewer", { images: listing.images, startIndex: i })} style={{ width }}>
              {img ? (
                <Image source={{ uri: resolveImageUrl(img) }} style={styles.heroImage} resizeMode="cover" />
              ) : (
                <View style={[styles.heroImage, styles.heroPlaceholder]}>
                  <Feather name="image" size={48} color={Colors.textMuted} />
                </View>
              )}
            </Pressable>
          ))}
        </ScrollView>
        {listing.images.length > 1 ? (
          <View style={styles.dots}>
            {listing.images.map((_, i) => (
              <View key={i} style={[styles.dotIndicator, i === activeImage && styles.dotIndicatorActive]} />
            ))}
          </View>
        ) : null}
        <Pressable
          onPress={() => requireAuth(() => favoriteMutation.mutate())}
          style={styles.favoriteFloating}
        >
          <Ionicons name={isFavorited ? "star" : "star-outline"} size={22} color={isFavorited ? Colors.gold : Colors.white} />
        </Pressable>
      </View>

      <View style={styles.separator} />

      <View style={styles.body}>
        <View style={[styles.franchiseChip, { backgroundColor: listing.franchise === "pokemon" ? Colors.pokemon : listing.franchise === "one_piece" ? Colors.onePiece : Colors.gold }]}>
          <Text style={styles.franchiseChipText}>{franchiseLabel}</Text>
        </View>

        <View style={styles.titleRow}>
          <Text style={styles.title}>{listing.title}</Text>
        </View>
        <PriceTag cents={listing.priceCents} style={{ fontSize: 26 }} />

        <View style={styles.metaRow}>
          <View style={styles.metaPill}>
            <Feather name="tag" size={13} color={Colors.textSecondary} />
            <Text style={styles.metaText}>{CONDITION_LABELS[listing.condition] ?? listing.condition}</Text>
          </View>
          <View style={styles.metaPill}>
            <Feather name="box" size={13} color={Colors.textSecondary} />
            <Text style={styles.metaText}>{listing.quantityAvailable} available</Text>
          </View>
          {listing.status === "sold_out" ? (
            <View style={[styles.metaPill, { backgroundColor: Colors.danger }]}>
              <Text style={[styles.metaText, { color: Colors.white }]}>Sold out</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.separatorInline} />

        <Text style={styles.sectionTitle}>Description</Text>
        <Text style={styles.description}>{listing.description || "No description provided."}</Text>

        <View style={styles.shippingNote}>
          <Feather name="truck" size={16} color={Colors.warning} />
          <Text style={styles.shippingNoteText}>Seller ships within {SHIPPING_DEADLINE_BUSINESS_DAYS} business days of purchase, with a tracked courier.</Text>
        </View>

        {listing.seller ? (
          <View style={styles.sellerRow}>
            <Avatar avatarUrl={listing.seller.avatarUrl} seed={listing.seller.username} size={38} />
            <Text style={styles.sellerName}>@{listing.seller.username}</Text>
          </View>
        ) : null}

        <Pressable onPress={() => requireAuth(() => navigation.navigate("Report", { listingId: listing.id }))} style={styles.reportRow}>
          <Feather name="flag" size={15} color={Colors.textSecondary} />
          <Text style={styles.reportText}>Report this listing</Text>
        </Pressable>
      </View>

      {!isOwnListing ? (
        <View style={[styles.footer, Shadow.card]}>
          <Button title="Add to Cart" variant="outline" icon={<Feather name="plus" size={18} color={Colors.primary} />} onPress={() => requireAuth(() => cartMutation.mutate())} loading={cartMutation.isPending} style={{ flex: 1 }} disabled={listing.status === "sold_out"} />
          <Button
            title="Buy Now"
            variant="primary"
            style={{ flex: 1 }}
            disabled={listing.status === "sold_out"}
            onPress={() =>
              requireAuth(async () => {
                await cartMutation.mutateAsync();
                navigation.navigate("Cart");
              })
            }
          />
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loadingText: { textAlign: "center", marginTop: Spacing.xl, color: Colors.textSecondary },
  heroImage: { width, aspectRatio: 1 },
  heroPlaceholder: { alignItems: "center", justifyContent: "center", backgroundColor: Colors.surfaceAlt },
  dots: { flexDirection: "row", justifyContent: "center", gap: 6, position: "absolute", bottom: Spacing.sm, alignSelf: "center" },
  dotIndicator: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.6)" },
  dotIndicatorActive: { backgroundColor: Colors.white, width: 18 },
  favoriteFloating: { position: "absolute", top: Spacing.md, right: Spacing.md, backgroundColor: Colors.overlay, padding: 10, borderRadius: BorderRadius.pill },
  separator: { height: 3, backgroundColor: Colors.primary },
  separatorInline: { height: 2, backgroundColor: Colors.primary, marginVertical: Spacing.sm, opacity: 0.85 },
  body: { padding: Spacing.lg, gap: Spacing.sm },
  franchiseChip: { alignSelf: "flex-start", paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: BorderRadius.pill },
  franchiseChipText: { color: Colors.white, fontWeight: "800", fontSize: 12 },
  titleRow: { marginTop: Spacing.xs },
  title: { ...Typography.h2, color: Colors.text },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm, marginTop: Spacing.xs },
  metaPill: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: Colors.surfaceAlt, paddingHorizontal: Spacing.sm, paddingVertical: 5, borderRadius: BorderRadius.pill },
  metaText: { ...Typography.small, color: Colors.textSecondary, fontWeight: "600" },
  sectionTitle: { ...Typography.bodyBold, color: Colors.text, marginTop: Spacing.md },
  description: { ...Typography.body, color: Colors.textSecondary, lineHeight: 21 },
  shippingNote: { flexDirection: "row", gap: Spacing.sm, alignItems: "flex-start", backgroundColor: "#FEF3E2", padding: Spacing.md, borderRadius: BorderRadius.md, marginTop: Spacing.md },
  shippingNoteText: { flex: 1, ...Typography.small, color: "#92650B" },
  sellerRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, marginTop: Spacing.lg },
  sellerName: { ...Typography.bodyBold, color: Colors.text },
  reportRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: Spacing.lg },
  reportText: { ...Typography.small, color: Colors.textSecondary, textDecorationLine: "underline" },
  footer: { flexDirection: "row", gap: Spacing.md, padding: Spacing.lg, backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.border },
});
