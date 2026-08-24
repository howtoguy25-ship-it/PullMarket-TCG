import React, { useState } from "react";
import { View, StyleSheet, Text, ScrollView, TextInput, Pressable, Image, Platform, Alert, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Colors, Spacing, Typography, BorderRadius, Shadow } from "@/constants/theme";
import { Button } from "@/components/ui";
import { HuntMap } from "@/components/HuntMap";
import { resolveImageUrl } from "@/lib/media";
import { apiRequest, apiJson, ApiError } from "@/lib/api";
import { formatPriceCents } from "@/lib/format";
import { appendImageToFormData } from "@/lib/formDataImage";
import { HUNT_ENTRY_PRICE_MIN_CENTS, HUNT_ENTRY_PRICE_MAX_CENTS, HUNT_MAX_IMAGES } from "@shared/validation";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

interface HuntGameResponse {
  id: string;
  status: "entry_open" | "revealed" | "ended";
  entryPriceCents: number;
  countdownEndsAt: string;
  images: string[];
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number | null;
  winnerUsername: string | null;
}
interface OwnerEntry {
  id: string;
  userId: string;
  username: string;
  paidAt: string;
  claimStatus: string;
  claimImageUrl: string | null;
  claimedAt: string | null;
}

function CreateHuntForm({ onCreated }: { onCreated: () => void }) {
  const [priceInput, setPriceInput] = useState("15");
  const [minutesInput, setMinutesInput] = useState("60");

  const createMutation = useMutation({
    mutationFn: () =>
      apiJson("POST", "/api/hunt/owner/create", {
        entryPriceCents: Math.round(Number(priceInput) * 100),
        countdownMinutes: Number(minutesInput),
      }),
    onSuccess: onCreated,
    onError: (err) => showAlert("Couldn't create hunt", err instanceof ApiError ? err.message : "Please try again."),
  });

  return (
    <View style={[styles.card, Shadow.card]}>
      <Text style={styles.cardTitle}>Schedule a new hunt</Text>
      <Text style={styles.label}>Entry price ($5 – $30, reused as the default next time)</Text>
      <View style={styles.inputRow}>
        <Text style={styles.dollar}>$</Text>
        <TextInput style={styles.input} value={priceInput} onChangeText={setPriceInput} keyboardType="decimal-pad" />
      </View>
      <Text style={styles.label}>Entry window (minutes shown as a countdown before you reveal)</Text>
      <TextInput style={[styles.input, styles.inputFull]} value={minutesInput} onChangeText={setMinutesInput} keyboardType="number-pad" />
      <Button title={createMutation.isPending ? "Creating…" : "Create hunt"} onPress={() => createMutation.mutate()} loading={createMutation.isPending} style={{ marginTop: Spacing.md }} />
    </View>
  );
}

function ImageStep({ game, onDone }: { game: HuntGameResponse; onDone: () => void }) {
  const [images, setImages] = useState<string[]>(game.images);
  const uploadMutation = useMutation({
    mutationFn: async (uris: string[]) => {
      const form = new FormData();
      for (let i = 0; i < uris.length; i++) await appendImageToFormData(form, uris[i], i);
      return apiRequest("POST", `/api/hunt/owner/${game.id}/images`, form, true);
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

  return (
    <View style={[styles.card, Shadow.card]}>
      <Text style={styles.cardTitle}>1. Snap where it's hidden (up to {HUNT_MAX_IMAGES})</Text>
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
      <Button
        title={uploadMutation.isPending ? "Saving…" : "Save photos"}
        onPress={() => uploadMutation.mutate(images)}
        loading={uploadMutation.isPending}
        disabled={images.length === 0}
        style={{ marginTop: Spacing.md }}
      />
    </View>
  );
}

function RevealStep({ game, hasImages, onRevealed }: { game: HuntGameResponse; hasImages: boolean; onRevealed: () => void }) {
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [radiusInput, setRadiusInput] = useState("500");
  const [locating, setLocating] = useState(false);

  const captureLocation = async () => {
    setLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        showAlert("Location needed", "Allow location access to set where the hunt is hidden.");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({});
      setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
    } catch {
      showAlert("Couldn't get location", "Try again, or check your device's location settings.");
    } finally {
      setLocating(false);
    }
  };

  const revealMutation = useMutation({
    mutationFn: () => apiJson("POST", `/api/hunt/owner/${game.id}/reveal`, { latitude: coords!.latitude, longitude: coords!.longitude, radiusMeters: Number(radiusInput) }),
    onSuccess: onRevealed,
    onError: (err) => showAlert("Couldn't reveal", err instanceof ApiError ? err.message : "Please try again."),
  });

  return (
    <View style={[styles.card, Shadow.card]}>
      <Text style={styles.cardTitle}>2. Set the search area & send</Text>
      {!hasImages ? <Text style={styles.warnText}>Add at least one photo above first.</Text> : null}
      <Button title={locating ? "Getting your location…" : coords ? "Re-capture my location" : "Capture my current location"} onPress={captureLocation} loading={locating} variant="secondary" />
      {coords ? (
        <>
          <Text style={styles.label}>Radius entrants will see (meters)</Text>
          <TextInput style={[styles.input, styles.inputFull]} value={radiusInput} onChangeText={setRadiusInput} keyboardType="number-pad" />
          <View style={{ marginTop: Spacing.sm }}>
            <HuntMap latitude={coords.latitude} longitude={coords.longitude} radiusMeters={Number(radiusInput) || 500} height={180} />
          </View>
        </>
      ) : null}
      <Button
        title={revealMutation.isPending ? "Sending…" : "🚀 Send — reveal to entrants now"}
        onPress={() => revealMutation.mutate()}
        loading={revealMutation.isPending}
        disabled={!coords || !hasImages || !radiusInput}
        style={{ marginTop: Spacing.md }}
      />
    </View>
  );
}

function EntriesStep({ game }: { game: HuntGameResponse }) {
  const queryClient = useQueryClient();
  const { data: entries } = useQuery<OwnerEntry[]>({ queryKey: [`/api/hunt/owner/${game.id}/entries`], refetchInterval: 8_000 });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/hunt/owner/${game.id}/entries`] });
    queryClient.invalidateQueries({ queryKey: ["/api/hunt/current"] });
  };
  const approveMutation = useMutation({
    mutationFn: (entryId: string) => apiJson("POST", `/api/hunt/owner/${game.id}/entries/${entryId}/approve`, {}),
    onSuccess: invalidate,
    onError: (err) => showAlert("Couldn't approve", err instanceof ApiError ? err.message : "Please try again."),
  });
  const rejectMutation = useMutation({
    mutationFn: (entryId: string) => apiJson("POST", `/api/hunt/owner/${game.id}/entries/${entryId}/reject`, {}),
    onSuccess: invalidate,
    onError: (err) => showAlert("Couldn't reject", err instanceof ApiError ? err.message : "Please try again."),
  });

  const pending = (entries ?? []).filter((e) => e.claimStatus === "pending");
  const others = (entries ?? []).filter((e) => e.claimStatus !== "pending");

  return (
    <View style={[styles.card, Shadow.card]}>
      <Text style={styles.cardTitle}>Entrants ({entries?.length ?? 0}) {game.status === "revealed" ? "— live" : ""}</Text>
      {pending.length > 0 ? (
        <>
          <Text style={styles.subheading}>🔍 Claims awaiting review</Text>
          {pending.map((e) => (
            <View key={e.id} style={styles.claimRow}>
              {e.claimImageUrl ? <Image source={{ uri: resolveImageUrl(e.claimImageUrl) }} style={styles.claimThumb} /> : null}
              <Text style={styles.claimName}>@{e.username}</Text>
              <View style={styles.claimActions}>
                <Pressable style={[styles.claimBtn, styles.approveBtn]} onPress={() => approveMutation.mutate(e.id)} disabled={approveMutation.isPending}>
                  <Feather name="check" size={16} color={Colors.white} />
                </Pressable>
                <Pressable style={[styles.claimBtn, styles.rejectBtn]} onPress={() => rejectMutation.mutate(e.id)} disabled={rejectMutation.isPending}>
                  <Feather name="x" size={16} color={Colors.white} />
                </Pressable>
              </View>
            </View>
          ))}
        </>
      ) : null}
      {others.map((e) => (
        <View key={e.id} style={styles.leaderRow}>
          <Text style={styles.leaderName}>@{e.username}</Text>
          {e.claimStatus === "approved" ? <Feather name="check-circle" size={16} color={Colors.success} /> : null}
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
    <View style={[styles.card, Shadow.card]}>
      <View style={styles.broadcastHeader}>
        <Feather name="radio" size={18} color={Colors.gold} />
        <Text style={styles.cardTitle}>Broadcast to everyone</Text>
      </View>
      <TextInput style={[styles.input, styles.inputFull]} placeholder="Title" placeholderTextColor={Colors.textMuted} value={title} onChangeText={setTitle} maxLength={80} />
      <TextInput
        style={[styles.input, styles.inputFull, styles.inputMultiline]}
        placeholder="What's the update?"
        placeholderTextColor={Colors.textMuted}
        value={body}
        onChangeText={setBody}
        multiline
        maxLength={300}
      />
      <Button
        title={broadcastMutation.isPending ? "Sending…" : "Send to all users"}
        onPress={() => broadcastMutation.mutate()}
        loading={broadcastMutation.isPending}
        disabled={!title.trim() || !body.trim()}
        style={{ marginTop: Spacing.md }}
      />
    </View>
  );
}

export default function OwnerHuntScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<{ game: HuntGameResponse | null }>({ queryKey: ["/api/hunt/current"] });
  const game = data?.game ?? null;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/hunt/current"] });

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: Spacing.lg, paddingBottom: insets.bottom + Spacing.xl }}>
      <LinearGradient colors={["#1A0F35", "#3B1F6B"]} style={styles.hero}>
        <Feather name="compass" size={26} color={Colors.gold} />
        <Text style={styles.heroTitle}>Card Hunt Control</Text>
      </LinearGradient>

      {isLoading ? (
        <ActivityIndicator color={Colors.gold} style={{ marginTop: Spacing.xl }} />
      ) : !game ? (
        <CreateHuntForm onCreated={invalidate} />
      ) : (
        <>
          <View style={styles.statusPill}>
            <Text style={styles.statusPillText}>
              {game.status === "entry_open" ? "Collecting entries" : game.status === "revealed" ? "Live — searching" : "Ended"} · {formatPriceCents(game.entryPriceCents)} entry
            </Text>
          </View>
          {game.status === "entry_open" ? (
            <>
              <ImageStep game={game} onDone={invalidate} />
              <RevealStep game={game} hasImages={game.images.length > 0} onRevealed={invalidate} />
            </>
          ) : null}
          {game.status !== "entry_open" ? <EntriesStep game={game} /> : null}
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
  hero: { alignItems: "center", gap: 6, borderRadius: BorderRadius.lg, paddingVertical: Spacing.lg, marginBottom: Spacing.lg },
  heroTitle: { fontSize: 20, fontWeight: "800", color: Colors.gold, letterSpacing: 1 },
  card: { backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, marginBottom: Spacing.md },
  cardTitle: { ...Typography.bodyBold, color: Colors.text, marginBottom: Spacing.sm },
  label: { ...Typography.small, color: Colors.textSecondary, marginTop: Spacing.sm, marginBottom: 4 },
  inputRow: { flexDirection: "row", alignItems: "center", backgroundColor: Colors.surfaceAlt, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: Spacing.sm },
  dollar: { ...Typography.bodyBold, color: Colors.textMuted },
  input: { flex: 1, paddingVertical: 10, paddingHorizontal: 6, color: Colors.text, fontSize: 16 },
  inputFull: { backgroundColor: Colors.surfaceAlt, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: Spacing.sm },
  inputMultiline: { minHeight: 70, textAlignVertical: "top", marginTop: Spacing.sm },
  statusPill: { alignSelf: "flex-start", backgroundColor: Colors.surfaceAlt, borderRadius: BorderRadius.pill, paddingVertical: 6, paddingHorizontal: Spacing.md, marginBottom: Spacing.md, borderWidth: 1, borderColor: Colors.gold },
  statusPillText: { ...Typography.small, color: Colors.text, fontWeight: "700" },
  thumbGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  thumbSlot: { width: 72, height: 72, borderRadius: BorderRadius.sm, overflow: "hidden", position: "relative" },
  thumbImg: { width: "100%", height: "100%" },
  thumbRemove: { position: "absolute", top: 2, right: 2, backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 8, padding: 2 },
  addButtons: { flexDirection: "row", gap: Spacing.sm },
  addSlot: { width: 72, height: 72, borderRadius: BorderRadius.sm, borderWidth: 1.5, borderColor: Colors.primary, borderStyle: "dashed", alignItems: "center", justifyContent: "center" },
  warnText: { ...Typography.small, color: Colors.danger, marginBottom: Spacing.sm },
  subheading: { ...Typography.small, color: Colors.textSecondary, fontWeight: "700", marginTop: Spacing.sm, marginBottom: Spacing.xs },
  claimRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, paddingVertical: Spacing.xs },
  claimThumb: { width: 40, height: 40, borderRadius: BorderRadius.sm },
  claimName: { ...Typography.body, color: Colors.text, flex: 1 },
  claimActions: { flexDirection: "row", gap: Spacing.xs },
  claimBtn: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  approveBtn: { backgroundColor: Colors.success },
  rejectBtn: { backgroundColor: Colors.danger },
  leaderRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, paddingVertical: 8 },
  leaderName: { ...Typography.body, color: Colors.text, flex: 1 },
  doneNote: { ...Typography.small, color: Colors.textMuted, marginBottom: Spacing.md },
  broadcastHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
});
