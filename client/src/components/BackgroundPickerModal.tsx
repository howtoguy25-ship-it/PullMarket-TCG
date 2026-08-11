import React, { useEffect, useState } from "react";
import { View, StyleSheet, Text, Modal, Pressable, Image, ActivityIndicator, Platform, Alert } from "react-native";
import { Colors, Spacing, BorderRadius, Typography } from "@/constants/theme";
import { fetchCardBackgrounds, applyCardBackground, CardBackgroundOption } from "@/lib/cardComposite";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

/** Shown right after a card photo is captured/picked — lets the seller drop
 * it onto one of the pre-built backdrops, or skip and keep the plain photo. */
export function BackgroundPickerModal({
  visible,
  photoUri,
  onDone,
  onCancel,
}: {
  visible: boolean;
  photoUri: string | null;
  onDone: (finalUri: string) => void;
  onCancel: () => void;
}) {
  const [backgrounds, setBackgrounds] = useState<CardBackgroundOption[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setLoadingList(true);
    fetchCardBackgrounds()
      .then(setBackgrounds)
      .catch(() => setBackgrounds([]))
      .finally(() => setLoadingList(false));
  }, [visible]);

  if (!visible || !photoUri) return null;

  const handlePick = async (backgroundId: string) => {
    if (backgroundId === "none") {
      onDone(photoUri);
      return;
    }
    setApplyingId(backgroundId);
    try {
      const finalUri = await applyCardBackground(photoUri, backgroundId);
      onDone(finalUri);
    } catch (err) {
      showAlert("Couldn't apply that background", "Please try again, or use the photo as-is.");
    } finally {
      setApplyingId(null);
    }
  };

  const busy = applyingId !== null;
  const options: (CardBackgroundOption & { isNone?: boolean })[] = [{ id: "none", label: "None (raw photo)", previewUrl: photoUri, isNone: true }, ...backgrounds];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Give it a backdrop?</Text>
          <Text style={styles.subtitle}>Drop your card onto one of these, or pick "None" to keep the plain photo.</Text>

          <View style={styles.previewRow}>
            <Image source={{ uri: photoUri }} style={styles.photoPreview} />
          </View>

          {loadingList ? (
            <ActivityIndicator color={Colors.primary} style={{ marginVertical: Spacing.lg }} />
          ) : (
            <View style={styles.grid}>
              {options.map((bg) => (
                <Pressable key={bg.id} style={styles.option} onPress={() => handlePick(bg.id)} disabled={busy}>
                  <View style={[styles.optionThumbWrap, bg.isNone && styles.optionThumbWrapNone]}>
                    <Image source={{ uri: bg.previewUrl }} style={styles.optionThumb} resizeMode="cover" />
                    {applyingId === bg.id ? (
                      <View style={styles.optionOverlay}>
                        <ActivityIndicator color={Colors.white} />
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.optionLabel}>{bg.label}</Text>
                </Pressable>
              ))}
            </View>
          )}

          <Pressable onPress={onCancel} disabled={busy} style={{ marginTop: Spacing.lg, alignItems: "center" }}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: Colors.surface, borderTopLeftRadius: BorderRadius.xl, borderTopRightRadius: BorderRadius.xl, padding: Spacing.lg, maxHeight: "88%" },
  title: { ...Typography.h3, color: Colors.text, textAlign: "center" },
  subtitle: { ...Typography.small, color: Colors.textSecondary, textAlign: "center", marginTop: 4 },
  previewRow: { alignItems: "center", marginTop: Spacing.md },
  photoPreview: { width: 90, height: 126, borderRadius: BorderRadius.md, backgroundColor: Colors.surfaceAlt },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: Spacing.md, marginTop: Spacing.lg },
  option: { alignItems: "center", gap: 6, width: 96 },
  optionThumbWrap: { width: 96, height: 120, borderRadius: BorderRadius.md, overflow: "hidden", borderWidth: 1.5, borderColor: Colors.border },
  optionThumbWrapNone: { borderStyle: "dashed", borderColor: Colors.textMuted },
  optionThumb: { width: "100%", height: "100%" },
  optionOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" },
  optionLabel: { ...Typography.small, color: Colors.text, fontWeight: "600", textAlign: "center" },
  cancelText: { color: Colors.textSecondary, fontSize: 15 },
});
