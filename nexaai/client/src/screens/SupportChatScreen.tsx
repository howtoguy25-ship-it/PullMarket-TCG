import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useFocusEffect, useRoute } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { GalaxyBackground } from "../components/GalaxyBackground";
import { BotAvatar } from "../components/BotAvatar";
import { HelpLinkChip, MarkdownAnswer } from "../components/MessageBubble";
import { radii, spacing, typography } from "../theme/colors";
import { useTheme } from "../lib/ThemeContext";
import type { Palette } from "../theme/palettes";
import { api } from "../lib/api";

interface SupportMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

/**
 * One real thread with a specific support-agent persona
 * (server/src/lib/supportPersonas.ts) — free, not metered against credits.
 * Rendered exactly like the main Chat screen (MessageBubble.tsx): the
 * user's own messages get a real bubble, the agent's replies render as
 * plain flowing markdown text next to the bot avatar — no card, no
 * border, matching Claude/ChatGPT's own layout rather than a two-bubble
 * generic chat-widget look.
 */
export function SupportChatScreen() {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const route = useRoute<any>();
  const conversationId = route.params?.conversationId as string;
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api<{ messages: SupportMessage[] }>(`/api/support/conversations/${conversationId}/messages`)
      .then((r) => setMessages(r.messages))
      .finally(() => setLoading(false));
  }, [conversationId]);

  useFocusEffect(load);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setSending(true);
    const localUserMsg: SupportMessage = { id: `local-${Date.now()}`, role: "user", content: text, createdAt: new Date().toISOString() };
    setMessages((prev) => [...prev, localUserMsg]);
    try {
      const { userMessage, message } = await api<{ userMessage: SupportMessage; message: SupportMessage }>(
        `/api/support/conversations/${conversationId}/messages`,
        { method: "POST", body: JSON.stringify({ text }) },
      );
      setMessages((prev) => [...prev.filter((m) => m.id !== localUserMsg.id), userMessage, message]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: `err-${Date.now()}`, role: "assistant", content: "Something went wrong reaching support. Try again in a moment.", createdAt: new Date().toISOString() },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <GalaxyBackground>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <FlatList
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            !loading ? (
              <View style={styles.empty}>
                <Ionicons name="chatbubbles-outline" size={28} color={palette.textMuted} />
                <Text style={styles.emptyText}>Ask anything — a real support agent will reply.</Text>
              </View>
            ) : null
          }
          renderItem={({ item, index }) => (
            <>
              {index > 0 && item.role === "user" && <View style={[styles.separator, { backgroundColor: palette.border }]} />}
              {item.role === "user" ? (
                <View style={styles.rowUser}>
                  <View style={[styles.bubble, { backgroundColor: palette.accent }]}>
                    <Text style={styles.bubbleTextUser}>{item.content}</Text>
                  </View>
                </View>
              ) : (
                <View style={styles.rowAssistant}>
                  <BotAvatar size={32} mood="happy" />
                  <View style={styles.assistantContent}>
                    <MarkdownAnswer text={item.content} />
                    <HelpLinkChip userText={index > 0 && messages[index - 1]?.role === "user" ? messages[index - 1].content : undefined} />
                  </View>
                </View>
              )}
            </>
          )}
        />
        {sending && (
          <View style={styles.typingRow}>
            <ActivityIndicator size="small" color={palette.accentBright} />
            <Text style={styles.typingText}>Support is replying…</Text>
          </View>
        )}
        <View style={styles.inputRow}>
          <TextInput
            testID="support-chat-input"
            style={styles.input}
            placeholder="Type your question…"
            placeholderTextColor={palette.textMuted}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={send}
            multiline
            blurOnSubmit
          />
          <TouchableOpacity
            testID="support-chat-send"
            style={[styles.sendButton, { backgroundColor: input.trim() ? palette.accent : palette.bgCard }]}
            onPress={send}
            disabled={!input.trim() || sending}
          >
            <Ionicons name="arrow-up" size={20} color={input.trim() ? "#fff" : palette.textMuted} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </GalaxyBackground>
  );
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    flex: { flex: 1 },
    list: { padding: spacing.lg, gap: spacing.sm },
    separator: { height: 2, alignSelf: "stretch", marginVertical: spacing.lg, borderRadius: 1 },
    rowUser: { flexDirection: "row", justifyContent: "flex-end", marginVertical: spacing.sm },
    rowAssistant: { flexDirection: "row", gap: spacing.sm, marginVertical: spacing.sm, alignItems: "flex-start" },
    assistantContent: { flex: 1, paddingTop: 2 },
    bubble: { maxWidth: "82%", borderRadius: radii.lg, borderTopRightRadius: radii.sm, padding: spacing.md },
    bubbleTextUser: { ...typography.body, color: "#fff" },
    typingRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.xs },
    typingText: { ...typography.caption, color: palette.textMuted },
    inputRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md },
    input: {
      flex: 1,
      backgroundColor: palette.bgCard,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: palette.border,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      color: palette.textPrimary,
      ...typography.body,
    },
    sendButton: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
    empty: { alignItems: "center", gap: spacing.md, padding: spacing.xxl },
    emptyText: { ...typography.body, color: palette.textMuted, textAlign: "center" },
  });
}
