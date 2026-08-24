import React, { useState } from "react";
import { View, StyleSheet, Text, ScrollView, TextInput, Pressable, Image, Platform, Alert, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Colors, Spacing, Typography, BorderRadius, Shadow, Fonts } from "@/constants/theme";
import { Button } from "@/components/ui";
import { HuntMap } from "@/components/HuntMap";
import { RootStackParamList } from "@/navigation/types";
import { resolveImageUrl } from "@/lib/media";
import { apiRequest, apiJson, ApiError } from "@/lib/api";
import { formatPriceCents } from "@/lib/format";
import { appendImageToFormData } from "@/lib/formDataImage";
import { HUNT_PRICE_TIERS_CENTS, HUNT_MAX_IMAGES, HUNT_MAX_CARDS, HUNT_DEFAULT_BASE_POINTS, HUNT_DEFAULT_SPEED_BONUS_THRESHOLD_MINUTES, HUNT_DEFAULT_SPEED_BONUS_POINTS } from "@shared/validation";

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
}
interface HuntGameResponse {
  id: string;
  status: "entry_open" | "revealed" | "ended";
  entryPriceCents: number;
  cardCount: number;
  basePoints: number;
  speedBonusThresholdMinutes: number;
  speedBonusPoints: number;
  targets: HuntTarget[];
}
interface OwnerClaim {
  id: string;
  targetId: string;
  targetIndex: number;
  userId: string;
  username: string;
  imageUrl: string;
  status: string;
  claimedAt: string;
  pointsAwarded: number | null;
}

function SectionHeading({ icon, color, title }: { icon: keyof typeof Feather.glyphMap; color: string; title: string }) {
  return (
    <View style={styles.sectionHeading}>
      <View style={[styles.sectionBadge, { backgroundColor: `${color}1F` }]}>
        <Feather name={icon} size={14} color={color} />
      </View>
      <Text style={styles.sectionHeadingText}>{title}</Text>
    </View>
  );
}

function GradientButton({
  title,
  onPress,
  loading,
  disabled,
  colors,
  icon,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  colors: [string, string, ...string[]];
  icon?: keyof typeof Feather.glyphMap;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled || loading} style={({ pressed }) => ({ opacity: disabled ? 0.5 : pressed ? 0.85 : 1 })}>
      <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.gradientBtn}>
        {loading ? (
          <ActivityIndicator color={Colors.white} />
        ) : (
          <>
            {icon ? <Feather name={icon} size={16} color={Colors.white} /> : null}
            <Text style={styles.gradientBtnText}>{title}</Text>
          </>
        )}
      </LinearGradient>
    </Pressable>
  );
}

function CreateHuntForm({ onCreated }: { onCreated: () => void }) {
  const [priceCents, setPriceCents] = useState<number>(HUNT_PRICE_TIERS_CENTS[2]);
  const [minutesInput, setMinutesInput] = useState("60");
  const [secondsInput, setSecondsInput] = useState("0");
  const [cardCount, setCardCount] = useState(1);
  const [basePoints, setBasePoints] = useState(String(HUNT_DEFAULT_BASE_POINTS));
  const [thresholdMinutes, setThresholdMinutes] = useState(String(HUNT_DEFAULT_SPEED_BONUS_THRESHOLD_MINUTES));
  const [bonusPoints, setBonusPoints] = useState(String(HUNT_DEFAULT_SPEED_BONUS_POINTS));

  const totalCountdownSeconds = Math.max(0, Number(minutesInput) || 0) * 60 + Math.max(0, Math.min(59, Number(secondsInput) || 0));

  const createMutation = useMutation({
    mutationFn: () =>
      apiJson("POST", "/api/hunt/owner/create", {
        entryPriceCents: priceCents,
        countdownSeconds: totalCountdownSeconds,
        cardCount,
        basePoints: Number(basePoints),
        speedBonusThresholdMinutes: Number(thresholdMinutes),
        speedBonusPoints: Number(bonusPoints),
      }),
    onSuccess: onCreated,
    onError: (err) => showAlert("Couldn't create hunt", err instanceof ApiError ? err.message : "Please try again."),
  });

  return (
    <View style={[styles.card, Shadow.card, { borderLeftWidth: 4, borderLeftColor: Colors.gold }]}>
      <Text style={styles.cardTitle}>Schedule a new hunt</Text>

      <SectionHeading icon="grid" color={Colors.secondary} title="How many cards to find?" />
      <View style={styles.cardCountRow}>
        {Array.from({ length: HUNT_MAX_CARDS }, (_, i) => i + 1).map((n) => (
          <Pressable key={n} onPress={() => setCardCount(n)} style={[styles.countChip, cardCount === n && styles.countChipActive]}>
            <Text style={[styles.countChipText, cardCount === n && styles.countChipTextActive]}>{n} card{n > 1 ? "s" : ""}</Text>
          </Pressable>
        ))}
      </View>

      <SectionHeading icon="dollar-sign" color={Colors.goldDark} title="Entry price" />
      <View style={styles.priceTierRow}>
        {HUNT_PRICE_TIERS_CENTS.map((cents) => (
          <Pressable key={cents} onPress={() => setPriceCents(cents)} style={[styles.priceChip, priceCents === cents && styles.priceChipActive]}>
            {priceCents === cents ? <Feather name="check" size={12} color="#3A2A00" style={{ marginRight: 4 }} /> : null}
            <Text style={[styles.priceChipText, priceCents === cents && styles.priceChipTextActive]}>{formatPriceCents(cents)}</Text>
          </Pressable>
        ))}
      </View>

      <SectionHeading icon="clock" color={Colors.pokemon} title="Entry window (countdown shown before you reveal)" />
      <View style={styles.pointRow}>
        <View style={{ flex: 1 }}>
          <View style={[styles.inputFull, styles.unitInputWrap]}>
            <TextInput style={styles.input} value={minutesInput} onChangeText={setMinutesInput} keyboardType="number-pad" />
            <Text style={styles.unitSuffix}>min</Text>
          </View>
        </View>
        <View style={{ flex: 1 }}>
          <View style={[styles.inputFull, styles.unitInputWrap]}>
            <TextInput style={styles.input} value={secondsInput} onChangeText={setSecondsInput} keyboardType="number-pad" maxLength={2} />
            <Text style={styles.unitSuffix}>sec</Text>
          </View>
        </View>
      </View>

      <SectionHeading icon="star" color={Colors.success} title="Points per find" />
      <TextInput style={[styles.input, styles.inputFull]} value={basePoints} onChangeText={setBasePoints} keyboardType="number-pad" />

      <SectionHeading icon="zap" color={Colors.primary} title="Speed bonus" />
      <View style={styles.pointRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Found within (min)</Text>
          <TextInput style={[styles.input, styles.inputFull]} value={thresholdMinutes} onChangeText={setThresholdMinutes} keyboardType="number-pad" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Bonus points</Text>
          <TextInput style={[styles.input, styles.inputFull]} value={bonusPoints} onChangeText={setBonusPoints} keyboardType="number-pad" />
        </View>
      </View>

      <View style={{ marginTop: Spacing.lg }}>
        <GradientButton
          title={createMutation.isPending ? "Creating…" : "Create hunt"}
          onPress={() => createMutation.mutate()}
          loading={createMutation.isPending}
          disabled={totalCountdownSeconds < 10}
          colors={[Colors.primary, Colors.goldDark]}
          icon="compass"
        />
      </View>
    </View>
  );
}

interface TargetLocation {
  coords: { latitude: number; longitude: number } | null;
  radiusMeters: number;
}

function TargetSetupCard({
  gameId,
  target,
  onDone,
  location,
  onLocationChange,
}: {
  gameId: string;
  target: HuntTarget;
  onDone: () => void;
  location: TargetLocation;
  onLocationChange: (next: TargetLocation) => void;
}) {
  const [images, setImages] = useState<string[]>(target.images);
  const [locating, setLocating] = useState(false);
  const coords = location.coords;
  const radiusInput = String(location.radiusMeters);

  const uploadMutation = useMutation({
    mutationFn: async (uris: string[]) => {
      const form = new FormData();
      for (let i = 0; i < uris.length; i++) await appendImageToFormData(form, uris[i], i);
      return apiRequest("POST", `/api/hunt/owner/${gameId}/targets/${target.index}/images`, form, true);
    },
    onSuccess: onDone,
    onError: (err) => showAlert("Couldn't upload photos", err instanceof ApiError ? err.message : "Please try again."),
  });

  const pickImage = async (fromCamera: boolean) => {
    if (images.length >= HUNT_MAX_IMAGES) return;
    const permission = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return showAlert("Permission needed", "Allow access to add a photo.");
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85 });
    if (result.canceled || !result.assets[0]) return;
    setImages((prev) => [...prev, result.assets[0].uri]);
  };

  const captureLocation = async () => {
    setLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        showAlert("Location needed", "Allow location access to set where this card is hidden.");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({});
      onLocationChange({ coords: { latitude: pos.coords.latitude, longitude: pos.coords.longitude }, radiusMeters: location.radiusMeters });
    } catch {
      showAlert("Couldn't get location", "Try again, or check your device's location settings.");
    } finally {
      setLocating(false);
    }
  };

  return (
    <View style={[styles.card, Shadow.card, { borderLeftWidth: 4, borderLeftColor: Colors.secondary }]}>
      <View style={styles.cardNumBadgeRow}>
        <View style={styles.cardNumBadge}>
          <Text style={styles.cardNumBadgeText}>{target.index + 1}</Text>
        </View>
        <Text style={styles.cardTitle}>Card {target.index + 1}</Text>
      </View>

      <SectionHeading icon="camera" color={Colors.pokemon} title={`Photos (up to ${HUNT_MAX_IMAGES})`} />
      <View style={styles.thumbGrid}>
        {images.map((uri, i) => (
          <View key={uri + i} style={styles.thumbSlot}>
            <Image source={{ uri: uri.startsWith("/") ? resolveImageUrl(uri) : uri }} style={styles.thumbImg} />
            <Pressable style={styles.thumbRemove} onPress={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}>
              <Feather name="x" size={12} color={Colors.white} />
            </Pressable>
          </View>
        ))}
        {images.length < HUNT_MAX_IMAGES ? (
          <View style={styles.addButtons}>
            <Pressable style={styles.addSlot} onPress={() => pickImage(true)}>
              <Feather name="camera" size={20} color={Colors.primary} />
            </Pressable>
            <Pressable style={styles.addSlot} onPress={() => pickImage(false)}>
              <Feather name="image" size={20} color={Colors.primary} />
            </Pressable>
          </View>
        ) : null}
      </View>
      <Button title={uploadMutation.isPending ? "Saving…" : "Save photos"} onPress={() => uploadMutation.mutate(images)} loading={uploadMutation.isPending} disabled={images.length === 0} variant="secondary" style={{ marginTop: Spacing.sm }} />

      <SectionHeading icon="map-pin" color={Colors.success} title="Location" />
      <Button title={locating ? "Getting your location…" : coords ? "Re-capture my location" : "Capture my current location"} onPress={captureLocation} loading={locating} variant={coords ? "outline" : "secondary"} icon={<Feather name="crosshair" size={16} color={coords ? Colors.primary : Colors.white} />} />
      {coords ? (
        <>
          <Text style={styles.label}>Radius entrants will see (meters)</Text>
          <View style={[styles.inputFull, styles.unitInputWrap]}>
            <TextInput
              style={styles.input}
              value={radiusInput}
              onChangeText={(v) => onLocationChange({ coords, radiusMeters: Number(v) || 0 })}
              keyboardType="number-pad"
            />
            <Text style={styles.unitSuffix}>m</Text>
          </View>
          <View style={styles.mapFrame}>
            <HuntMap latitude={coords.latitude} longitude={coords.longitude} radiusMeters={Number(radiusInput) || 500} height={160} />
          </View>
        </>
      ) : null}
    </View>
  );
}

function EntriesAndClaimsStep({ game }: { game: HuntGameResponse }) {
  const queryClient = useQueryClient();
  const { data: claims } = useQuery<OwnerClaim[]>({ queryKey: [`/api/hunt/owner/${game.id}/claims`], refetchInterval: 8_000 });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/hunt/owner/${game.id}/claims`] });
    queryClient.invalidateQueries({ queryKey: ["/api/hunt/current"] });
  };
  const approveMutation = useMutation({
    mutationFn: (claimId: string) => apiJson("POST", `/api/hunt/owner/${game.id}/claims/${claimId}/approve`, {}),
    onSuccess: invalidate,
    onError: (err) => showAlert("Couldn't approve", err instanceof ApiError ? err.message : "Please try again."),
  });
  const rejectMutation = useMutation({
    mutationFn: (claimId: string) => apiJson("POST", `/api/hunt/owner/${game.id}/claims/${claimId}/reject`, {}),
    onSuccess: invalidate,
    onError: (err) => showAlert("Couldn't reject", err instanceof ApiError ? err.message : "Please try again."),
  });

  const pending = (claims ?? []).filter((c) => c.status === "pending");
  const reviewed = (claims ?? []).filter((c) => c.status !== "pending");

  return (
    <View style={[styles.card, Shadow.card, { borderLeftWidth: 4, borderLeftColor: Colors.success }]}>
      <Text style={styles.cardTitle}>Claims</Text>
      {pending.length === 0 && reviewed.length === 0 ? <Text style={styles.mutedNote}>No claims yet.</Text> : null}
      {pending.length > 0 ? (
        <>
          <SectionHeading icon="search" color={Colors.warning} title="Awaiting review" />
          {pending.map((c) => (
            <View key={c.id} style={styles.claimRow}>
              <Image source={{ uri: resolveImageUrl(c.imageUrl) }} style={styles.claimThumb} />
              <View style={{ flex: 1 }}>
                <Text style={styles.claimName}>@{c.username}</Text>
                <Text style={styles.claimSub}>Card {c.targetIndex + 1}</Text>
              </View>
              <View style={styles.claimActions}>
                <Pressable style={[styles.claimBtn, styles.approveBtn]} onPress={() => approveMutation.mutate(c.id)} disabled={approveMutation.isPending}>
                  <Feather name="check" size={16} color={Colors.white} />
                </Pressable>
                <Pressable style={[styles.claimBtn, styles.rejectBtn]} onPress={() => rejectMutation.mutate(c.id)} disabled={rejectMutation.isPending}>
                  <Feather name="x" size={16} color={Colors.white} />
                </Pressable>
              </View>
            </View>
          ))}
        </>
      ) : null}
      {reviewed.map((c) => (
        <View key={c.id} style={styles.leaderRow}>
          <Text style={styles.leaderName}>
            @{c.username} · Card {c.targetIndex + 1}
          </Text>
          {c.status === "approved" ? (
            <View style={styles.wonPill}>
              <Feather name="check-circle" size={12} color={Colors.white} />
              <Text style={styles.wonPillText}>+{c.pointsAwarded}pts</Text>
            </View>
          ) : (
            <Text style={styles.rejectedNote}>rejected</Text>
          )}
        </View>
      ))}
    </View>
  );
}

function BroadcastForm() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const broadcastMutation = useMutation({
    mutationFn: () => apiJson<{ sentTo: number }>("POST", "/api/hunt/owner/broadcast", { title, body }),
    onSuccess: (result) => {
      showAlert("Sent!", `Notified ${result.sentTo} users.`);
      setTitle("");
      setBody("");
    },
    onError: (err) => showAlert("Couldn't send", err instanceof ApiError ? err.message : "Please try again."),
  });

  return (
    <View style={[styles.card, Shadow.card, { borderLeftWidth: 4, borderLeftColor: Colors.primary }]}>
      <View style={styles.broadcastHeader}>
        <View style={[styles.sectionBadgeLg, { backgroundColor: `${Colors.gold}30` }]}>
          <Feather name="radio" size={20} color={Colors.goldDark} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.broadcastTitle}>Broadcast to everyone</Text>
          <Text style={styles.broadcastSubtitle}>Every user with an account gets this as a push notification, instantly.</Text>
        </View>
      </View>

      <View style={styles.fieldGroup}>
        <View style={styles.fieldLabelRow}>
          <Text style={styles.fieldLabel}>Notification title</Text>
          <Text style={styles.fieldCounter}>{title.length}/80</Text>
        </View>
        <TextInput style={styles.composeTitleInput} placeholder="e.g. New hunt starting soon!" placeholderTextColor={Colors.textMuted} value={title} onChangeText={setTitle} maxLength={80} />
      </View>

      <View style={styles.fieldGroup}>
        <View style={styles.fieldLabelRow}>
          <Text style={styles.fieldLabel}>Message</Text>
          <Text style={styles.fieldCounter}>{body.length}/300</Text>
        </View>
        <TextInput
          style={styles.composeBodyInput}
          placeholder="Write the update you want every user to see…"
          placeholderTextColor={Colors.textMuted}
          value={body}
          onChangeText={setBody}
          multiline
          maxLength={300}
        />
      </View>

      <View style={{ marginTop: Spacing.md }}>
        <GradientButton
          title={broadcastMutation.isPending ? "Sending…" : "Send to all users"}
          onPress={() => broadcastMutation.mutate()}
          loading={broadcastMutation.isPending}
          disabled={!title.trim() || !body.trim()}
          colors={[Colors.secondary, Colors.pokemon]}
          icon="send"
        />
      </View>
    </View>
  );
}

export default function OwnerHuntScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<{ game: HuntGameResponse | null }>({ queryKey: ["/api/hunt/current"] });
  const game = data?.game ?? null;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/hunt/current"] });

  // Each card's captured GPS location lives here, in the parent, not in the
  // child TargetSetupCard — the reveal payload needs every card's location
  // at once, and the server never sees a location until the owner actually
  // hits Send (see routes/hunt.ts's reveal route), so there's nothing to
  // read back from `game.targets` until after reveal already happened.
  const [locations, setLocations] = useState<Record<number, TargetLocation>>({});
  const locationFor = (index: number): TargetLocation => locations[index] ?? { coords: null, radiusMeters: 500 };

  // `.every()` on an empty array is vacuously true — guard with a length
  // check so a not-yet-loaded or unexpectedly empty targets list can never
  // silently green-light "reveal" with nothing actually set up.
  const allTargetsHaveImages = (game?.targets.length ?? 0) > 0 && game!.targets.every((t) => t.images.length > 0);
  const allTargetsHaveLocation = (game?.targets.length ?? 0) > 0 && game!.targets.every((t) => !!locationFor(t.index).coords);

  const revealMutation = useMutation({
    mutationFn: () =>
      apiJson("POST", `/api/hunt/owner/${game!.id}/reveal`, {
        targets: game!.targets.map((t) => {
          const loc = locationFor(t.index);
          return { index: t.index, latitude: loc.coords!.latitude, longitude: loc.coords!.longitude, radiusMeters: loc.radiusMeters };
        }),
      }),
    onSuccess: invalidate,
    onError: (err) => showAlert("Couldn't reveal", err instanceof ApiError ? err.message : "Please try again."),
  });

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: Spacing.lg, paddingBottom: insets.bottom + Spacing.xl }}>
      <LinearGradient colors={["#1A0F35", "#3B1F6B"]} style={styles.hero}>
        <Feather name="compass" size={26} color={Colors.gold} />
        <Text style={styles.heroTitle}>Card Hunt Control</Text>
      </LinearGradient>

      <Pressable style={styles.notifyLink} onPress={() => navigation.navigate("OwnerHuntNotify")}>
        <Feather name="send" size={16} color={Colors.primary} />
        <Text style={styles.notifyLinkText}>Notify specific users</Text>
        <Feather name="chevron-right" size={16} color={Colors.textMuted} />
      </Pressable>

      {isLoading ? (
        <ActivityIndicator color={Colors.gold} style={{ marginTop: Spacing.xl }} />
      ) : !game ? (
        <CreateHuntForm onCreated={invalidate} />
      ) : (
        <>
          <View style={[styles.statusPill, game.status === "revealed" && styles.statusPillLive]}>
            {game.status === "revealed" ? <View style={styles.liveDot} /> : null}
            <Text style={[styles.statusPillText, game.status === "revealed" && styles.statusPillTextLive]}>
              {game.status === "entry_open" ? "Collecting entries" : game.status === "revealed" ? "Live — searching" : "Ended"} · {formatPriceCents(game.entryPriceCents)} entry · {game.cardCount} card{game.cardCount > 1 ? "s" : ""}
            </Text>
          </View>

          {game.status === "entry_open" ? (
            <>
              {game.targets.map((target) => (
                <TargetSetupCard
                  key={target.index}
                  gameId={game.id}
                  target={target}
                  onDone={invalidate}
                  location={locationFor(target.index)}
                  onLocationChange={(next) => setLocations((prev) => ({ ...prev, [target.index]: next }))}
                />
              ))}
              <View style={[styles.card, Shadow.card, { borderLeftWidth: 4, borderLeftColor: Colors.primary }]}>
                {!allTargetsHaveImages ? <Text style={styles.warnText}>Every card needs at least one saved photo first.</Text> : null}
                {!allTargetsHaveLocation ? <Text style={styles.warnText}>Every card needs a captured location first.</Text> : null}
                <GradientButton
                  title={revealMutation.isPending ? "Sending…" : "Send — reveal to entrants now"}
                  onPress={() => revealMutation.mutate()}
                  loading={revealMutation.isPending}
                  disabled={!allTargetsHaveImages || !allTargetsHaveLocation}
                  colors={[Colors.primary, Colors.goldDark]}
                  icon="send"
                />
              </View>
            </>
          ) : null}

          {game.status !== "entry_open" ? <EntriesAndClaimsStep game={game} /> : null}
          {game.status === "ended" ? <Text style={styles.doneNote}>Schedule the next hunt anytime — it'll replace this one on the game screen.</Text> : null}
          {game.status === "ended" ? <CreateHuntForm onCreated={invalidate} /> : null}
        </>
      )}

      <BroadcastForm />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  hero: { alignItems: "center", gap: 6, borderRadius: BorderRadius.lg, paddingVertical: Spacing.lg, marginBottom: Spacing.md },
  heroTitle: { fontSize: 20, fontWeight: "800", color: Colors.gold, letterSpacing: 1 },
  notifyLink: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, backgroundColor: Colors.surface, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, marginBottom: Spacing.lg },
  notifyLinkText: { ...Typography.body, color: Colors.text, fontWeight: "600", flex: 1 },
  card: { backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, marginBottom: Spacing.md },
  cardTitle: { ...Typography.bodyBold, color: Colors.text, marginBottom: Spacing.sm },
  label: { ...Typography.small, color: Colors.textSecondary, marginTop: Spacing.sm, marginBottom: 4 },
  input: { flex: 1, paddingVertical: 10, paddingHorizontal: 6, color: Colors.text, fontSize: 16 },
  inputFull: { backgroundColor: Colors.surfaceAlt, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: Spacing.sm },
  inputMultiline: { minHeight: 70, textAlignVertical: "top", marginTop: Spacing.sm },
  pointRow: { flexDirection: "row", gap: Spacing.sm },
  cardCountRow: { flexDirection: "row", gap: Spacing.sm },
  countChip: { flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: BorderRadius.md, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.surfaceAlt },
  countChipActive: { borderColor: Colors.secondary, backgroundColor: Colors.secondary, ...Shadow.card },
  countChipText: { ...Typography.small, color: Colors.text, fontWeight: "700" },
  countChipTextActive: { color: Colors.white },
  priceTierRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  priceChip: { flexDirection: "row", alignItems: "center", paddingVertical: 9, paddingHorizontal: Spacing.md, borderRadius: BorderRadius.pill, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.surfaceAlt },
  priceChipActive: { borderColor: Colors.gold, backgroundColor: Colors.gold, ...Shadow.card },
  priceChipText: { ...Typography.small, color: Colors.text, fontWeight: "700" },
  priceChipTextActive: { color: "#3A2A00" },
  unitInputWrap: { flexDirection: "row", alignItems: "center" },
  unitSuffix: { ...Typography.small, color: Colors.textMuted, fontWeight: "700", paddingRight: Spacing.sm },
  sectionHeading: { flexDirection: "row", alignItems: "center", gap: Spacing.xs, marginTop: Spacing.md, marginBottom: Spacing.xs },
  sectionBadge: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  sectionHeadingText: { ...Typography.small, color: Colors.textSecondary, fontWeight: "700", flexShrink: 1 },
  gradientBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: BorderRadius.pill, paddingVertical: 14, ...Shadow.card },
  gradientBtnText: { color: Colors.white, fontFamily: Fonts.bodyBold, fontSize: 16, fontWeight: "700" },
  mapFrame: { marginTop: Spacing.sm, borderRadius: BorderRadius.md, overflow: "hidden", borderWidth: 2, borderColor: Colors.gold },
  cardNumBadgeRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, marginBottom: Spacing.sm },
  cardNumBadge: { width: 26, height: 26, borderRadius: 13, backgroundColor: Colors.secondary, alignItems: "center", justifyContent: "center" },
  cardNumBadgeText: { color: Colors.white, fontSize: 13, fontWeight: "800" },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", backgroundColor: Colors.surfaceAlt, borderRadius: BorderRadius.pill, paddingVertical: 6, paddingHorizontal: Spacing.md, marginBottom: Spacing.md, borderWidth: 1, borderColor: Colors.gold },
  statusPillLive: { backgroundColor: `${Colors.success}18`, borderColor: Colors.success },
  statusPillText: { ...Typography.small, color: Colors.text, fontWeight: "700" },
  statusPillTextLive: { color: Colors.success },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.success },
  subheading: { ...Typography.small, color: Colors.textSecondary, fontWeight: "700", marginBottom: Spacing.xs },
  thumbGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  thumbSlot: { width: 72, height: 72, borderRadius: BorderRadius.sm, overflow: "hidden", position: "relative" },
  thumbImg: { width: "100%", height: "100%" },
  thumbRemove: { position: "absolute", top: 2, right: 2, backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 8, padding: 2 },
  addButtons: { flexDirection: "row", gap: Spacing.sm },
  addSlot: { width: 72, height: 72, borderRadius: BorderRadius.sm, borderWidth: 1.5, borderColor: Colors.primary, borderStyle: "dashed", alignItems: "center", justifyContent: "center" },
  warnText: { ...Typography.small, color: Colors.danger, marginBottom: Spacing.sm },
  mutedNote: { ...Typography.small, color: Colors.textMuted },
  claimRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, paddingVertical: Spacing.xs },
  claimThumb: { width: 40, height: 40, borderRadius: BorderRadius.sm },
  claimName: { ...Typography.body, color: Colors.text },
  claimSub: { ...Typography.small, color: Colors.textMuted },
  claimActions: { flexDirection: "row", gap: Spacing.xs },
  claimBtn: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  approveBtn: { backgroundColor: Colors.success },
  rejectBtn: { backgroundColor: Colors.danger },
  leaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: Spacing.sm, paddingVertical: 8 },
  leaderName: { ...Typography.body, color: Colors.text, flex: 1 },
  wonPill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: Colors.success, borderRadius: BorderRadius.pill, paddingVertical: 3, paddingHorizontal: 8 },
  wonPillText: { color: Colors.white, fontSize: 10, fontWeight: "700" },
  rejectedNote: { ...Typography.small, color: Colors.danger },
  doneNote: { ...Typography.small, color: Colors.textMuted, marginBottom: Spacing.md },
  broadcastHeader: { flexDirection: "row", alignItems: "flex-start", gap: Spacing.sm, marginBottom: Spacing.md },
  sectionBadgeLg: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  broadcastTitle: { fontSize: 19, fontFamily: Fonts.displayBold, color: Colors.text },
  broadcastSubtitle: { ...Typography.small, color: Colors.textSecondary, marginTop: 2, lineHeight: 18 },
  fieldGroup: { marginTop: Spacing.md },
  fieldLabelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  fieldLabel: { fontSize: 14, fontFamily: Fonts.bodyBold, color: Colors.text },
  fieldCounter: { ...Typography.small, color: Colors.textMuted, fontSize: 11 },
  composeTitleInput: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: BorderRadius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: 14,
    color: Colors.text,
    fontSize: 18,
    fontFamily: Fonts.bodyBold,
  },
  composeBodyInput: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: BorderRadius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    color: Colors.text,
    fontSize: 16,
    fontFamily: Fonts.body,
    minHeight: 90,
    textAlignVertical: "top",
    lineHeight: 22,
  },
});
