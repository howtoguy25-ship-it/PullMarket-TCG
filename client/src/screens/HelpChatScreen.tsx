import React, { useRef, useState } from "react";
import { View, StyleSheet, Text, ScrollView, TextInput, Pressable, Platform, KeyboardAvoidingView, ActivityIndicator, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { Feather } from "@expo/vector-icons";
import { useMutation } from "@tanstack/react-query";
import { Colors, Spacing, Typography, BorderRadius } from "@/constants/theme";
import { apiJson, ApiError } from "@/lib/api";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

interface Turn {
  role: "user" | "assistant";
  content: string;
}

const GREETING: Turn = {
  role: "assistant",
  content: "Hi! I'm the PullMarket TCG help assistant. Ask me anything about buying, selling, shipping, PullMarket Pro, or how any part of the app works.",
};

export default function HelpChatScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const scrollViewRef = useRef<ScrollView>(null);
  const [turns, setTurns] = useState<Turn[]>([GREETING]);
  const [input, setInput] = useState("");

  const scrollToBottom = (animated = true) => scrollViewRef.current?.scrollToEnd({ animated });

  const askMutation = useMutation({
    mutationFn: (nextTurns: Turn[]) => apiJson<{ reply: string }>("POST", "/api/help/chat", { messages: nextTurns }),
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

  const send = () => {
    const text = input.trim();
    if (!text || askMutation.isPending) return;
    const nextTurns: Turn[] = [...turns, { role: "user", content: text }];
    setTurns(nextTurns);
    setInput("");
    setTimeout(() => scrollToBottom(), 50);
    askMutation.mutate(nextTurns);
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={headerHeight}>
      <ScrollView ref={scrollViewRef} contentContainerStyle={styles.messages} onContentSizeChange={() => scrollToBottom(false)} keyboardShouldPersistTaps="handled">
        {turns.map((t, i) => (
          <View key={i} style={[styles.bubbleRow, t.role === "user" ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
            <View style={[styles.bubble, t.role === "user" ? styles.bubbleMine : styles.bubbleTheirs]}>
              <Text style={[styles.bubbleText, t.role === "user" && styles.bubbleTextMine]}>{t.content}</Text>
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

      <View style={[styles.inputBar, { paddingBottom: insets.bottom + Spacing.sm }]}>
        <TextInput
          style={styles.input}
          placeholder="Ask a question…"
          placeholderTextColor={Colors.textMuted}
          value={input}
          onChangeText={setInput}
          multiline
          onSubmitEditing={send}
        />
        <Pressable onPress={send} disabled={!input.trim() || askMutation.isPending} style={[styles.sendButton, (!input.trim() || askMutation.isPending) && styles.sendButtonDisabled]}>
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
  bubble: { borderRadius: BorderRadius.lg, paddingHorizontal: Spacing.md, paddingVertical: 10 },
  bubbleMine: { backgroundColor: Colors.primary, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderBottomLeftRadius: 4 },
  bubbleText: { ...Typography.body, color: Colors.text },
  bubbleTextMine: { color: Colors.white },
  typingBubble: { paddingVertical: 12, paddingHorizontal: 16 },
  inputBar: { flexDirection: "row", alignItems: "flex-end", gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.background },
  input: { flex: 1, maxHeight: 120, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.lg, paddingHorizontal: Spacing.md, paddingVertical: 10, color: Colors.text, ...Typography.body },
  sendButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.primary, alignItems: "center", justifyContent: "center", marginBottom: 2 },
  sendButtonDisabled: { backgroundColor: Colors.border },
});
