import React, { useRef, useState } from "react";
import { View, StyleSheet, Text, Pressable, Modal, Dimensions, Platform } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Feather } from "@expo/vector-icons";
import { Colors, Spacing, BorderRadius } from "@/constants/theme";
import { Button } from "./ui";

const { width } = Dimensions.get("window");
// A trading card is ~2.5:3.5in — the guide frame below is drawn in that
// ratio, laid out horizontally (landscape) as requested, so sellers can
// line the card up consistently before capturing.
const FRAME_WIDTH = width * 0.85;
const FRAME_HEIGHT = FRAME_WIDTH * (2.5 / 3.5);

export function CardScannerModal({ visible, onClose, onCapture }: { visible: boolean; onClose: () => void; onCapture: (uri: string) => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [capturing, setCapturing] = useState(false);

  const handleCapture = async () => {
    if (!cameraRef.current || capturing) return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.85 });
      if (photo?.uri) onCapture(photo.uri);
    } catch (err) {
      console.error("Failed to capture photo:", err);
    } finally {
      setCapturing(false);
    }
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
              <Text style={styles.instructions}>Line the card up inside the frame</Text>
              <View style={styles.frame} pointerEvents="none" />
              <View style={styles.controls}>
                <Pressable onPress={handleCapture} style={styles.shutterOuter} disabled={capturing}>
                  <View style={styles.shutterInner} />
                </Pressable>
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
  instructions: { position: "absolute", top: 56, color: Colors.white, fontWeight: "700", fontSize: 15 },
  frame: { width: FRAME_WIDTH, height: FRAME_HEIGHT, borderWidth: 3, borderColor: Colors.gold, borderRadius: BorderRadius.md },
  controls: { position: "absolute", bottom: 50 },
  shutterOuter: { width: 74, height: 74, borderRadius: 37, borderWidth: 4, borderColor: Colors.white, alignItems: "center", justifyContent: "center" },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: Colors.white },
});
