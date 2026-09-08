import React, { useRef, useState } from "react";
import { ActivityIndicator, Image, Linking, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { File } from "expo-file-system";
import { Ionicons } from "@expo/vector-icons";
import { GalaxyBackground } from "../components/GalaxyBackground";
import { colors, radii, spacing, typography } from "../theme/colors";
import { api, ApiError } from "../lib/api";

const URL_PATTERN = /^https?:\/\/\S+$/i;

/** Real QR/barcode decode via expo-camera's onBarcodeScanned — the "ask", "watch it" -> "understand it" mode alongside photo-ask. */
function ScanTab() {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [breakdown, setBreakdown] = useState<string | null>(null);
  const scanLockRef = useRef(false);

  if (!permission) return null;
  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Ionicons name="qr-code-outline" size={48} color={colors.textMuted} />
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
          <Ionicons name={isUrl ? "link" : "barcode-outline"} size={28} color={colors.accentBright} />
          <Text style={styles.scanValue} numberOfLines={3}>{scanned}</Text>
          {busy ? (
            <ActivityIndicator color={colors.accentBright} />
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
  const [tab, setTab] = useState<"ask" | "scan">("ask");
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);

  const TabBar = (
    <View style={styles.tabBar}>
      <TouchableOpacity testID="camera-ask-tab" style={[styles.tabButton, tab === "ask" && styles.tabButtonActive]} onPress={() => setTab("ask")}>
        <Ionicons name="help-circle-outline" size={16} color={tab === "ask" ? "#fff" : colors.textSecondary} />
        <Text style={[styles.tabButtonText, tab === "ask" && styles.tabButtonTextActive]}>Ask about a photo</Text>
      </TouchableOpacity>
      <TouchableOpacity testID="camera-scan-tab" style={[styles.tabButton, tab === "scan" && styles.tabButtonActive]} onPress={() => setTab("scan")}>
        <Ionicons name="qr-code-outline" size={16} color={tab === "scan" ? "#fff" : colors.textSecondary} />
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
          <Ionicons name="camera-outline" size={48} color={colors.textMuted} />
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
    if (photo) setPhotoUri(photo.uri);
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

  if (photoUri) {
    return (
      <GalaxyBackground>
        {TabBar}
        <View style={styles.container}>
          <Image source={{ uri: photoUri }} style={styles.preview} />
          <TextInput
            style={styles.input}
            placeholder="What do you want to know about this?"
            placeholderTextColor={colors.textMuted}
            value={question}
            onChangeText={setQuestion}
          />
          <View style={styles.row}>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => { setPhotoUri(null); setAnswer(null); }}>
              <Text style={styles.secondaryButtonText}>Retake</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryButton} onPress={askAboutPhoto} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Ask NexaAi</Text>}
            </TouchableOpacity>
          </View>
          {answer && <Text style={styles.answer}>{answer}</Text>}
        </View>
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

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.md, gap: spacing.md },
  camera: { flex: 1, borderRadius: radii.lg, overflow: "hidden" },
  preview: { flex: 1, borderRadius: radii.lg },
  shutter: { alignSelf: "center", width: 72, height: 72, borderRadius: 36, borderWidth: 4, borderColor: colors.accentBright, alignItems: "center", justifyContent: "center", marginVertical: spacing.md },
  shutterInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.accent },
  input: { backgroundColor: colors.bgCard, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, color: colors.textPrimary },
  row: { flexDirection: "row", gap: spacing.sm },
  primaryButton: { flex: 1, backgroundColor: colors.accent, borderRadius: radii.md, padding: spacing.md, alignItems: "center" },
  primaryButtonText: { color: "#fff", fontWeight: "700" },
  secondaryButton: { flex: 1, backgroundColor: colors.bgCard, borderRadius: radii.md, padding: spacing.md, alignItems: "center", borderWidth: 1, borderColor: colors.border },
  secondaryButtonText: { color: colors.textSecondary, fontWeight: "700" },
  answer: { ...typography.body, color: colors.textPrimary, backgroundColor: colors.bgCard, padding: spacing.md, borderRadius: radii.md },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },
  permissionText: { ...typography.body, color: colors.textSecondary, textAlign: "center" },
  tabBar: { flexDirection: "row", gap: spacing.sm, padding: spacing.md, paddingBottom: 0 },
  tabButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabButtonActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  tabButtonText: { ...typography.caption, color: colors.textSecondary, fontWeight: "700" },
  tabButtonTextActive: { color: "#fff" },
  scanHint: { ...typography.caption, color: colors.textMuted, textAlign: "center", paddingTop: spacing.sm },
  grantButton: { alignSelf: "stretch", backgroundColor: colors.accent, borderRadius: radii.md, padding: spacing.md, alignItems: "center" },
  resultPanel: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.lg },
  scanValue: { ...typography.body, color: colors.textPrimary, textAlign: "center", backgroundColor: colors.bgCard, padding: spacing.md, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border },
});
