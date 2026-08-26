import React, { useState } from "react";
import { View, StyleSheet, Text, TextInput, Pressable, Image, Platform, Alert, Modal, FlatList } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { Asset as ExpoAsset } from "expo-asset";
import { Video, ResizeMode } from "expo-av";
import { Feather } from "@expo/vector-icons";
import { Colors, Spacing, Typography, BorderRadius, Fonts } from "@/constants/theme";
import { Button } from "@/components/ui";
import RotatedMedia from "@/components/RotatedMedia";
import { RootStackParamList } from "@/navigation/types";
import { resolveImageUrl, effectiveStoryAspectRatio } from "@/lib/media";
import { AMBIENT_SOUNDS } from "@/lib/ambientSounds";
import { useAmbientSound } from "@/contexts/AmbientSoundContext";
import { apiRequest, ApiError } from "@/lib/api";
import { appendMediaToFormData } from "@/lib/formDataImage";
import { STORY_PRIVACY_LEVELS } from "@shared/schema";
import { STORY_MAX_CAPTION_LENGTH, STORY_PRIVACY_LABELS } from "@shared/validation";

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Privacy = (typeof STORY_PRIVACY_LEVELS)[number];

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

interface Asset {
  uri: string;
  type?: string;
  mimeType?: string;
  fileName?: string | null;
  width?: number;
  height?: number;
}
interface Candidate {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  isFriend: boolean;
}

function AudienceModal({ visible, selected, onClose, onChange }: { visible: boolean; selected: Set<string>; onClose: () => void; onChange: (next: Set<string>) => void }) {
  const [query, setQuery] = useState("");
  const { data: candidates, isLoading } = useQuery<Candidate[]>({ queryKey: [`/api/stories/privacy-candidates?q=${encodeURIComponent(query)}`], enabled: visible });

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Choose who can see this</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Feather name="x" size={22} color={Colors.text} />
          </Pressable>
        </View>
        <View style={styles.searchRow}>
          <Feather name="search" size={16} color={Colors.textMuted} />
          <TextInput style={styles.searchInput} placeholder="Search friends…" placeholderTextColor={Colors.textMuted} value={query} onChangeText={setQuery} />
        </View>
        <Text style={styles.modalHint}>Friends and people you've recently chatted with</Text>
        <FlatList
          data={candidates ?? []}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xl }}
          renderItem={({ item }) => {
            const isSelected = selected.has(item.id);
            return (
              <Pressable style={[styles.candidateRow, isSelected && styles.candidateRowSelected]} onPress={() => toggle(item.id)}>
                <Feather name={isSelected ? "check-square" : "square"} size={18} color={isSelected ? Colors.primary : Colors.textMuted} />
                {item.avatarUrl ? <Image source={{ uri: resolveImageUrl(item.avatarUrl) }} style={styles.candidateAvatar} /> : <View style={[styles.candidateAvatar, styles.candidateAvatarPlaceholder]} />}
                <Text style={styles.candidateName}>@{item.username}</Text>
                {item.isFriend ? <Text style={styles.friendTag}>Friend</Text> : null}
              </Pressable>
            );
          }}
          ListEmptyComponent={!isLoading ? <Text style={styles.emptyText}>No matches — add friends or start a chat first.</Text> : null}
        />
        <View style={styles.modalFooter}>
          <Button title={`Done — ${selected.size} selected`} onPress={onClose} disabled={selected.size === 0} />
        </View>
      </View>
    </Modal>
  );
}

export default function CreateStoryScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const queryClient = useQueryClient();

  const { preview: previewSound, previewingId } = useAmbientSound();
  const [asset, setAsset] = useState<Asset | null>(null);
  const [rotation, setRotation] = useState(0); // real 0/90/180/270 — see RotatedMedia
  const [soundId, setSoundId] = useState<string | null>(null);
  const [soundModalOpen, setSoundModalOpen] = useState(false);
  const [soundApplying, setSoundApplying] = useState(false);
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [caption, setCaption] = useState("");
  const [privacy, setPrivacy] = useState<Privacy>("everyone");
  const [customSelected, setCustomSelected] = useState<Set<string>>(new Set());
  const [audienceModalOpen, setAudienceModalOpen] = useState(false);

  const isVideo = asset?.type === "video" || !!asset?.mimeType?.startsWith("video/");
  const aspectRatio = isVideo ? effectiveStoryAspectRatio(asset?.width, asset?.height, rotation) : 16 / 9;

  const pickFromLibrary = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return showAlert("Permission needed", "Allow photo library access to post a status update.");
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.All, quality: 0.85 });
    if (!result.canceled && result.assets[0]) {
      const a = result.assets[0];
      setRotation(0);
      setSoundId(null);
      setAsset({ uri: a.uri, type: a.type ?? undefined, mimeType: a.mimeType, fileName: a.fileName, width: a.width || undefined, height: a.height || undefined });
    }
  };

  const captureNew = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return showAlert("Permission needed", "Allow camera access to post a status update.");
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.All, quality: 0.85 });
    if (!result.canceled && result.assets[0]) {
      const a = result.assets[0];
      setRotation(0);
      setSoundId(null);
      setAsset({ uri: a.uri, type: a.type ?? undefined, mimeType: a.mimeType, fileName: a.fileName, width: a.width || undefined, height: a.height || undefined });
    }
  };

  // Real rotate: a photo gets physically re-encoded 90° via
  // expo-image-manipulator (the file itself changes, so no rotation value
  // needs to travel with it). A video can't be re-encoded cheaply client
  // side, so its rotation is tracked and sent to the server, then replayed
  // as the same real transform by every viewer (see RotatedMedia).
  const rotateAsset = async () => {
    if (!asset) return;
    if (isVideo) {
      setRotation((r) => (r + 90) % 360);
      return;
    }
    try {
      const result = await ImageManipulator.manipulateAsync(asset.uri, [{ rotate: 90 }], { compress: 1, format: ImageManipulator.SaveFormat.JPEG });
      setAsset((prev) => (prev ? { ...prev, uri: result.uri, width: result.width, height: result.height } : prev));
    } catch {
      showAlert("Couldn't rotate", "Please try again.");
    }
  };

  // Real native trim editor (react-native-video-trim) — a native module, so
  // it's required lazily and only off the web bundle, which has no native
  // modules to link against. Its own edit-tools toolbar (enableEditTools)
  // covers real crop/flip/rotate/speed/mute for video too, on top of trim,
  // so video doesn't need a second, separate crop UI the way images do
  // below.
  const openTrimEditor = () => {
    if (!asset || Platform.OS === "web") return;
    try {
      const VideoTrim = require("react-native-video-trim");
      const cleanup = () => {
        onFinish.remove();
        onCancel.remove();
        onErr.remove();
      };
      const onFinish = VideoTrim.default.onFinishTrimming(({ outputPath }: { outputPath: string }) => {
        setAsset((prev) => (prev ? { ...prev, uri: outputPath } : prev));
        cleanup();
      });
      const onCancel = VideoTrim.default.onCancel(() => cleanup());
      const onErr = VideoTrim.default.onError(({ message }: { message: string }) => {
        showAlert("Trim failed", message || "Please try again.");
        cleanup();
      });
      VideoTrim.showEditor(asset.uri, { enableEditTools: true, headerText: "Trim your video" });
    } catch (err) {
      showAlert("Trim unavailable", err instanceof Error ? err.message : "Please try again.");
    }
  };

  // Real sound: bakes one of the app's own in-house background tracks into
  // the video via react-native-video-trim's headless mixAudio — a genuine
  // re-encode of the file (not a client-side-only overlay that would be
  // lost the moment someone else's device plays the uploaded clip).
  const applySound = async (id: string) => {
    if (!asset) return;
    const option = AMBIENT_SOUNDS.find((s) => s.id === id);
    if (!option) return;
    setSoundApplying(true);
    try {
      const audioAsset = await ExpoAsset.fromModule(option.source).downloadAsync();
      const audioPath = audioAsset.localUri;
      if (!audioPath) throw new Error("Couldn't load that sound.");
      const VideoTrim = require("react-native-video-trim");
      const result = await VideoTrim.mixAudio(asset.uri, audioPath, {
        originalAudioVolume: 0,
        backgroundAudioVolume: 1.0,
        loopAudio: true,
        outputExt: "mp4",
      });
      setAsset((prev) => (prev ? { ...prev, uri: result.outputPath } : prev));
      setSoundId(id);
      setSoundModalOpen(false);
    } catch (err) {
      showAlert("Couldn't add sound", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setSoundApplying(false);
    }
  };

  // Real crop for photos: an actual pixel crop via expo-image-manipulator
  // (not a visual-only overlay), centered on the real picked dimensions.
  const cropImage = async (target: "square" | "portrait" | "landscape") => {
    if (!asset || !asset.width || !asset.height) return;
    const { width: w, height: h } = asset;
    let cropW = w;
    let cropH = h;
    if (target === "square") {
      cropW = cropH = Math.min(w, h);
    } else if (target === "portrait") {
      cropH = h;
      cropW = Math.min(w, Math.round((h * 9) / 16));
      if (cropW === w) cropH = Math.round((w * 16) / 9);
    } else {
      cropW = w;
      cropH = Math.min(h, Math.round((w * 9) / 16));
      if (cropH === h) cropW = Math.round((h * 16) / 9);
    }
    const originX = Math.round((w - cropW) / 2);
    const originY = Math.round((h - cropH) / 2);
    try {
      const result = await ImageManipulator.manipulateAsync(asset.uri, [{ crop: { originX, originY, width: cropW, height: cropH } }], {
        compress: 1,
        format: ImageManipulator.SaveFormat.JPEG,
      });
      setAsset((prev) => (prev ? { ...prev, uri: result.uri, width: result.width, height: result.height } : prev));
      setCropModalOpen(false);
    } catch (err) {
      showAlert("Couldn't crop", err instanceof Error ? err.message : "Please try again.");
    }
  };

  const shareMutation = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      await appendMediaToFormData(form, "media", asset!, 0);
      if (caption.trim()) form.append("caption", caption.trim());
      form.append("privacy", privacy);
      if (privacy === "custom") form.append("customViewerIds", JSON.stringify(Array.from(customSelected)));
      if (asset!.width) form.append("mediaWidth", String(asset!.width));
      if (asset!.height) form.append("mediaHeight", String(asset!.height));
      form.append("rotation", String(isVideo ? rotation : 0));
      return apiRequest("POST", "/api/stories", form, true);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stories/feed"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stories/mine"] });
      navigation.goBack();
    },
    onError: (err) => showAlert("Couldn't post", err instanceof ApiError ? err.message : "Please try again."),
  });

  if (!asset) {
    return (
      <View style={[styles.pickerContainer, { paddingTop: insets.top + Spacing.xl, paddingBottom: insets.bottom + Spacing.xl }]}>
        <Pressable style={styles.closeTop} onPress={() => navigation.goBack()} hitSlop={10}>
          <Feather name="x" size={24} color={Colors.text} />
        </Pressable>
        <Text style={styles.pickerTitle}>Add to your status</Text>
        <Text style={styles.pickerSubtitle}>A real photo or video, visible to who you choose for 24 hours.</Text>
        <Pressable style={styles.pickerBtn} onPress={captureNew}>
          <Feather name="camera" size={22} color={Colors.white} />
          <Text style={styles.pickerBtnText}>Take photo or video</Text>
        </Pressable>
        <Pressable style={[styles.pickerBtn, styles.pickerBtnAlt]} onPress={pickFromLibrary}>
          <Feather name="image" size={22} color={Colors.primary} />
          <Text style={[styles.pickerBtnText, { color: Colors.primary }]}>Choose from library</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.previewContainer}>
      <Pressable
        style={[styles.closeTop, styles.closeCircle, { top: insets.top + Spacing.sm }]}
        onPress={() => {
          setAsset(null);
          setRotation(0);
          setSoundId(null);
        }}
        hitSlop={10}
      >
        <Feather name="x" size={22} color={Colors.white} />
      </Pressable>

      <View style={styles.mediaFrameWrap}>
        <View style={[styles.mediaFrame, { aspectRatio }]}>
          <RotatedMedia rotation={isVideo ? rotation : 0}>
            {isVideo ? (
              <Video source={{ uri: asset.uri }} style={styles.media} resizeMode={ResizeMode.COVER} isLooping shouldPlay isMuted />
            ) : (
              <Image source={{ uri: asset.uri }} style={styles.media} resizeMode="cover" />
            )}
          </RotatedMedia>

          <View style={styles.mediaToolbar}>
            <Pressable style={styles.toolBtn} onPress={rotateAsset} hitSlop={8}>
              <Feather name="rotate-cw" size={18} color={Colors.white} />
              <Text style={styles.toolBtnLabel}>Rotate</Text>
            </Pressable>
            {!isVideo ? (
              <Pressable style={styles.toolBtn} onPress={() => setCropModalOpen(true)} hitSlop={8}>
                <Feather name="crop" size={18} color={Colors.white} />
                <Text style={styles.toolBtnLabel}>Crop</Text>
              </Pressable>
            ) : null}
            {isVideo && Platform.OS !== "web" ? (
              <>
                <Pressable style={styles.toolBtn} onPress={openTrimEditor} hitSlop={8}>
                  <Feather name="scissors" size={18} color={Colors.white} />
                  <Text style={styles.toolBtnLabel}>Trim / Crop</Text>
                </Pressable>
                <Pressable style={[styles.toolBtn, soundId && styles.toolBtnActive]} onPress={() => setSoundModalOpen(true)} hitSlop={8}>
                  <Feather name="music" size={18} color={Colors.white} />
                  <Text style={styles.toolBtnLabel}>{soundId ? "Sound ✓" : "Sound"}</Text>
                </Pressable>
              </>
            ) : null}
          </View>

          {caption ? (
            <View style={styles.captionOverlay}>
              <Text style={styles.captionOverlayText}>{caption}</Text>
            </View>
          ) : null}
        </View>
      </View>

      <View style={[styles.bottomPanel, { paddingBottom: insets.bottom + Spacing.md }]}>
        <View style={styles.captionInputRow}>
          <TextInput
            style={styles.captionInput}
            placeholder="Add text to your story…"
            placeholderTextColor={Colors.textMuted}
            value={caption}
            onChangeText={setCaption}
            maxLength={STORY_MAX_CAPTION_LENGTH}
            multiline
          />
          <Text style={styles.captionCounter}>
            {caption.length}/{STORY_MAX_CAPTION_LENGTH}
          </Text>
        </View>

        <Text style={styles.privacyLabel}>Who can see this</Text>
        <View style={styles.privacyRow}>
          {STORY_PRIVACY_LEVELS.map((p) => (
            <Pressable
              key={p}
              style={[styles.privacyChip, privacy === p && styles.privacyChipActive]}
              onPress={() => {
                setPrivacy(p);
                if (p === "custom") setAudienceModalOpen(true);
              }}
            >
              <Text style={[styles.privacyChipText, privacy === p && styles.privacyChipTextActive]}>{STORY_PRIVACY_LABELS[p]}</Text>
            </Pressable>
          ))}
        </View>
        {privacy === "custom" ? (
          <Pressable style={styles.audienceSummary} onPress={() => setAudienceModalOpen(true)}>
            <Feather name="users" size={14} color={Colors.primary} />
            <Text style={styles.audienceSummaryText}>{customSelected.size > 0 ? `${customSelected.size} people selected` : "Choose people"}</Text>
          </Pressable>
        ) : null}

        <Button
          title={shareMutation.isPending ? "Posting…" : "Share to Status"}
          onPress={() => shareMutation.mutate()}
          loading={shareMutation.isPending}
          disabled={privacy === "custom" && customSelected.size === 0}
          style={{ marginTop: Spacing.md }}
        />
      </View>

      <AudienceModal visible={audienceModalOpen} selected={customSelected} onChange={setCustomSelected} onClose={() => setAudienceModalOpen(false)} />

      <Modal visible={soundModalOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSoundModalOpen(false)}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Add a sound</Text>
            <Pressable onPress={() => setSoundModalOpen(false)} hitSlop={10}>
              <Feather name="x" size={22} color={Colors.text} />
            </Pressable>
          </View>
          <Text style={styles.modalHint}>Real in-house background tracks — tap to preview, then apply to bake it into your video.</Text>
          <View style={{ paddingHorizontal: Spacing.lg }}>
            {AMBIENT_SOUNDS.map((s) => {
              const isPreviewing = previewingId === s.id;
              const isApplied = soundId === s.id;
              return (
                <View key={s.id} style={[styles.candidateRow, isApplied && styles.candidateRowSelected]}>
                  <Pressable onPress={() => previewSound(s.id)} hitSlop={8} style={styles.soundPreviewBtn}>
                    <Feather name={isPreviewing ? "pause" : "play"} size={16} color={Colors.primary} />
                  </Pressable>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.candidateName}>{s.label}</Text>
                    <Text style={styles.soundDescription}>{s.description}</Text>
                  </View>
                  <Pressable onPress={() => applySound(s.id)} disabled={soundApplying} style={styles.soundUseBtn}>
                    <Text style={styles.soundUseBtnText}>{isApplied ? "Applied ✓" : soundApplying ? "…" : "Use"}</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        </View>
      </Modal>

      <Modal visible={cropModalOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setCropModalOpen(false)}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Crop photo</Text>
            <Pressable onPress={() => setCropModalOpen(false)} hitSlop={10}>
              <Feather name="x" size={22} color={Colors.text} />
            </Pressable>
          </View>
          <Text style={styles.modalHint}>A real crop of the actual photo, centered on your pick.</Text>
          <View style={{ paddingHorizontal: Spacing.lg, gap: Spacing.sm }}>
            <Pressable style={styles.cropOptionBtn} onPress={() => cropImage("square")}>
              <Feather name="square" size={18} color={Colors.primary} />
              <Text style={styles.cropOptionText}>Square (1:1)</Text>
            </Pressable>
            <Pressable style={styles.cropOptionBtn} onPress={() => cropImage("portrait")}>
              <Feather name="smartphone" size={18} color={Colors.primary} />
              <Text style={styles.cropOptionText}>Portrait (9:16)</Text>
            </Pressable>
            <Pressable style={styles.cropOptionBtn} onPress={() => cropImage("landscape")}>
              <Feather name="image" size={18} color={Colors.primary} />
              <Text style={styles.cropOptionText}>Landscape (16:9)</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  pickerContainer: { flex: 1, backgroundColor: Colors.background, paddingHorizontal: Spacing.xl, alignItems: "center", justifyContent: "center", gap: Spacing.md },
  closeTop: { position: "absolute", top: Spacing.xl, left: Spacing.lg, zIndex: 10 },
  closeCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" },
  pickerTitle: { fontSize: 24, fontFamily: Fonts.display, color: Colors.text, textAlign: "center" },
  pickerSubtitle: { ...Typography.body, color: Colors.textSecondary, textAlign: "center", marginBottom: Spacing.lg },
  pickerBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: Spacing.sm, backgroundColor: Colors.primary, borderRadius: BorderRadius.pill, paddingVertical: 16, width: "100%" },
  pickerBtnAlt: { backgroundColor: Colors.surfaceAlt, borderWidth: 1.5, borderColor: Colors.primary },
  pickerBtnText: { color: Colors.white, fontFamily: Fonts.bodyBold, fontSize: 16 },
  previewContainer: { flex: 1, backgroundColor: "#000" },
  mediaFrameWrap: { flex: 1, justifyContent: "center" },
  mediaFrame: { width: "100%", alignSelf: "center" },
  media: { width: "100%", height: "100%" },
  mediaToolbar: { position: "absolute", top: Spacing.md, right: Spacing.md, gap: Spacing.sm, alignItems: "flex-end" },
  toolBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: BorderRadius.pill,
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  toolBtnActive: { backgroundColor: Colors.primary },
  toolBtnLabel: { color: Colors.white, fontSize: 13, fontFamily: Fonts.bodyBold },
  captionOverlay: { position: "absolute", bottom: Spacing.lg, left: Spacing.lg, right: Spacing.lg, backgroundColor: "rgba(0,0,0,0.55)", borderRadius: BorderRadius.md, padding: Spacing.sm },
  captionOverlayText: { color: Colors.white, fontSize: 16, fontFamily: Fonts.bodyBold, textAlign: "center" },
  bottomPanel: { backgroundColor: Colors.surface, borderTopLeftRadius: BorderRadius.xl, borderTopRightRadius: BorderRadius.xl, padding: Spacing.lg, gap: Spacing.sm },
  captionInputRow: { position: "relative" },
  captionInput: { backgroundColor: Colors.surfaceAlt, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, padding: Spacing.sm, color: Colors.text, fontSize: 15, minHeight: 44 },
  captionCounter: { position: "absolute", bottom: 6, right: 10, ...Typography.small, color: Colors.textMuted, fontSize: 10 },
  privacyLabel: { ...Typography.small, color: Colors.textSecondary, fontWeight: "700", marginTop: Spacing.xs },
  privacyRow: { flexDirection: "row", gap: Spacing.sm },
  privacyChip: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: BorderRadius.pill, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.surfaceAlt },
  privacyChipActive: { borderColor: Colors.primary, backgroundColor: Colors.primary },
  privacyChipText: { ...Typography.small, color: Colors.text, fontWeight: "700" },
  privacyChipTextActive: { color: Colors.white },
  audienceSummary: { flexDirection: "row", alignItems: "center", gap: 6 },
  audienceSummaryText: { ...Typography.small, color: Colors.primary, fontWeight: "700" },
  modalContainer: { flex: 1, backgroundColor: Colors.background },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: Spacing.lg },
  modalTitle: { ...Typography.h3, color: Colors.text },
  searchRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, marginHorizontal: Spacing.lg, backgroundColor: Colors.surfaceAlt, borderRadius: BorderRadius.pill, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: Spacing.md, paddingVertical: 10 },
  searchInput: { flex: 1, color: Colors.text, fontSize: 15 },
  modalHint: { ...Typography.small, color: Colors.textMuted, marginHorizontal: Spacing.lg, marginTop: Spacing.xs, marginBottom: Spacing.sm },
  candidateRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, paddingVertical: 10, paddingHorizontal: Spacing.md, backgroundColor: Colors.surface, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, marginBottom: Spacing.xs },
  candidateRowSelected: { borderColor: Colors.primary, backgroundColor: `${Colors.primary}0D` },
  candidateAvatar: { width: 32, height: 32, borderRadius: 16 },
  candidateAvatarPlaceholder: { backgroundColor: Colors.surfaceAlt },
  candidateName: { ...Typography.body, color: Colors.text, flex: 1 },
  friendTag: { ...Typography.small, color: Colors.success, fontWeight: "700", fontSize: 10 },
  emptyText: { ...Typography.small, color: Colors.textMuted, textAlign: "center", marginTop: Spacing.xl },
  modalFooter: { padding: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.border },
  soundPreviewBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: `${Colors.primary}1A`, alignItems: "center", justifyContent: "center" },
  soundDescription: { ...Typography.small, color: Colors.textMuted },
  soundUseBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: BorderRadius.pill, backgroundColor: Colors.primary },
  soundUseBtnText: { color: Colors.white, fontFamily: Fonts.bodyBold, fontSize: 13 },
  cropOptionBtn: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, paddingVertical: 14, paddingHorizontal: Spacing.md, backgroundColor: Colors.surface, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border },
  cropOptionText: { ...Typography.body, color: Colors.text, fontFamily: Fonts.bodyBold },
});
