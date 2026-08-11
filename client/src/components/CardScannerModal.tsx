import React, { useEffect, useRef, useState } from "react";
import { View, StyleSheet, Text, Pressable, Modal, Dimensions, Platform } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { Feather } from "@expo/vector-icons";
import { Colors, Spacing, BorderRadius } from "@/constants/theme";
import { Button } from "./ui";

const { width } = Dimensions.get("window");
// A trading card is ~2.5:3.5in — the guide frame below is drawn in that
// ratio, laid out horizontally (landscape) as requested, so sellers can
// line the card up consistently before capturing.
const FRAME_WIDTH = width * 0.85;
const FRAME_HEIGHT = FRAME_WIDTH * (2.5 / 3.5);

// Auto-capture is a real motion-stability detector, not simulated: it reads
// the device accelerometer and fires once the phone has stopped moving for
// a short beat, the same "hold steady to capture" signal document scanners
// use. It's not true card-edge computer vision (that needs a native ML
// model, a much bigger lift) — the border prompt is honest about that.
const STEADY_JITTER_THRESHOLD = 0.018;
const STEADY_HOLD_MS = 700;
const MIN_READY_DELAY_MS = 900;
const SAMPLE_INTERVAL_MS = 80;

export function CardScannerModal({ visible, onClose, onCapture }: { visible: boolean; onClose: () => void; onCapture: (uri: string) => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [capturing, setCapturing] = useState(false);
  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const [holding, setHolding] = useState(false);

  const lastMagnitude = useRef<number | null>(null);
  const steadySinceRef = useRef<number | null>(null);
  const readyAtRef = useRef<number>(0);
  const capturingRef = useRef(false);
  const subscriptionRef = useRef<{ remove: () => void } | null>(null);

  useEffect(() => {
    capturingRef.current = capturing;
  }, [capturing]);

  const handleCapture = async () => {
    if (!cameraRef.current || capturingRef.current) return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.85 });
      if (photo?.uri) {
        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        onCapture(photo.uri);
      }
    } catch (err) {
      console.error("Failed to capture photo:", err);
    } finally {
      setCapturing(false);
      setHolding(false);
      steadySinceRef.current = null;
    }
  };

  // Motion-stability auto-capture — native only (no accelerometer on web).
  useEffect(() => {
    subscriptionRef.current?.remove();
    subscriptionRef.current = null;
    setHolding(false);
    steadySinceRef.current = null;
    lastMagnitude.current = null;

    if (!visible || Platform.OS === "web" || mode !== "auto" || !permission?.granted) return;

    readyAtRef.current = Date.now() + MIN_READY_DELAY_MS;
    let cancelled = false;

    import("expo-sensors").then(({ Accelerometer }) => {
      if (cancelled) return;
      Accelerometer.setUpdateInterval(SAMPLE_INTERVAL_MS);
      subscriptionRef.current = Accelerometer.addListener(({ x, y, z }) => {
        if (capturingRef.current) return;
        const magnitude = Math.sqrt(x * x + y * y + z * z);
        const now = Date.now();
        const prev = lastMagnitude.current;
        lastMagnitude.current = magnitude;
        if (prev === null || now < readyAtRef.current) return;

        const jitter = Math.abs(magnitude - prev);
        if (jitter < STEADY_JITTER_THRESHOLD) {
          if (steadySinceRef.current === null) steadySinceRef.current = now;
          const heldFor = now - steadySinceRef.current;
          setHolding(heldFor > 150);
          if (heldFor >= STEADY_HOLD_MS) {
            steadySinceRef.current = null;
            handleCapture();
          }
        } else {
          steadySinceRef.current = null;
          setHolding(false);
        }
      });
    });

    return () => {
      cancelled = true;
      subscriptionRef.current?.remove();
      subscriptionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, mode, permission?.granted]);

  const pickFromLibrary = async () => {
    const libPermission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!libPermission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85 });
    if (!result.canceled && result.assets[0]) onCapture(result.assets[0].uri);
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        {!permission ? (
          <View style={styles.center} />
        ) : !permission.granted ? (
          <View style={styles.center}>
            <Feather name="camera-off" size={40} color={Colors.white} />
            <Text style={styles.permissionText}>Camera access is needed to scan cards.</Text>
            <Button title="Grant camera access" onPress={requestPermission} style={{ marginTop: Spacing.lg }} />
            <Pressable onPress={onClose} style={{ marginTop: Spacing.md }}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
            <View style={styles.overlay}>
              <Pressable onPress={onClose} style={styles.closeButton} hitSlop={10}>
                <Feather name="x" size={26} color={Colors.white} />
              </Pressable>

              {Platform.OS !== "web" ? (
                <View style={styles.modeSwitch}>
                  <Pressable onPress={() => setMode("auto")} style={[styles.modePill, mode === "auto" && styles.modePillActive]}>
                    <Text style={[styles.modePillText, mode === "auto" && styles.modePillTextActive]}>Auto</Text>
                  </Pressable>
                  <Pressable onPress={() => setMode("manual")} style={[styles.modePill, mode === "manual" && styles.modePillActive]}>
                    <Text style={[styles.modePillText, mode === "manual" && styles.modePillTextActive]}>Manual</Text>
                  </Pressable>
                </View>
              ) : null}

              <Text style={styles.instructions}>
                {mode === "auto" && Platform.OS !== "web" ? (holding ? "Hold still…" : "Line the card up and hold steady") : "Line the card up inside the frame"}
              </Text>
              <View style={[styles.frame, holding && styles.frameHolding]} pointerEvents="none" />

              <View style={styles.controls}>
                <Pressable onPress={pickFromLibrary} style={styles.sideButton} hitSlop={10}>
                  <Feather name="image" size={22} color={Colors.white} />
                  <Text style={styles.sideButtonText}>Manual upload</Text>
                </Pressable>
                <Pressable onPress={handleCapture} style={styles.shutterOuter} disabled={capturing}>
                  <View style={styles.shutterInner} />
                </Pressable>
                <View style={styles.sideButton} />
              </View>
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: Spacing.xl },
  permissionText: { color: Colors.white, textAlign: "center", marginTop: Spacing.md, fontSize: 16 },
  cancelText: { color: "rgba(255,255,255,0.7)", fontSize: 15 },
  overlay: { flex: 1, alignItems: "center", justifyContent: "center" },
  closeButton: { position: "absolute", top: 50, right: Spacing.lg, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 20, padding: 8 },
  modeSwitch: { position: "absolute", top: 52, flexDirection: "row", backgroundColor: "rgba(255,255,255,0.12)", borderRadius: BorderRadius.pill, padding: 3 },
  modePill: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: BorderRadius.pill },
  modePillActive: { backgroundColor: Colors.white },
  modePillText: { color: "rgba(255,255,255,0.8)", fontWeight: "700", fontSize: 13 },
  modePillTextActive: { color: "#111" },
  instructions: { position: "absolute", top: 100, color: Colors.white, fontWeight: "700", fontSize: 15 },
  frame: { width: FRAME_WIDTH, height: FRAME_HEIGHT, borderWidth: 3, borderColor: Colors.gold, borderRadius: BorderRadius.md },
  frameHolding: { borderColor: Colors.success },
  controls: { position: "absolute", bottom: 50, flexDirection: "row", alignItems: "center", justifyContent: "center", width: "100%", paddingHorizontal: Spacing.xl },
  sideButton: { width: 84, alignItems: "center", gap: 4 },
  sideButtonText: { color: Colors.white, fontSize: 11, fontWeight: "600" },
  shutterOuter: { width: 74, height: 74, borderRadius: 37, borderWidth: 4, borderColor: Colors.white, alignItems: "center", justifyContent: "center" },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: Colors.white },
});
