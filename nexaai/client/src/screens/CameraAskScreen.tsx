import React, { useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { File } from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { GalaxyBackground } from "../components/GalaxyBackground";
import { radii, spacing, typography } from "../theme/colors";
import { useTheme } from "../lib/ThemeContext";
import type { Palette } from "../theme/palettes";
import { api, ApiError } from "../lib/api";

const URL_PATTERN = /^https?:\/\/\S+$/i;

/** Real QR/barcode decode via expo-camera's onBarcodeScanned — the "ask", "watch it" -> "understand it" mode alongside photo-ask. */
function ScanTab() {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [breakdown, setBreakdown] = useState<string | null>(null);
  const scanLockRef = useRef(false);

  if (!permission) return null;
  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Ionicons name="qr-code-outline" size={48} color={palette.textMuted} />
        <Text style={styles.permissionText}>NexaAi needs camera access to scan QR codes and barcodes.</Text>
        <TouchableOpacity style={styles.grantButton} onPress={requestPermission}>
          <Text style={styles.primaryButtonText}>Grant camera access</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const handleScan = async (result: BarcodeScanningResult) => {
    if (scanLockRef.current) return;
    scanLockRef.current = true;
    setScanned(result.data);
    setBusy(true);
    setBreakdown(null);
    try {
      const isUrl = URL_PATTERN.test(result.data);
      const question = isUrl
        ? `I scanned a QR code and it decoded to this link: ${result.data}\nBreak down plainly what this link is/leads to before I open it, and flag anything that looks unsafe.`
        : `I scanned a QR code/barcode and it decoded to this: "${result.data}"\nBreak down plainly what this is and what I should do with it.`;
      const res = await api<{ message: { content: string } }>("/api/chat/messages", {
        method: "POST",
        body: JSON.stringify({ text: question, kind: "text" }),
      });
      setBreakdown(res.message.content);
    } catch (err) {
      setBreakdown(err instanceof ApiError ? err.message : "Couldn't reach NexaAi to break this down — try again.");
    } finally {
      setBusy(false);
    }
  };

  const scanAnother = () => {
    setScanned(null);
    setBreakdown(null);
    scanLockRef.current = false;
  };

  const isUrl = scanned ? URL_PATTERN.test(scanned) : false;

  return (
    <View style={styles.container}>
      {!scanned ? (
        <>
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr", "ean13", "ean8", "code128", "code39", "pdf417", "upc_a", "upc_e"] }}
            onBarcodeScanned={handleScan}
          />
          <Text style={styles.scanHint}>Point the camera at a QR code or barcode</Text>
        </>
      ) : (
        <View style={styles.resultPanel}>
          <Ionicons name={isUrl ? "link" : "barcode-outline"} size={28} color={palette.accentBright} />
          <Text style={styles.scanValue} numberOfLines={3}>{scanned}</Text>
          {busy ? (
            <ActivityIndicator color={palette.accentBright} />
          ) : (
            <>
              {breakdown && <Text style={styles.answer}>{breakdown}</Text>}
              <View style={styles.row}>
                {isUrl && (
                  <TouchableOpacity style={styles.primaryButton} onPress={() => Linking.openURL(scanned!)}>
                    <Text style={styles.primaryButtonText}>Open link</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.secondaryButton} onPress={scanAnother}>
                  <Text style={styles.secondaryButtonText}>Scan another</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      )}
    </View>
  );
}

export function CameraAskScreen() {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [tab, setTab] = useState<"ask" | "scan">("ask");
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoSize, setPhotoSize] = useState<{ width: number; height: number } | null>(null);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [questionFocused, setQuestionFocused] = useState(false);

  const TabBar = (
    <View style={styles.tabBar}>
      <TouchableOpacity testID="camera-ask-tab" style={[styles.tabButton, tab === "ask" && styles.tabButtonActive]} onPress={() => setTab("ask")}>
        <Ionicons name="help-circle-outline" size={16} color={tab === "ask" ? "#fff" : palette.textSecondary} />
        <Text style={[styles.tabButtonText, tab === "ask" && styles.tabButtonTextActive]}>Ask about a photo</Text>
      </TouchableOpacity>
      <TouchableOpacity testID="camera-scan-tab" style={[styles.tabButton, tab === "scan" && styles.tabButtonActive]} onPress={() => setTab("scan")}>
        <Ionicons name="qr-code-outline" size={16} color={tab === "scan" ? "#fff" : palette.textSecondary} />
        <Text style={[styles.tabButtonText, tab === "scan" && styles.tabButtonTextActive]}>Scan a code</Text>
      </TouchableOpacity>
    </View>
  );

  if (tab === "scan") {
    return (
      <GalaxyBackground>
        {TabBar}
        <ScanTab />
      </GalaxyBackground>
    );
  }

  if (!permission) return null;
  if (!permission.granted) {
    return (
      <GalaxyBackground>
        {TabBar}
        <View style={styles.center}>
          <Ionicons name="camera-outline" size={48} color={palette.textMuted} />
          <Text style={styles.permissionText}>NexaAi needs camera access so you can snap a photo and ask about it.</Text>
          <TouchableOpacity style={styles.grantButton} onPress={requestPermission}>
            <Text style={styles.primaryButtonText}>Grant camera access</Text>
          </TouchableOpacity>
        </View>
      </GalaxyBackground>
    );
  }

  const takePhoto = async () => {
    const photo = await cameraRef.current?.takePictureAsync({ base64: false, quality: 0.6 });
    if (photo) {
      setPhotoUri(photo.uri);
      setPhotoSize({ width: photo.width, height: photo.height });
    }
  };

  // Real edits via expo-image-manipulator — actually re-encodes the file at
  // photoUri, not a cosmetic preview transform. Rotate is exact; "Crop to
  // square" centers a real square crop using the photo's own dimensions
  // (kept from takePictureAsync) rather than guessing at aspect ratio.
  const rotatePhoto = async () => {
    if (!photoUri) return;
    setEditing(true);
    try {
      const result = await ImageManipulator.manipulateAsync(photoUri, [{ rotate: 90 }], { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG });
      setPhotoUri(result.uri);
      setPhotoSize({ width: result.width, height: result.height });
    } finally {
      setEditing(false);
    }
  };

  const cropToSquare = async () => {
    if (!photoUri || !photoSize) return;
    setEditing(true);
    try {
      const side = Math.min(photoSize.width, photoSize.height);
      const originX = Math.round((photoSize.width - side) / 2);
      const originY = Math.round((photoSize.height - side) / 2);
      const result = await ImageManipulator.manipulateAsync(
        photoUri,
        [{ crop: { originX, originY, width: side, height: side } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
      );
      setPhotoUri(result.uri);
      setPhotoSize({ width: result.width, height: result.height });
    } finally {
      setEditing(false);
    }
  };

  const askAboutPhoto = async () => {
    if (!photoUri || !question.trim()) return;
    setBusy(true);
    setAnswer(null);
    try {
      const base64 = await new File(photoUri).base64();
      const result = await api<{ message: { content: string } }>("/api/chat/messages", {
        method: "POST",
        body: JSON.stringify({
          text: question,
          kind: "camera_ask",
          imageBase64: base64,
          imageMediaType: "image/jpeg",
        }),
      });
      setAnswer(result.message.content);
    } catch (err) {
      setAnswer(err instanceof ApiError ? err.message : "Couldn't reach NexaAi — try again.");
    } finally {
      setBusy(false);
    }
  };

  // The preview box always matches the real captured (or edited) photo's
  // own aspect ratio, so nothing gets cropped/stretched to fit a guessed
  // shape — a rotate or square-crop updates photoSize, so this follows.
  const previewAspectRatio = photoSize && photoSize.height > 0 ? photoSize.width / photoSize.height : 3 / 4;

  if (photoUri) {
    return (
      <GalaxyBackground>
        {TabBar}
        <ScrollView style={styles.scrollContainer} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={[styles.previewWrap, { aspectRatio: previewAspectRatio }]}>
            <Image source={{ uri: photoUri }} style={styles.preview} resizeMode="contain" />
            {editing && (
              <View style={styles.previewOverlay}>
                <ActivityIndicator color="#fff" />
                <Text style={styles.previewOverlayText}>Applying edit…</Text>
              </View>
            )}
          </View>

          <View style={styles.editToolbar}>
            <View style={styles.editToolbarHeader}>
              <Ionicons name="sparkles-outline" size={13} color={palette.accentBright} />
              <Text style={styles.editToolbarLabel}>Edit photo</Text>
            </View>
            <View style={styles.editButtonsRow}>
              <TouchableOpacity style={styles.editButtonBox} onPress={rotatePhoto} disabled={editing} activeOpacity={0.75}>
                <LinearGradient colors={[palette.accent, palette.accentBright]} style={styles.editIconCircle}>
                  <Ionicons name="reload-outline" size={22} color="#fff" />
                </LinearGradient>
                <Text style={styles.editButtonText}>Rotate</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.editButtonBox} onPress={cropToSquare} disabled={editing} activeOpacity={0.75}>
                <LinearGradient colors={[palette.accent, palette.accentBright]} style={styles.editIconCircle}>
                  <Ionicons name="crop-outline" size={22} color="#fff" />
                </LinearGradient>
                <Text style={styles.editButtonText}>Crop to square</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={[styles.questionCard, questionFocused && styles.questionCardFocused]}>
            <View style={styles.questionHeader}>
              <Ionicons name="chatbubble-ellipses-outline" size={14} color={palette.accentBright} />
              <Text style={styles.questionLabel}>Your question</Text>
            </View>
            <TextInput
              style={styles.questionInput}
              placeholder="e.g. What is this, and is it safe to eat?"
              placeholderTextColor={palette.textMuted}
              value={question}
              onChangeText={setQuestion}
              onFocus={() => setQuestionFocused(true)}
              onBlur={() => setQuestionFocused(false)}
              multiline
            />
          </View>

          <View style={styles.row}>
            <TouchableOpacity
              style={styles.secondaryButton}
              activeOpacity={0.75}
              onPress={() => { setPhotoUri(null); setPhotoSize(null); setAnswer(null); }}
            >
              <Ionicons name="camera-reverse-outline" size={17} color={palette.textSecondary} />
              <Text style={styles.secondaryButtonText}>Retake</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryButtonWrap} activeOpacity={0.8} onPress={askAboutPhoto} disabled={busy || editing}>
              <LinearGradient colors={[palette.accent, palette.accentBright]} style={styles.primaryButton}>
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="sparkles" size={16} color="#fff" />
                    <Text style={styles.primaryButtonText}>Ask NexaAi</Text>
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </View>
          {answer && <Text style={styles.answer}>{answer}</Text>}
        </ScrollView>
      </GalaxyBackground>
    );
  }

  return (
    <GalaxyBackground>
      {TabBar}
      <View style={styles.container}>
        <CameraView ref={cameraRef} style={styles.camera} facing="back" />
        <TouchableOpacity style={styles.shutter} onPress={takePhoto}>
          <View style={styles.shutterInner} />
        </TouchableOpacity>
      </View>
    </GalaxyBackground>
  );
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    container: { flex: 1, padding: spacing.md, gap: spacing.md },
    camera: { flex: 1, borderRadius: radii.lg, overflow: "hidden" },
    scrollContainer: { flex: 1 },
    scrollContent: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
    previewWrap: {
      width: "100%",
      aspectRatio: 3 / 4,
      borderRadius: radii.lg,
      overflow: "hidden",
      backgroundColor: palette.bgCard,
      borderWidth: 1,
      borderColor: palette.border,
    },
    preview: { width: "100%", height: "100%" },
    previewOverlay: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(0,0,0,0.45)",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
    },
    previewOverlayText: { ...typography.caption, color: "#fff", fontWeight: "700" },
    shutter: { alignSelf: "center", width: 72, height: 72, borderRadius: 36, borderWidth: 4, borderColor: palette.accentBright, alignItems: "center", justifyContent: "center", marginVertical: spacing.md },
    shutterInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: palette.accent },
    editToolbar: {
      backgroundColor: palette.bgCard,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      padding: spacing.md,
      gap: spacing.sm,
      shadowColor: "#000",
      shadowOpacity: 0.18,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 5 },
      elevation: 4,
    },
    editToolbarHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
    editToolbarLabel: { ...typography.caption, color: palette.textMuted, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
    editButtonsRow: { flexDirection: "row", gap: spacing.sm },
    editButtonBox: {
      flex: 1,
      alignItems: "center",
      gap: 8,
      paddingVertical: spacing.md,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.bgCardAlt,
      shadowColor: palette.accent,
      shadowOpacity: 0.25,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 3,
    },
    editIconCircle: {
      width: 52,
      height: 52,
      borderRadius: 26,
      alignItems: "center",
      justifyContent: "center",
      shadowColor: "#000",
      shadowOpacity: 0.25,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 2 },
    },
    editButtonText: { ...typography.caption, color: palette.textSecondary, fontWeight: "700", fontSize: 13 },
    questionCard: {
      backgroundColor: palette.bgCard,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      padding: spacing.md,
      gap: spacing.sm,
      shadowColor: "#000",
      shadowOpacity: 0.12,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
      elevation: 2,
    },
    questionCardFocused: { borderColor: palette.accentBright, shadowOpacity: 0.22 },
    questionHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
    questionLabel: { ...typography.caption, color: palette.textMuted, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
    questionInput: { ...typography.body, color: palette.textPrimary, minHeight: 44, maxHeight: 120, textAlignVertical: "top", padding: 0 },
    row: { flexDirection: "row", gap: spacing.sm },
    primaryButtonWrap: {
      flex: 1,
      borderRadius: radii.md,
      overflow: "hidden",
      shadowColor: palette.accent,
      shadowOpacity: 0.35,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 4,
    },
    primaryButton: {
      flex: 1,
      backgroundColor: palette.accent,
      borderRadius: radii.md,
      padding: spacing.md,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 6,
    },
    primaryButtonText: { color: "#fff", fontWeight: "700" },
    secondaryButton: {
      flex: 1,
      backgroundColor: palette.bgCard,
      borderRadius: radii.md,
      padding: spacing.md,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 6,
      borderWidth: 1,
      borderColor: palette.border,
    },
    secondaryButtonText: { color: palette.textSecondary, fontWeight: "700" },
    answer: { ...typography.body, color: palette.textPrimary, backgroundColor: palette.bgCard, padding: spacing.md, borderRadius: radii.md },
    center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },
    permissionText: { ...typography.body, color: palette.textSecondary, textAlign: "center" },
    tabBar: { flexDirection: "row", gap: spacing.sm, padding: spacing.md, paddingBottom: 0 },
    tabButton: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingVertical: spacing.sm,
      borderRadius: radii.pill,
      backgroundColor: palette.bgCard,
      borderWidth: 1,
      borderColor: palette.border,
    },
    tabButtonActive: { backgroundColor: palette.accent, borderColor: palette.accent },
    tabButtonText: { ...typography.caption, color: palette.textSecondary, fontWeight: "700" },
    tabButtonTextActive: { color: "#fff" },
    scanHint: { ...typography.caption, color: palette.textMuted, textAlign: "center", paddingTop: spacing.sm },
    grantButton: { alignSelf: "stretch", backgroundColor: palette.accent, borderRadius: radii.md, padding: spacing.md, alignItems: "center" },
    resultPanel: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.lg },
    scanValue: { ...typography.body, color: palette.textPrimary, textAlign: "center", backgroundColor: palette.bgCard, padding: spacing.md, borderRadius: radii.md, borderWidth: 1, borderColor: palette.border },
  });
}
