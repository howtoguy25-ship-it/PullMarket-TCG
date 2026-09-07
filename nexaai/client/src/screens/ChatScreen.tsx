import React, { useCallback, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Audio } from "expo-av";
import { GalaxyBackground } from "../components/GalaxyBackground";
import { MessageBubble, type ChatMessageVM } from "../components/MessageBubble";
import { ThinkingIndicator } from "../components/ThinkingIndicator";
import { AnswerModeToggle, type AnswerMode } from "../components/AnswerModeToggle";
import { UsageBanner } from "../components/UsageBanner";
import { colors, radii, spacing, typography } from "../theme/colors";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { speak, transcribeVoiceMemo } from "../lib/voice";

export function ChatScreen() {
  const { user, refreshUser } = useAuth();
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [messages, setMessages] = useState<ChatMessageVM[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [limitBanner, setLimitBanner] = useState<{ message: string; resetAt: string } | null>(null);
  const [answerMode, setAnswerMode] = useState<AnswerMode>(user?.answerMode ?? "normal");
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const lastMessageAt = useRef(Date.now());

  const changeAnswerMode = async (mode: AnswerMode) => {
    setAnswerMode(mode);
    await api("/api/chat/answer-mode", { method: "PATCH", body: JSON.stringify({ mode }) });
  };

  const send = useCallback(
    async (text: string, kind: "text" | "voice_memo" = "text") => {
      if (!text.trim() || sending) return;
      const now = Date.now();
      const gapMs = now - lastMessageAt.current;
      lastMessageAt.current = now;

      const userMsg: ChatMessageVM = { id: `local-${now}`, role: "user", content: text };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setSending(true);
      setLimitBanner(null);

      try {
        const result = await api<{ sessionId: string; message: ChatMessageVM }>("/api/chat/messages", {
          method: "POST",
          body: JSON.stringify({ sessionId, text, kind, paceHintMsSinceLastMessage: gapMs }),
        });
        setSessionId(result.sessionId);
        setMessages((prev) => [...prev, result.message]);
        speak(result.message.content.replace(/[*_[\]]/g, ""), user?.voiceCharacterId ?? "nova-neutral");
        refreshUser();
      } catch (err) {
        if (err instanceof ApiError && err.status === 429) {
          setLimitBanner({ message: err.body.message, resetAt: err.body.resetAt });
        } else if (err instanceof ApiError && err.status === 402) {
          setLimitBanner({ message: err.message, resetAt: new Date().toISOString() });
        } else {
          setMessages((prev) => [...prev, { id: `err-${now}`, role: "assistant", content: "Something went wrong reaching NexaAi. Try again in a moment." }]);
        }
      } finally {
        setSending(false);
      }
    },
    [sessionId, sending, user, refreshUser],
  );

  const startRecording = async () => {
    const { granted } = await Audio.requestPermissionsAsync();
    if (!granted) return;
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
    const { recording: rec } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
    setRecording(rec);
  };

  const stopRecording = async () => {
    if (!recording) return;
    await recording.stopAndUnloadAsync();
    const uri = recording.getURI();
    setRecording(null);
    if (!uri) return;
    try {
      const transcript = await transcribeVoiceMemo(uri);
      setInput(transcript); // pre-filled so the user can edit before sending, per spec
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `stt-note-${Date.now()}`,
          role: "assistant",
          content:
            "_Voice memo recorded._\n\n**Transcription isn't wired up yet**\nOn-device speech-to-text needs a native build " +
            "(see client/src/lib/voice.ts). Type out what you said below and edit it before sending.",
        },
      ]);
    }
  };

  return (
    <GalaxyBackground>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.toolbar}>
          <AnswerModeToggle value={answerMode} onChange={changeAnswerMode} />
        </View>

        {limitBanner && <UsageBanner message={limitBanner.message} resetAtIso={limitBanner.resetAt} />}

        <FlatList
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => <MessageBubble message={item} />}
          ListFooterComponent={sending ? <ThinkingIndicator /> : null}
        />

        <View style={styles.inputRow}>
          <TouchableOpacity
            style={[styles.iconButton, recording && styles.iconButtonActive]}
            onPress={recording ? stopRecording : startRecording}
          >
            <Ionicons name={recording ? "stop" : "mic"} size={20} color={recording ? "#fff" : colors.accentBright} />
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            placeholder="Ask NexaAi anything…"
            placeholderTextColor={colors.textMuted}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={() => send(input)}
          />
          <TouchableOpacity style={styles.sendButton} onPress={() => send(input)} disabled={sending}>
            <Ionicons name="arrow-up" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </GalaxyBackground>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  toolbar: { padding: spacing.md, alignItems: "flex-start" },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  inputRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md },
  input: {
    flex: 1,
    backgroundColor: colors.bgCard,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    color: colors.textPrimary,
    ...typography.body,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonActive: { backgroundColor: colors.danger, borderColor: colors.danger },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
});
