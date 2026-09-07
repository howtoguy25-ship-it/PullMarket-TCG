import React, { useRef, useState } from "react";
import { ActivityIndicator, Image, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { File } from "expo-file-system";
import { Ionicons } from "@expo/vector-icons";
import { GalaxyBackground } from "../components/GalaxyBackground";
import { colors, radii, spacing, typography } from "../theme/colors";
import { api, ApiError } from "../lib/api";

export function CameraAskScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);

  if (!permission) return null;
  if (!permission.granted) {
    return (
      <GalaxyBackground>
        <View style={styles.center}>
          <Ionicons name="camera-outline" size={48} color={colors.textMuted} />
          <Text style={styles.permissionText}>NexaAi needs camera access so you can snap a photo and ask about it.</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={requestPermission}>
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
});
