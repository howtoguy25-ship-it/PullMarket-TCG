import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Audio } from "expo-av";
import { GalaxyBackground } from "../components/GalaxyBackground";
import { BotAvatar } from "../components/BotAvatar";
import { colors, radii, spacing, typography } from "../theme/colors";
import { useTheme } from "../lib/ThemeContext";
import { API_URL, api, ApiError, getToken } from "../lib/api";

interface VoiceConversation {
  id: string;
  title: string;
  startedAt: string;
  endedAt: string | null;
}

interface VoiceTurn {
  id: string;
  transcript: string;
  replyText: string;
  replyAudioUrl: string | null;
  createdAt: string;
}

// Turn-based phases the "live memo" walks through for every exchange —
// there's no partial/word-by-word live caption here (that needs a real
// streaming STT connection, which the DIY record-then-transcribe pipeline
// doesn't have), but each of these phases is a real, distinct network step,
// not a cosmetic delay.
type CallPhase = "idle" | "recording" | "transcribing" | "thinking" | "speaking";

const PHASE_LABEL: Record<CallPhase, string> = {
  idle: "Tap the mic to talk",
  recording: "Listening…",
  transcribing: "Transcribing what you said…",
  thinking: "Thinking…",
  speaking: "Speaking…",
};

/**
 * Real live voice chat: record -> upload -> server transcribes (Whisper) ->
 * server answers (Gemini speed lane, or your plan's model as a fallback) ->
 * server synthesizes speech (OpenAI TTS) -> plays back here. Every turn is
 * saved as a real "live memo" row (server/src/routes/voice.ts) so past
 * conversations have an actual transcript to look back on.
 */
export function VoiceChatScreen() {
  const { palette } = useTheme();
  const [mode, setMode] = useState<"list" | "call">("list");
  const [conversations, setConversations] = useState<VoiceConversation[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [turns, setTurns] = useState<VoiceTurn[]>([]);
  const [phase, setPhase] = useState<CallPhase>("idle");
  const recordingRef = useRef<Audio.Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

  const loadConversations = async () => {
    setLoadingList(true);
    try {
      const r = await api<{ conversations: VoiceConversation[] }>("/api/voice/conversations");
      setConversations(r.conversations);
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    loadConversations();
    return () => {
      soundRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  const startConversation = async () => {
    try {
      const r = await api<{ conversation: VoiceConversation }>("/api/voice/conversations", { method: "POST" });
      setConversationId(r.conversation.id);
      setTurns([]);
      setMode("call");
    } catch (err) {
      Alert.alert("Couldn't start", err instanceof ApiError ? err.message : "Try again in a moment.");
    }
  };

  const openConversation = async (conversation: VoiceConversation) => {
    setConversationId(conversation.id);
    setMode("call");
    try {
      const r = await api<{ turns: VoiceTurn[] }>(`/api/voice/conversations/${conversation.id}/turns`);
      setTurns(r.turns);
    } catch {
      setTurns([]);
    }
  };

  const endConversation = async () => {
    if (conversationId) {
      await api(`/api/voice/conversations/${conversationId}/end`, { method: "PATCH" }).catch(() => {});
    }
    setConversationId(null);
    setMode("list");
    loadConversations();
  };

  const playReply = (url: string) =>
    new Promise<void>(async (resolve) => {
      try {
        await soundRef.current?.unloadAsync().catch(() => {});
        const { sound } = await Audio.Sound.createAsync({ uri: `${API_URL}${url}` }, { shouldPlay: true });
        soundRef.current = sound;
        sound.setOnPlaybackStatusUpdate((status) => {
          if (status.isLoaded && status.didJustFinish) resolve();
        });
      } catch {
        resolve();
      }
    });

  const startRecording = async () => {
    const { granted } = await Audio.requestPermissionsAsync();
    if (!granted) return;
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
    const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
    recordingRef.current = recording;
    setPhase("recording");
  };

  const stopRecording = async () => {
    const recording = recordingRef.current;
    if (!recording || !conversationId) return;
    await recording.stopAndUnloadAsync();
    const uri = recording.getURI();
    recordingRef.current = null;
    if (!uri) {
      setPhase("idle");
      return;
    }

    setPhase("transcribing");
    try {
      const token = await getToken();
      const form = new FormData();
      form.append("audio", { uri, name: "turn.m4a", type: "audio/m4a" } as unknown as Blob);
      setPhase("thinking"); // the request covers transcribe+reason+speak in one round trip

      const response = await fetch(`${API_URL}/api/voice/conversations/${conversationId}/turns`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: form,
      });
      const isJson = response.headers.get("content-type")?.includes("application/json");
      const body = isJson ? await response.json() : null;
      if (!response.ok) throw new ApiError(response.status, body);

      const turn = (body as { turn: VoiceTurn }).turn;
      setTurns((prev) => [...prev, turn]);

      if (turn.replyAudioUrl) {
        setPhase("speaking");
        await playReply(turn.replyAudioUrl);
      }
      setPhase("idle");
    } catch (err) {
      setPhase("idle");
      Alert.alert("Couldn't complete that turn", err instanceof ApiError ? err.message : "Something went wrong — try again.");
    }
  };

  if (mode === "list") {
    return (
      <GalaxyBackground>
        <View style={styles.header}>
          <Text style={styles.title}>Voice chat</Text>
          <Text style={styles.subtitle}>Talk to NexaAi out loud — a real recorded, transcribed, spoken-back conversation, saved as a live memo.</Text>
        </View>
        <TouchableOpacity style={[styles.startButton, { backgroundColor: palette.accent }]} onPress={startConversation}>
          <Ionicons name="mic" size={18} color="#fff" />
          <Text style={styles.startButtonText}>Start voice chat</Text>
        </TouchableOpacity>
        {loadingList ? (
          <ActivityIndicator style={styles.listLoading} color={palette.accentBright} />
        ) : (
          <FlatList
            data={conversations}
            keyExtractor={(c) => c.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={<Text style={styles.emptyText}>No voice conversations yet.</Text>}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.convoRow} onPress={() => openConversation(item)}>
                <Ionicons name="call" size={18} color={palette.accentBright} />
                <View style={styles.convoText}>
                  <Text style={styles.convoTitle}>{item.title}</Text>
                  <Text style={styles.convoMeta}>{new Date(item.startedAt).toLocaleString()}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          />
        )}
      </GalaxyBackground>
    );
  }

  return (
    <GalaxyBackground>
      <View style={styles.callHeader}>
        <TouchableOpacity onPress={endConversation}>
          <Ionicons name="chevron-back" size={22} color={palette.accentBright} />
        </TouchableOpacity>
        <BotAvatar size={32} mood={phase === "idle" ? "idle" : phase === "speaking" ? "talking" : "thinking"} />
        <Text style={styles.callHeaderText}>{PHASE_LABEL[phase]}</Text>
        <TouchableOpacity onPress={endConversation}>
          <Text style={[styles.endText, { color: palette.accentBright }]}>End</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={turns}
        keyExtractor={(t) => t.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={styles.turnCard}>
            <Text style={styles.turnYou}>You said: "{item.transcript}"</Text>
            <Text style={styles.turnReply}>{item.replyText}</Text>
            {!item.replyAudioUrl && <Text style={styles.noAudioNote}>(text-to-speech not configured — reply text only)</Text>}
          </View>
        )}
        ListEmptyComponent={<Text style={styles.emptyText}>Tap the mic and say something to start.</Text>}
      />

      <View style={styles.micRow}>
        <TouchableOpacity
          style={[styles.micButton, { backgroundColor: phase === "recording" ? colors.danger : palette.accent }]}
          onPress={phase === "recording" ? stopRecording : phase === "idle" ? startRecording : undefined}
          disabled={phase !== "idle" && phase !== "recording"}
        >
          {phase === "transcribing" || phase === "thinking" ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Ionicons name={phase === "recording" ? "stop" : "mic"} size={28} color="#fff" />
          )}
        </TouchableOpacity>
      </View>
    </GalaxyBackground>
  );
}

const styles = StyleSheet.create({
  header: { padding: spacing.lg, gap: spacing.xs },
  title: { ...typography.h1, color: colors.textPrimary },
  subtitle: { ...typography.body, color: colors.textSecondary },
  startButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    borderRadius: radii.pill,
    paddingVertical: spacing.md,
  },
  startButtonText: { color: "#fff", fontWeight: "700" },
  listLoading: { marginTop: spacing.lg },
  list: { padding: spacing.lg, gap: spacing.sm },
  emptyText: { ...typography.body, color: colors.textMuted, textAlign: "center", marginTop: spacing.lg },
  convoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.bgCard,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  convoText: { flex: 1, gap: 2 },
  convoTitle: { ...typography.bodyBold, color: colors.textPrimary },
  convoMeta: { ...typography.caption, color: colors.textMuted },
  callHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.lg,
    justifyContent: "space-between",
  },
  callHeaderText: { ...typography.body, color: colors.textSecondary, flex: 1, textAlign: "center", fontStyle: "italic" },
  endText: { fontWeight: "700" },
  turnCard: { backgroundColor: colors.bgCard, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.xs },
  turnYou: { ...typography.caption, color: colors.textMuted, fontStyle: "italic" },
  turnReply: { ...typography.body, color: colors.textPrimary },
  noAudioNote: { ...typography.caption, color: colors.warning },
  micRow: { alignItems: "center", paddingVertical: spacing.lg },
  micButton: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center" },
});
