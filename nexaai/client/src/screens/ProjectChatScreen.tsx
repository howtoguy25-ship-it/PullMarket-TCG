import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useRoute, useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { GalaxyBackground } from "../components/GalaxyBackground";
import { BotAvatar } from "../components/BotAvatar";
import { MessageBubble, type ChatMessageVM } from "../components/MessageBubble";
import { ThinkingIndicator } from "../components/ThinkingIndicator";
import { colors, radii, spacing, typography } from "../theme/colors";
import { useTheme } from "../lib/ThemeContext";
import { api, streamChatMessage, ApiError } from "../lib/api";
import { FlatList } from "react-native";

interface ChatSessionVM {
  id: string;
}

/**
 * Real project workspace: same streaming chat mechanics as ChatScreen, but
 * scoped to one Project (server/src/routes/projects.ts) — the model answers
 * in "build_project" mode (real code, one direct answer — see
 * shared/src/nexaPersona.ts's CODE_BUILD_FORMAT) and every session here is
 * tied to this project's real, persisted history.
 */
export function ProjectChatScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { palette } = useTheme();
  const { projectId, projectTitle } = route.params as { projectId: string; projectTitle: string };

  const [sessionId, setSessionId] = useState<string | undefined>();
  const [messages, setMessages] = useState<ChatMessageVM[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const lastMessageAt = useRef(Date.now());

  useEffect(() => {
    navigation.setOptions({ title: projectTitle });
  }, [navigation, projectTitle]);

  useEffect(() => {
    (async () => {
      try {
        const { sessions } = await api<{ sessions: ChatSessionVM[] }>(`/api/projects/${projectId}/sessions`);
        const latest = sessions[0];
        if (latest) {
          setSessionId(latest.id);
          const { messages: history } = await api<{ messages: ChatMessageVM[] }>(`/api/chat/sessions/${latest.id}/messages`);
          setMessages(history);
        }
      } finally {
        setLoadingHistory(false);
      }
    })();
  }, [projectId]);

  const send = useCallback(
    async (text: string) => {
      if (!text.trim() || sending) return;
      const now = Date.now();
      const gapMs = now - lastMessageAt.current;
      lastMessageAt.current = now;

      setMessages((prev) => [...prev, { id: `local-${now}`, role: "user", content: text }]);
      setInput("");
      setSending(true);

      const assistantId = `stream-${now}`;
      let placeholderCreated = false;

      await streamChatMessage(
        { sessionId, projectId: sessionId ? undefined : projectId, text, kind: "text", paceHintMsSinceLastMessage: gapMs },
        {
          onDelta: (delta) => {
            setMessages((prev) => {
              if (!placeholderCreated) {
                placeholderCreated = true;
                setStreamingMessageId(assistantId);
                return [...prev, { id: assistantId, role: "assistant", content: delta }];
              }
              return prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m));
            });
          },
          onDone: (final) => {
            setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...final.message } : m)));
            setStreamingMessageId(null);
            setSessionId(final.sessionId);
            setSending(false);
          },
          onError: () => {
            setSending(false);
            setStreamingMessageId(null);
            setMessages((prev) => [...prev, { id: `err-${now}`, role: "assistant", content: "Something went wrong reaching NexaAi. Try again in a moment." }]);
          },
        },
      );
    },
    [sessionId, sending, projectId],
  );

  return (
    <GalaxyBackground>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <BotAvatar size={32} mood={sending ? "thinking" : "idle"} />
          <Text style={styles.headerTitle}>{projectTitle}</Text>
        </View>

        {loadingHistory ? (
          <ActivityIndicator style={styles.loading} color={palette.accentBright} />
        ) : (
          <FlatList
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <Text style={styles.emptyText}>Describe what you want to build — e.g. "a one-page portfolio site with a contact form".</Text>
            }
            renderItem={({ item }) => <MessageBubble message={item} isStreaming={item.id === streamingMessageId} />}
            ListFooterComponent={sending && !streamingMessageId ? <ThinkingIndicator /> : null}
          />
        )}

        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="Describe what to build or change…"
            placeholderTextColor={colors.textMuted}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={() => send(input)}
            multiline
          />
          <TouchableOpacity style={[styles.sendButton, { backgroundColor: palette.accent }]} onPress={() => send(input)} disabled={sending}>
            <Ionicons name="arrow-up" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </GalaxyBackground>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  headerTitle: { ...typography.h2, color: colors.textPrimary },
  loading: { marginTop: spacing.lg },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.xs },
  emptyText: { ...typography.body, color: colors.textMuted, textAlign: "center", marginTop: spacing.lg, paddingHorizontal: spacing.lg },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, padding: spacing.md },
  input: {
    flex: 1,
    backgroundColor: colors.bgCard,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    color: colors.textPrimary,
    maxHeight: 120,
    ...typography.body,
  },
  sendButton: { width: 40, height: 40, borderRadius: radii.pill, alignItems: "center", justifyContent: "center" },
});
