import React, { useEffect, useMemo, useState } from "react";
import { View, StyleSheet, Text, ScrollView, Pressable, Image, Platform, Alert, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Colors, Spacing, Typography, BorderRadius, Shadow } from "@/constants/theme";
import { EmptyState } from "@/components/ui";
import { HuntMap } from "@/components/HuntMap";
import { HuntEntryPay } from "@/components/HuntEntryPay";
import { resolveImageUrl } from "@/lib/media";
import { apiRequest, apiJson, ApiError } from "@/lib/api";
import { formatPriceCents } from "@/lib/format";
import { HUNT_REACTION_LABELS } from "@shared/validation";
import { HUNT_REACTION_MESSAGES } from "@shared/schema";
import { useAuth } from "@/contexts/AuthContext";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

interface HuntEntrySummary {
  userId: string;
  username: string;
  claimStatus: string;
  reactionMessage: string | null;
}
interface HuntGameResponse {
  id: string;
  status: "entry_open" | "revealed" | "ended";
  entryPriceCents: number;
  countdownEndsAt: string;
  leaderboardExpiresAt: string | null;
  myEntry: { id: string; paid: boolean; claimStatus: string; reactionMessage: string | null } | null;
  images: string[];
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number | null;
  winnerUsername: string | null;
  entries: HuntEntrySummary[];
}

function useCountdown(target: string | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!target) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);
  if (!target) return null;
  const msLeft = new Date(target).getTime() - now;
  if (msLeft <= 0) return "0:00:00";
  const h = Math.floor(msLeft / 3_600_000);
  const m = Math.floor((msLeft % 3_600_000) / 60_000);
  const s = Math.floor((msLeft % 60_000) / 1000);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function HuntScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [claiming, setClaiming] = useState(false);
  const [activeImage, setActiveImage] = useState(0);

  const { data, isLoading } = useQuery<{ game: HuntGameResponse | null }>({ queryKey: ["/api/hunt/current"], refetchInterval: 15_000 });
  const game = data?.game ?? null;

  const countdown = useCountdown(game?.status === "entry_open" ? game.countdownEndsAt : null);
  const leaderboardCountdown = useCountdown(game?.status === "ended" ? game.leaderboardExpiresAt : null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/hunt/current"] });

  const claimMutation = useMutation({
    mutationFn: async (uri: string) => {
      const form = new FormData();
      if (Platform.OS === "web") {
        const blob = await (await fetch(uri)).blob();
        form.append("image", blob, "claim.jpg");
      } else {
        form.append("image", { uri, name: "claim.jpg", type: "image/jpeg" } as unknown as Blob);
      }
      return apiRequest("POST", `/api/hunt/${game!.id}/claim`, form, true);
    },
    onSuccess: () => {
      invalidate();
      showAlert("Claim submitted!", "The owner will review your photo shortly.");
    },
    onError: (err) => showAlert("Couldn't submit claim", err instanceof ApiError ? err.message : "Please try again."),
    onSettled: () => setClaiming(false),
  });

  const reactMutation = useMutation({
    mutationFn: (message: string) => apiJson("POST", `/api/hunt/${game!.id}/react`, { message }),
    onSuccess: invalidate,
    onError: (err) => showAlert("Couldn't send", err instanceof ApiError ? err.message : "Please try again."),
  });

  const handleClaim = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return showAlert("Camera access needed", "Allow camera access to snap proof you found it.");
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    setClaiming(true);
    claimMutation.mutate(result.assets[0].uri);
  };

  const myLeaderboardEntry = useMemo(() => game?.entries.find((e) => e.userId === user?.id), [game, user]);
  const canClaim = game?.status === "revealed" && game.myEntry?.paid && (game.myEntry.claimStatus === "none" || game.myEntry.claimStatus === "rejected");
  const iWon = game?.status === "ended" && game.winnerUsername && myLeaderboardEntry?.claimStatus === "approved";
  const canReact = game?.status === "ended" && game.myEntry?.paid && !iWon && !myLeaderboardEntry?.reactionMessage;

  if (isLoading) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator color={Colors.gold} size="large" />
      </View>
    );
  }

  if (!game) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <EmptyState icon={<Feather name="map" size={40} color={Colors.textMuted} />} title="No Card Hunt right now" subtitle="Check back soon — the owner schedules these live!" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xl }}>
      <LinearGradient colors={["#1A0F35", "#3B1F6B", "#0B0716"]} style={[styles.hero, { paddingTop: insets.top + Spacing.lg }]}>
        <View style={styles.compassRing}>
          <Feather name="compass" size={28} color={Colors.gold} />
        </View>
        <Text style={styles.heroTitle}>CARD HUNT</Text>
        <Text style={styles.heroSubtitle}>A real card, hidden somewhere real.</Text>

        {game.status === "entry_open" ? (
          <View style={styles.countdownBox}>
            <Text style={styles.countdownLabel}>REVEAL COMING IN</Text>
            <Text style={styles.countdownValue}>{countdown}</Text>
          </View>
        ) : game.status === "revealed" ? (
          <View style={styles.liveBadge}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>LIVE — GO FIND IT</Text>
          </View>
        ) : (
          <View style={styles.endedBadge}>
            <Feather name="flag" size={14} color={Colors.white} />
            <Text style={styles.liveText}>HUNT OVER</Text>
          </View>
        )}
      </LinearGradient>

      {game.status === "entry_open" ? (
        <View style={styles.section}>
          <View style={[styles.priceCard, Shadow.card]}>
            <Feather name="dollar-sign" size={22} color={Colors.gold} />
            <View style={{ flex: 1 }}>
              <Text style={styles.priceLabel}>One-time entry</Text>
              <Text style={styles.priceValue}>{formatPriceCents(game.entryPriceCents)}</Text>
            </View>
          </View>
          {game.myEntry?.paid ? (
            <View style={styles.inBadge}>
              <Feather name="check-circle" size={18} color={Colors.success} />
              <Text style={styles.inBadgeText}>You're in! Photos and the map drop the moment it's revealed.</Text>
            </View>
          ) : (
            <HuntEntryPay gameId={game.id} priceCents={game.entryPriceCents} onPaid={invalidate} />
          )}
        </View>
      ) : null}

      {game.status !== "entry_open" && game.images.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📸 The clue</Text>
          <Image source={{ uri: resolveImageUrl(game.images[activeImage]) }} style={styles.heroImage} resizeMode="cover" />
          {game.images.length > 1 ? (
            <View style={styles.thumbRow}>
              {game.images.map((img, i) => (
                <Pressable key={img} onPress={() => setActiveImage(i)} style={[styles.thumbWrap, i === activeImage && styles.thumbWrapActive]}>
                  <Image source={{ uri: resolveImageUrl(img) }} style={styles.thumb} />
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {game.status !== "entry_open" && game.latitude != null && game.longitude != null && game.radiusMeters != null ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🗺️ Search area</Text>
          <Text style={styles.mapHint}>It's somewhere within this circle — not the exact spot.</Text>
          <HuntMap latitude={game.latitude} longitude={game.longitude} radiusMeters={game.radiusMeters} />
        </View>
      ) : null}

      {canClaim ? (
        <View style={styles.section}>
          <Pressable style={[styles.claimButton, Shadow.card]} onPress={handleClaim} disabled={claiming}>
            <Feather name="camera" size={20} color={Colors.white} />
            <Text style={styles.claimButtonText}>{claiming ? "Submitting…" : "I found it! Snap proof"}</Text>
          </Pressable>
          {game.myEntry?.claimStatus === "pending" ? <Text style={styles.pendingNote}>Your claim is waiting on the owner's review.</Text> : null}
        </View>
      ) : null}

      {game.status === "ended" && game.winnerUsername ? (
        <View style={styles.section}>
          <LinearGradient colors={["#B8860B", "#FFCB05"]} style={styles.winnerBanner}>
            <Feather name="award" size={26} color="#3A2A00" />
            <Text style={styles.winnerText}>@{game.winnerUsername} found it!</Text>
          </LinearGradient>
          {leaderboardCountdown ? <Text style={styles.expiryNote}>Leaderboard closes in {leaderboardCountdown}</Text> : null}
        </View>
      ) : null}

      {game.entries.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🏆 Leaderboard</Text>
          <View style={styles.leaderboardGrid}>
            {game.entries.map((e) => (
              <View key={e.userId} style={[styles.leaderRow, e.username === game.winnerUsername && styles.leaderRowWinner]}>
                <Text style={styles.leaderName} numberOfLines={1}>
                  @{e.username}
                </Text>
                {e.claimStatus === "approved" ? <Feather name="check-circle" size={16} color={Colors.success} /> : null}
                {e.reactionMessage ? <Text style={styles.leaderReaction}>{HUNT_REACTION_LABELS[e.reactionMessage]}</Text> : null}
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {canReact ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Send @{game.winnerUsername} a message</Text>
          <View style={styles.reactionRow}>
            {HUNT_REACTION_MESSAGES.map((key) => (
              <Pressable key={key} style={styles.reactionChip} onPress={() => reactMutation.mutate(key)} disabled={reactMutation.isPending}>
                <Text style={styles.reactionChipText}>{HUNT_REACTION_LABELS[key]}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: Colors.background },
  hero: { alignItems: "center", paddingBottom: Spacing.xl, paddingHorizontal: Spacing.lg, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  compassRing: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: Colors.gold,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.sm,
  },
  heroTitle: { fontSize: 26, fontWeight: "900", letterSpacing: 3, color: Colors.gold },
  heroSubtitle: { ...Typography.small, color: "rgba(255,255,255,0.75)", marginTop: 2, marginBottom: Spacing.md },
  countdownBox: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.08)", borderRadius: BorderRadius.lg, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.xl, borderWidth: 1, borderColor: "rgba(255,203,5,0.4)" },
  countdownLabel: { color: "rgba(255,255,255,0.6)", fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  countdownValue: { color: Colors.white, fontSize: 32, fontWeight: "800", fontVariant: ["tabular-nums"], marginTop: 2 },
  liveBadge: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(52,199,89,0.18)", borderRadius: BorderRadius.pill, paddingVertical: 8, paddingHorizontal: Spacing.lg, borderWidth: 1, borderColor: Colors.success },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.success },
  endedBadge: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.1)", borderRadius: BorderRadius.pill, paddingVertical: 8, paddingHorizontal: Spacing.lg },
  liveText: { color: Colors.white, fontSize: 12, fontWeight: "800", letterSpacing: 1 },
  section: { paddingHorizontal: Spacing.lg, marginTop: Spacing.lg },
  sectionTitle: { ...Typography.h3, color: Colors.text, marginBottom: Spacing.sm },
  priceCard: { flexDirection: "row", alignItems: "center", gap: Spacing.md, backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, borderWidth: 1.5, borderColor: Colors.gold, padding: Spacing.md },
  priceLabel: { ...Typography.small, color: Colors.textSecondary },
  priceValue: { fontSize: 24, fontWeight: "800", color: Colors.text },
  inBadge: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, marginTop: Spacing.md, backgroundColor: "rgba(52,199,89,0.1)", borderRadius: BorderRadius.md, padding: Spacing.md },
  inBadgeText: { ...Typography.small, color: Colors.text, flex: 1 },
  heroImage: { width: "100%", aspectRatio: 1, borderRadius: BorderRadius.lg, backgroundColor: Colors.surfaceAlt },
  thumbRow: { flexDirection: "row", gap: Spacing.sm, marginTop: Spacing.sm },
  thumbWrap: { borderRadius: BorderRadius.sm, overflow: "hidden", borderWidth: 2, borderColor: "transparent" },
  thumbWrapActive: { borderColor: Colors.gold },
  thumb: { width: 56, height: 56 },
  mapHint: { ...Typography.small, color: Colors.textMuted, marginBottom: Spacing.sm },
  claimButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: Spacing.sm, backgroundColor: Colors.primary, borderRadius: BorderRadius.pill, paddingVertical: 16 },
  claimButtonText: { color: Colors.white, fontWeight: "800", fontSize: 16 },
  pendingNote: { ...Typography.small, color: Colors.textMuted, textAlign: "center", marginTop: Spacing.sm },
  winnerBanner: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: Spacing.sm, borderRadius: BorderRadius.lg, paddingVertical: Spacing.md },
  winnerText: { color: "#3A2A00", fontWeight: "800", fontSize: 17 },
  expiryNote: { ...Typography.small, color: Colors.textMuted, textAlign: "center", marginTop: Spacing.xs },
  leaderboardGrid: { gap: Spacing.xs },
  leaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 10,
    paddingHorizontal: Spacing.md,
  },
  leaderRowWinner: { borderColor: Colors.gold, backgroundColor: "rgba(255,203,5,0.08)" },
  leaderName: { ...Typography.bodyBold, color: Colors.text, flex: 1 },
  leaderReaction: { ...Typography.small, color: Colors.textSecondary, fontStyle: "italic" },
  reactionRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  reactionChip: { backgroundColor: Colors.surfaceAlt, borderRadius: BorderRadius.pill, borderWidth: 1, borderColor: Colors.border, paddingVertical: 8, paddingHorizontal: Spacing.md },
  reactionChipText: { ...Typography.small, color: Colors.text, fontWeight: "600" },
});
