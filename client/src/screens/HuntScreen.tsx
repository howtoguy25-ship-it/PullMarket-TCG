import React, { useEffect, useMemo, useState } from "react";
import { View, StyleSheet, Text, ScrollView, Pressable, Image, Platform, Alert, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Colors, Spacing, Typography, BorderRadius, Shadow } from "@/constants/theme";
import { EmptyState } from "@/components/ui";
import { HuntMap } from "@/components/HuntMap";
import { HuntEntryPay } from "@/components/HuntEntryPay";
import { RootStackParamList } from "@/navigation/types";
import { resolveImageUrl } from "@/lib/media";
import { apiRequest, apiJson, ApiError } from "@/lib/api";
import { formatPriceCents } from "@/lib/format";
import { HUNT_REACTION_LABELS } from "@shared/validation";
import { HUNT_REACTION_MESSAGES } from "@shared/schema";
import { useAuth } from "@/contexts/AuthContext";

type Nav = NativeStackNavigationProp<RootStackParamList>;

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

interface HuntTarget {
  index: number;
  images: string[];
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number | null;
  winnerUserId: string | null;
  winnerUsername: string | null;
  myClaimStatus: "pending" | "approved" | "rejected" | null;
}
interface HuntEntrySummary {
  userId: string;
  username: string;
  reactionMessage: string | null;
}
interface HuntGameResponse {
  id: string;
  status: "entry_open" | "revealed" | "ended";
  entryPriceCents: number;
  countdownEndsAt: string;
  leaderboardExpiresAt: string | null;
  cardCount: number;
  basePoints: number;
  speedBonusThresholdMinutes: number;
  speedBonusPoints: number;
  myEntry: { id: string; paid: boolean; reactionMessage: string | null } | null;
  targets: HuntTarget[];
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

function TargetCard({ game, target, onClaimed }: { game: HuntGameResponse; target: HuntTarget; onClaimed: () => void }) {
  const [activeImage, setActiveImage] = useState(0);
  const [claiming, setClaiming] = useState(false);

  const claimMutation = useMutation({
    mutationFn: async (uri: string) => {
      const form = new FormData();
      if (Platform.OS === "web") {
        const blob = await (await fetch(uri)).blob();
        form.append("image", blob, "claim.jpg");
      } else {
        form.append("image", { uri, name: "claim.jpg", type: "image/jpeg" } as unknown as Blob);
      }
      return apiRequest("POST", `/api/hunt/${game.id}/targets/${target.index}/claim`, form, true);
    },
    onSuccess: () => {
      onClaimed();
      showAlert("Claim submitted!", "The owner will review your photo shortly.");
    },
    onError: (err) => showAlert("Couldn't submit claim", err instanceof ApiError ? err.message : "Please try again."),
    onSettled: () => setClaiming(false),
  });

  const handleClaim = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return showAlert("Camera access needed", "Allow camera access to snap proof you found it.");
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    setClaiming(true);
    claimMutation.mutate(result.assets[0].uri);
  };

  const canClaim = game.status === "revealed" && game.myEntry?.paid && !target.winnerUserId && (target.myClaimStatus === null || target.myClaimStatus === "rejected");

  return (
    <View style={[styles.targetCard, Shadow.card]}>
      <View style={styles.targetHeaderRow}>
        <Text style={styles.targetLabel}>Card {target.index + 1}{game.cardCount > 1 ? ` of ${game.cardCount}` : ""}</Text>
        {target.winnerUsername ? (
          <View style={styles.foundBadge}>
            <Feather name="check-circle" size={12} color={Colors.white} />
            <Text style={styles.foundBadgeText}>Found by @{target.winnerUsername}</Text>
          </View>
        ) : null}
      </View>

      {target.images.length > 0 ? (
        <>
          <Image source={{ uri: resolveImageUrl(target.images[activeImage]) }} style={styles.heroImage} resizeMode="cover" />
          {target.images.length > 1 ? (
            <View style={styles.thumbRow}>
              {target.images.map((img, i) => (
                <Pressable key={img} onPress={() => setActiveImage(i)} style={[styles.thumbWrap, i === activeImage && styles.thumbWrapActive]}>
                  <Image source={{ uri: resolveImageUrl(img) }} style={styles.thumb} />
                </Pressable>
              ))}
            </View>
          ) : null}
        </>
      ) : null}

      {target.latitude != null && target.longitude != null && target.radiusMeters != null ? (
        <>
          <Text style={styles.mapHint}>It's somewhere within this circle — not the exact spot.</Text>
          <HuntMap latitude={target.latitude} longitude={target.longitude} radiusMeters={target.radiusMeters} />
        </>
      ) : null}

      {canClaim ? (
        <Pressable style={styles.claimButton} onPress={handleClaim} disabled={claiming}>
          <Feather name="camera" size={20} color={Colors.white} />
          <Text style={styles.claimButtonText}>{claiming ? "Submitting…" : "I found it! Snap proof"}</Text>
        </Pressable>
      ) : target.myClaimStatus === "pending" ? (
        <Text style={styles.pendingNote}>Your claim is waiting on the owner's review.</Text>
      ) : null}
    </View>
  );
}

export default function HuntScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const { data, isLoading } = useQuery<{ game: HuntGameResponse | null }>({ queryKey: ["/api/hunt/current"], refetchInterval: 15_000 });
  const game = data?.game ?? null;

  const countdown = useCountdown(game?.status === "entry_open" ? game.countdownEndsAt : null);
  const leaderboardCountdown = useCountdown(game?.status === "ended" ? game.leaderboardExpiresAt : null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/hunt/current"] });

  const reactMutation = useMutation({
    mutationFn: (message: string) => apiJson("POST", `/api/hunt/${game!.id}/react`, { message }),
    onSuccess: invalidate,
    onError: (err) => showAlert("Couldn't send", err instanceof ApiError ? err.message : "Please try again."),
  });

  const winners = useMemo(() => (game?.targets ?? []).filter((t) => t.winnerUsername), [game]);
  const iWon = useMemo(() => winners.some((t) => t.winnerUserId === user?.id), [winners, user]);
  const canReact = game?.status === "ended" && game.myEntry?.paid && !iWon && !game.myEntry.reactionMessage;

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
        <Text style={styles.heroSubtitle}>{game.cardCount > 1 ? `${game.cardCount} real cards, hidden somewhere real.` : "A real card, hidden somewhere real."}</Text>

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
          <View style={styles.pointsHintRow}>
            <Feather name="zap" size={13} color={Colors.gold} />
            <Text style={styles.pointsHintText}>
              {game.basePoints}+ points per find — find it within {game.speedBonusThresholdMinutes} min of reveal for +{game.speedBonusPoints} bonus
            </Text>
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

      {game.status !== "entry_open"
        ? game.targets.map((target) => (
            <View key={target.index} style={styles.section}>
              <TargetCard game={game} target={target} onClaimed={invalidate} />
            </View>
          ))
        : null}

      {game.status === "ended" && winners.length > 0 ? (
        <View style={styles.section}>
          {winners.map((t) => (
            <LinearGradient key={t.index} colors={["#B8860B", "#FFCB05"]} style={styles.winnerBanner}>
              <Feather name="award" size={22} color="#3A2A00" />
              <Text style={styles.winnerText}>
                @{t.winnerUsername} found Card {t.index + 1}!
              </Text>
            </LinearGradient>
          ))}
          {leaderboardCountdown ? <Text style={styles.expiryNote}>Leaderboard closes in {leaderboardCountdown}</Text> : null}
        </View>
      ) : null}

      {game.entries.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🏆 Leaderboard</Text>
          <View style={styles.leaderboardGrid}>
            {game.entries.map((e) => {
              const wonHere = winners.filter((t) => t.winnerUserId === e.userId).length;
              return (
                <Pressable
                  key={e.userId}
                  style={[styles.leaderRow, wonHere > 0 && styles.leaderRowWinner]}
                  onPress={() => navigation.navigate("HuntUserStats", { userId: e.userId, username: e.username })}
                >
                  <Text style={styles.leaderName} numberOfLines={1}>
                    @{e.username}
                  </Text>
                  {wonHere > 0 ? (
                    <View style={styles.wonPill}>
                      <Feather name="check-circle" size={12} color={Colors.white} />
                      <Text style={styles.wonPillText}>{wonHere > 1 ? `Won ${wonHere}` : "Won"}</Text>
                    </View>
                  ) : null}
                  {e.reactionMessage ? <Text style={styles.leaderReaction}>{HUNT_REACTION_LABELS[e.reactionMessage]}</Text> : null}
                  <Feather name="chevron-right" size={16} color={Colors.textMuted} />
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {canReact ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Send the winner{winners.length > 1 ? "s" : ""} a message</Text>
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
  heroSubtitle: { ...Typography.small, color: "rgba(255,255,255,0.75)", marginTop: 2, marginBottom: Spacing.md, textAlign: "center" },
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
  pointsHintRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: Spacing.sm },
  pointsHintText: { ...Typography.small, color: Colors.textSecondary, flex: 1 },
  inBadge: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, marginTop: Spacing.md, backgroundColor: "rgba(52,199,89,0.1)", borderRadius: BorderRadius.md, padding: Spacing.md },
  inBadgeText: { ...Typography.small, color: Colors.text, flex: 1 },
  targetCard: { backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, gap: Spacing.sm },
  targetHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  targetLabel: { ...Typography.bodyBold, color: Colors.text },
  foundBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: Colors.success, borderRadius: BorderRadius.pill, paddingVertical: 4, paddingHorizontal: Spacing.sm },
  foundBadgeText: { color: Colors.white, fontSize: 11, fontWeight: "700" },
  heroImage: { width: "100%", aspectRatio: 1, borderRadius: BorderRadius.lg, backgroundColor: Colors.surfaceAlt },
  thumbRow: { flexDirection: "row", gap: Spacing.sm },
  thumbWrap: { borderRadius: BorderRadius.sm, overflow: "hidden", borderWidth: 2, borderColor: "transparent" },
  thumbWrapActive: { borderColor: Colors.gold },
  thumb: { width: 56, height: 56 },
  mapHint: { ...Typography.small, color: Colors.textMuted },
  claimButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: Spacing.sm, backgroundColor: Colors.primary, borderRadius: BorderRadius.pill, paddingVertical: 16 },
  claimButtonText: { color: Colors.white, fontWeight: "800", fontSize: 16 },
  pendingNote: { ...Typography.small, color: Colors.textMuted, textAlign: "center" },
  winnerBanner: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: Spacing.sm, borderRadius: BorderRadius.lg, paddingVertical: Spacing.md, marginBottom: Spacing.sm },
  winnerText: { color: "#3A2A00", fontWeight: "800", fontSize: 16 },
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
    paddingVertical: 12,
    paddingHorizontal: Spacing.md,
  },
  leaderRowWinner: { borderColor: Colors.gold, backgroundColor: "rgba(255,203,5,0.08)" },
  leaderName: { ...Typography.bodyBold, color: Colors.text, flex: 1 },
  wonPill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: Colors.success, borderRadius: BorderRadius.pill, paddingVertical: 3, paddingHorizontal: 8 },
  wonPillText: { color: Colors.white, fontSize: 10, fontWeight: "700" },
  leaderReaction: { ...Typography.small, color: Colors.textSecondary, fontStyle: "italic" },
  reactionRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  reactionChip: { backgroundColor: Colors.surfaceAlt, borderRadius: BorderRadius.pill, borderWidth: 1, borderColor: Colors.border, paddingVertical: 8, paddingHorizontal: Spacing.md },
  reactionChipText: { ...Typography.small, color: Colors.text, fontWeight: "600" },
});
