import React, { useRef, useState } from "react";
import { View, StyleSheet, Text, ScrollView, TextInput, Pressable, Platform, KeyboardAvoidingView, ActivityIndicator, Alert, Image } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { useMutation } from "@tanstack/react-query";
import { Colors, Spacing, Typography, BorderRadius } from "@/constants/theme";
import { RootStackParamList } from "@/navigation/types";
import { apiJson, ApiError } from "@/lib/api";

type Nav = NativeStackNavigationProp<RootStackParamList>;

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

const MAX_IMAGES = 2;
// Anthropic's vision API works fine well under its own 1568px-per-side
// recommendation — resizing (and re-compressing to JPEG) here keeps the
// upload small and fast without any visible loss for "what's on this
// screen" type questions.
const MAX_IMAGE_WIDTH = 1280;

interface PickedImage {
  uri: string;
  base64: string;
  mediaType: "image/jpeg";
}

interface Turn {
  role: "user" | "assistant";
  content: string;
  images?: PickedImage[];
}

const GREETING: Turn = {
  role: "assistant",
  content: "Hi! I'm the PullMarket TCG help assistant. Ask me anything about buying, selling, shipping, PullMarket Pro, or how any part of the app works — you can attach up to 2 screenshots or photos too.",
};

export default function HelpChatScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const scrollViewRef = useRef<ScrollView>(null);
  const [turns, setTurns] = useState<Turn[]>([GREETING]);
  const [input, setInput] = useState("");
  const [pendingImages, setPendingImages] = useState<PickedImage[]>([]);
  const [picking, setPicking] = useState(false);

  const scrollToBottom = (animated = true) => scrollViewRef.current?.scrollToEnd({ animated });

  const askMutation = useMutation({
    mutationFn: (nextTurns: Turn[]) =>
      apiJson<{ reply: string }>("POST", "/api/help/chat", {
        messages: nextTurns.map((t) => ({ role: t.role, content: t.content, images: t.images?.map(({ mediaType, base64 }) => ({ mediaType, data: base64 })) })),
      }),
    onSuccess: (data) => {
      setTurns((prev) => [...prev, { role: "assistant", content: data.reply }]);
      setTimeout(() => scrollToBottom(), 50);
    },
    onError: (err) => {
      showAlert("Couldn't reach the help assistant", err instanceof ApiError ? err.message : "Please try again.");
      // Drop the just-added user turn so the failed send doesn't linger as
      // an unanswered message the user can't retry cleanly.
      setTurns((prev) => prev.slice(0, -1));
    },
  });

  const pickImages = async () => {
    const remaining = MAX_IMAGES - pendingImages.length;
    if (remaining <= 0 || picking) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showAlert("Photo access needed", "Allow photo library access to attach an image.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 0.85,
    });
    if (result.canceled || result.assets.length === 0) return;

    setPicking(true);
    try {
      const processed = await Promise.all(
        result.assets.map(async (asset) => {
          const actions = asset.width > MAX_IMAGE_WIDTH ? [{ resize: { width: MAX_IMAGE_WIDTH } }] : [];
          const manipulated = await ImageManipulator.manipulateAsync(asset.uri, actions, { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true });
          return { uri: manipulated.uri, base64: manipulated.base64!, mediaType: "image/jpeg" as const };
        }),
      );
      setPendingImages((prev) => [...prev, ...processed].slice(0, MAX_IMAGES));
    } catch (err) {
      showAlert("Couldn't attach that image", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setPicking(false);
    }
  };

  const removePendingImage = (uri: string) => setPendingImages((prev) => prev.filter((img) => img.uri !== uri));

  const send = () => {
    const text = input.trim();
    if ((!text && pendingImages.length === 0) || askMutation.isPending) return;
    const nextTurns: Turn[] = [...turns, { role: "user", content: text, images: pendingImages.length ? pendingImages : undefined }];
    setTurns(nextTurns);
    setInput("");
    setPendingImages([]);
    setTimeout(() => scrollToBottom(), 50);
    askMutation.mutate(nextTurns);
  };

  const canSend = (!!input.trim() || pendingImages.length > 0) && !askMutation.isPending;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={headerHeight}>
      <ScrollView ref={scrollViewRef} contentContainerStyle={styles.messages} onContentSizeChange={() => scrollToBottom(false)} keyboardShouldPersistTaps="handled">
        {turns.map((t, i) => (
          <View key={i} style={[styles.bubbleRow, t.role === "user" ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
            <View style={[styles.bubble, t.role === "user" ? styles.bubbleMine : styles.bubbleTheirs]}>
              {t.images?.length ? (
                <View style={styles.bubbleImages}>
                  {t.images.map((img, imgIndex) => (
                    <Pressable key={img.uri} onPress={() => navigation.navigate("ImageViewer", { images: t.images!.map((i) => i.uri), startIndex: imgIndex })}>
                      <Image source={{ uri: img.uri }} style={styles.bubbleImage} resizeMode="cover" />
                    </Pressable>
                  ))}
                </View>
              ) : null}
              {t.content ? <Text style={[styles.bubbleText, t.role === "user" && styles.bubbleTextMine]}>{t.content}</Text> : null}
            </View>
          </View>
        ))}
        {askMutation.isPending ? (
          <View style={[styles.bubbleRow, styles.bubbleRowTheirs]}>
            <View style={[styles.bubble, styles.bubbleTheirs, styles.typingBubble]}>
              <ActivityIndicator size="small" color={Colors.textSecondary} />
            </View>
          </View>
        ) : null}
      </ScrollView>

      {pendingImages.length > 0 ? (
        <View style={styles.pendingRow}>
          {pendingImages.map((img) => (
            <View key={img.uri} style={styles.pendingThumbWrap}>
              <Image source={{ uri: img.uri }} style={styles.pendingThumb} resizeMode="cover" />
              <Pressable onPress={() => removePendingImage(img.uri)} style={styles.pendingRemove} hitSlop={6}>
                <Feather name="x" size={12} color={Colors.white} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <View style={[styles.inputBar, { paddingBottom: insets.bottom + Spacing.sm }]}>
        <Pressable
          onPress={pickImages}
          disabled={pendingImages.length >= MAX_IMAGES || picking}
          style={[styles.attachButton, (pendingImages.length >= MAX_IMAGES || picking) && styles.attachButtonDisabled]}
        >
          {picking ? <ActivityIndicator size="small" color={Colors.textSecondary} /> : <Feather name="image" size={19} color={Colors.textSecondary} />}
        </Pressable>
        <TextInput
          style={styles.input}
          placeholder="Ask a question…"
          placeholderTextColor={Colors.textMuted}
          value={input}
          onChangeText={setInput}
          multiline
          onSubmitEditing={send}
        />
        <Pressable onPress={send} disabled={!canSend} style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}>
          <Feather name="arrow-up" size={18} color={Colors.white} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  messages: { padding: Spacing.lg, gap: 4 },
  bubbleRow: { marginVertical: 3, maxWidth: "82%" },
  bubbleRowMine: { alignSelf: "flex-end", alignItems: "flex-end" },
  bubbleRowTheirs: { alignSelf: "flex-start", alignItems: "flex-start" },
  bubble: { borderRadius: BorderRadius.lg, paddingHorizontal: Spacing.md, paddingVertical: 10, gap: 6 },
  // A calmer navy instead of the app's high-energy brand red — this is a
  // support/help context, not a marketplace listing, so the tone here
  // reads as professional and reassuring rather than "buy now" loud.
  bubbleMine: { backgroundColor: Colors.secondary, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderBottomLeftRadius: 4 },
  bubbleText: { ...Typography.body, color: Colors.text },
  bubbleTextMine: { color: Colors.white },
  bubbleImages: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  bubbleImage: { width: 140, height: 140, borderRadius: BorderRadius.md },
  typingBubble: { paddingVertical: 12, paddingHorizontal: 16 },
  pendingRow: { flexDirection: "row", gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, backgroundColor: Colors.background },
  pendingThumbWrap: { position: "relative" },
  pendingThumb: { width: 56, height: 56, borderRadius: BorderRadius.sm, borderWidth: 1, borderColor: Colors.border },
  pendingRemove: { position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: Colors.textMuted, alignItems: "center", justifyContent: "center" },
  inputBar: { flexDirection: "row", alignItems: "flex-end", gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.background },
  attachButton: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", marginBottom: 2 },
  attachButtonDisabled: { opacity: 0.4 },
  input: { flex: 1, maxHeight: 120, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.lg, paddingHorizontal: Spacing.md, paddingVertical: 10, color: Colors.text, ...Typography.body },
  sendButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.secondary, alignItems: "center", justifyContent: "center", marginBottom: 2 },
  sendButtonDisabled: { backgroundColor: Colors.border },
});
