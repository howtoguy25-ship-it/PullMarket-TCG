import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { useNavigation } from "@react-navigation/native";
import { Audio } from "expo-av";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { GalaxyBackground } from "../components/GalaxyBackground";
import { BotAvatar } from "../components/BotAvatar";
import { MessageBubble, type ChatMessageVM } from "../components/MessageBubble";
import { ThinkingIndicator } from "../components/ThinkingIndicator";
import { AnswerModeToggle, type AnswerMode } from "../components/AnswerModeToggle";
import { FocusModeSelector, type FocusMode } from "../components/FocusModeSelector";
import { UsageBanner } from "../components/UsageBanner";
import { ChatSideMenu, type ChatSessionSummary } from "../components/ChatSideMenu";
import { radii, spacing, typography } from "../theme/colors";
import { useTheme } from "../lib/ThemeContext";
import type { Palette } from "../theme/palettes";
import { api, streamChatMessage, ApiError } from "../lib/api";
import { uploadAttachment, type UploadedAttachment } from "../lib/attachments";
import { useAuth } from "../lib/AuthContext";
import { speak, transcribeVoiceMemo } from "../lib/voice";

type ChatKind = "text" | "voice_memo" | "file_attachment" | "who_is_lookup";

type BotMood = "idle" | "thinking" | "talking";

const WHO_IS_THINKING_PHRASES = ["Searching the web…", "Checking sources…", "Confirming accounts…", "Laying out the profile…"];

export function ChatScreen() {
  const { user, refreshUser } = useAuth();
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const navigation = useNavigation<any>();
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [messages, setMessages] = useState<ChatMessageVM[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [botMood, setBotMood] = useState<BotMood>("idle");
  const [limitBanner, setLimitBanner] = useState<{ message: string; resetAt: string } | null>(null);
  const [answerMode, setAnswerMode] = useState<AnswerMode>(user?.answerMode ?? "normal");
  const [focusMode, setFocusMode] = useState<FocusMode>(user?.defaultFocusMode ?? "quick");
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [uploading, setUploading] = useState(false);
  const [whoIsMode, setWhoIsMode] = useState(false);
  const [pendingKind, setPendingKind] = useState<ChatKind>("text");
  const [sideMenuOpen, setSideMenuOpen] = useState(false);
  const [loadingSession, setLoadingSession] = useState(false);
  const lastMessageAt = useRef(Date.now());

  const startNewChat = () => {
    setSessionId(undefined);
    setMessages([]);
    setStreamingMessageId(null);
    setInput("");
    setWhoIsMode(false);
    setLimitBanner(null);
  };

  const openSession = async (session: ChatSessionSummary) => {
    setLoadingSession(true);
    setStreamingMessageId(null);
    setWhoIsMode(false);
    setLimitBanner(null);
    try {
      const { messages: history } = await api<{ messages: ChatMessageVM[] }>(`/api/chat/sessions/${session.id}/messages`);
      setSessionId(session.id);
      setMessages(history);
    } finally {
      setLoadingSession(false);
    }
  };

  const changeAnswerMode = async (mode: AnswerMode) => {
    setAnswerMode(mode);
    await api("/api/chat/answer-mode", { method: "PATCH", body: JSON.stringify({ mode }) });
  };

  const changeFocusMode = async (mode: FocusMode) => {
    setFocusMode(mode);
    await api("/api/auth/settings", { method: "PATCH", body: JSON.stringify({ defaultFocusMode: mode }) });
  };

  const send = useCallback(
    async (text: string, kind: ChatKind = "text", attachment?: UploadedAttachment) => {
      if (!text.trim() || sending) return;
      const now = Date.now();
      const gapMs = now - lastMessageAt.current;
      lastMessageAt.current = now;

      const userMsg: ChatMessageVM = { id: `local-${now}`, role: "user", content: text, attachment };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setSending(true);
      setPendingKind(kind);
      setWhoIsMode(false);
      setBotMood("thinking");
      setLimitBanner(null);

      const finishWithMessage = (final: { sessionId: string; message: ChatMessageVM }) => {
        setSessionId(final.sessionId);
        setSending(false);
        setBotMood("idle");
        refreshUser();
        if (user?.capabilities.autoSpeak ?? true) {
          speak(final.message.content.replace(/[*_[\]]/g, ""), user?.voiceCharacterId ?? "nova-neutral", {
            onStart: () => setBotMood("talking"),
            onDone: () => setBotMood("idle"),
            onStopped: () => setBotMood("idle"),
            onError: () => setBotMood("idle"),
          });
        }
      };

      const handleFailure = (message: string, status?: number, errorBody?: any) => {
        setSending(false);
        setBotMood("idle");
        setStreamingMessageId(null);
        if (status === 429 || status === 402) {
          setLimitBanner({ message, resetAt: errorBody?.resetAt ?? new Date().toISOString() });
        } else if (status === 403 && errorBody?.error === "focus_mode_not_allowed") {
          setFocusMode("quick");
          Alert.alert("Locked focus mode", message);
        } else {
          setMessages((prev) => [
            ...prev,
            { id: `err-${now}`, role: "assistant", content: "Something went wrong reaching NexaAi. Try again in a moment." },
          ]);
        }
      };

      // Live typing is a real, toggleable capability (Settings -> Capabilities):
      // off means a plain request/response instead of the SSE stream.
      if (!(user?.capabilities.liveTyping ?? true)) {
        try {
          const final = await api<{ sessionId: string; message: ChatMessageVM }>("/api/chat/messages", {
            method: "POST",
            body: JSON.stringify({ sessionId, text, kind, paceHintMsSinceLastMessage: gapMs, requestedFocusMode: focusMode, attachment }),
          });
          setMessages((prev) => [...prev, final.message]);
          finishWithMessage(final);
        } catch (err) {
          if (err instanceof ApiError) handleFailure(err.message, err.status, err.body);
          else handleFailure("Something went wrong reaching NexaAi. Try again in a moment.");
        }
        return;
      }

      const assistantId = `stream-${now}`;
      let placeholderCreated = false;

      await streamChatMessage(
        { sessionId, text, kind, paceHintMsSinceLastMessage: gapMs, requestedFocusMode: focusMode, attachment },
        {
          onDelta: (delta) => {
            setBotMood("talking");
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
            finishWithMessage(final);
          },
          onError: handleFailure,
        },
      );
    },
    [sessionId, sending, user, refreshUser, focusMode],
  );

  const handlePickedFile = async (uri: string, filename: string, mimeType: string) => {
    setUploading(true);
    try {
      const uploaded = await uploadAttachment(uri, filename, mimeType);
      const caption = input.trim() || filename;
      setInput("");
      await send(caption, "file_attachment", uploaded);
    } catch (err) {
      Alert.alert("Upload failed", err instanceof ApiError ? err.message : "Couldn't upload that file. Try again.");
    } finally {
      setUploading(false);
    }
  };

  const pickAttachmentMedia = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.All, quality: 0.8 });
    const asset = result.assets?.[0];
    if (result.canceled || !asset) return;
    const fallbackMime = asset.type === "video" ? "video/mp4" : "image/jpeg";
    await handlePickedFile(asset.uri, asset.fileName ?? `attachment-${Date.now()}`, asset.mimeType ?? fallbackMime);
  };

  const pickAttachmentDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
    const asset = result.assets?.[0];
    if (result.canceled || !asset) return;
    await handlePickedFile(asset.uri, asset.name, asset.mimeType ?? "application/octet-stream");
  };

  const openAttachmentMenu = () => {
    Alert.alert("Attach", "Add a photo, video, or file to this message.", [
      { text: "Photo or video", onPress: pickAttachmentMedia },
      { text: "File", onPress: pickAttachmentDocument },
      { text: "Cancel", style: "cancel" },
    ]);
  };

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
    } catch (err) {
      const detail = err instanceof ApiError ? err.message : "Couldn't reach the transcription service — check your connection and try again.";
      setMessages((prev) => [
        ...prev,
        { id: `stt-note-${Date.now()}`, role: "assistant", content: `_Voice memo recorded._\n\n**Couldn't transcribe it**\n${detail}` },
      ]);
    }
  };

  return (
    <GalaxyBackground>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <TouchableOpacity testID="chat-side-menu-button" onPress={() => setSideMenuOpen(true)}>
            <Ionicons name="menu" size={24} color={palette.textPrimary} />
          </TouchableOpacity>
          <BotAvatar size={36} mood={botMood} />
          <View style={styles.headerText}>
            <Text style={styles.headerTitle}>NexaAi</Text>
            {botMood !== "idle" && (
              <Text style={[styles.headerStatus, { color: palette.accentBright }]}>{botMood === "thinking" ? "thinking…" : "speaking…"}</Text>
            )}
          </View>
        </View>

        <ChatSideMenu
          visible={sideMenuOpen}
          onClose={() => setSideMenuOpen(false)}
          activeSessionId={sessionId}
          onNewChat={startNewChat}
          onSelectSession={openSession}
        />

        {loadingSession && (
          <View style={styles.sessionLoadingOverlay}>
            <ActivityIndicator color={palette.accentBright} />
          </View>
        )}

        <View style={styles.toolbar}>
          <AnswerModeToggle value={answerMode} onChange={changeAnswerMode} />
          <FocusModeSelector
            value={focusMode}
            onChange={changeFocusMode}
            planTier={user?.planTier ?? "beginner"}
            onNavigateToPlans={() => navigation.navigate("Plans")}
          />
        </View>

        {limitBanner && <UsageBanner message={limitBanner.message} resetAtIso={limitBanner.resetAt} />}

        <FlatList
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          renderItem={({ item, index }) => (
            <MessageBubble
              message={item}
              isStreaming={item.id === streamingMessageId}
              avatarMood={item.id === streamingMessageId ? "talking" : "happy"}
              showSeparatorAbove={index > 0 && item.role === "user"}
            />
          )}
          ListFooterComponent={
            sending && !streamingMessageId ? <ThinkingIndicator phrases={pendingKind === "who_is_lookup" ? WHO_IS_THINKING_PHRASES : undefined} /> : null
          }
        />

        {whoIsMode && (
          <View style={styles.whoIsBanner}>
            <Ionicons name="person-circle" size={14} color={palette.accentBright} />
            <Text style={styles.whoIsBannerText}>Who-is deep dive — type a public figure's name, then send. Public figures only.</Text>
          </View>
        )}

        <View style={styles.inputRow}>
          <TouchableOpacity testID="chat-attach-button" style={styles.iconButton} onPress={openAttachmentMenu} disabled={uploading}>
            {uploading ? <ActivityIndicator size="small" color={palette.accentBright} /> : <Ionicons name="attach" size={20} color={palette.accentBright} />}
          </TouchableOpacity>
          <TouchableOpacity
            testID="chat-mic-button"
            style={[styles.iconButton, recording && styles.iconButtonActive]}
            onPress={recording ? stopRecording : startRecording}
          >
            <Ionicons name={recording ? "stop" : "mic"} size={20} color={recording ? "#fff" : palette.accentBright} />
          </TouchableOpacity>
          <TouchableOpacity testID="chat-whois-toggle" style={[styles.iconButton, whoIsMode && styles.iconButtonActive]} onPress={() => setWhoIsMode((v) => !v)}>
            <Ionicons name="person-circle-outline" size={20} color={whoIsMode ? "#fff" : palette.accentBright} />
          </TouchableOpacity>
          <TextInput
            testID="chat-input"
            style={styles.input}
            placeholder={whoIsMode ? "Who do you want to look up?" : "Ask NexaAi anything…"}
            placeholderTextColor={palette.textMuted}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={() => send(input, whoIsMode ? "who_is_lookup" : "text")}
          />
          <TouchableOpacity
            testID="chat-send-button"
            style={[styles.sendButton, { backgroundColor: palette.accent }]}
            onPress={() => send(input, whoIsMode ? "who_is_lookup" : "text")}
            disabled={sending}
          >
            <Ionicons name="arrow-up" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </GalaxyBackground>
  );
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    flex: { flex: 1 },
    sessionLoadingOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(5,4,15,0.55)" },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
    },
    headerText: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm },
    headerTitle: { ...typography.h2, color: palette.textPrimary },
    headerStatus: { ...typography.caption, fontStyle: "italic" },
    toolbar: { padding: spacing.md, alignItems: "flex-start", gap: spacing.sm },
    list: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
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
    iconButton: {
      width: 40,
      height: 40,
      borderRadius: radii.pill,
      backgroundColor: palette.bgCard,
      borderWidth: 1,
      borderColor: palette.border,
      alignItems: "center",
      justifyContent: "center",
    },
    iconButtonActive: { backgroundColor: palette.danger, borderColor: palette.danger },
    whoIsBanner: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.md, paddingBottom: spacing.xs },
    whoIsBannerText: { ...typography.caption, color: palette.textMuted },
    sendButton: {
      width: 40,
      height: 40,
      borderRadius: radii.pill,
      alignItems: "center",
      justifyContent: "center",
    },
  });
}
