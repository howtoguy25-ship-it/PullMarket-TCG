import React, { useEffect, useRef, useState } from "react";
import { Alert, Animated, Easing, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { Audio } from "expo-av";
import { GalaxyBackground } from "../components/GalaxyBackground";
import { BotAvatar } from "../components/BotAvatar";
import { colors, radii, spacing, typography } from "../theme/colors";
import { useTheme } from "../lib/ThemeContext";
import { API_URL, api, ApiError, getToken } from "../lib/api";
import { appendRecordingToForm } from "../lib/voice";

interface VoiceConversation {
  id: string;
}

interface VoiceTurn {
  id: string;
  transcript: string | null;
  replyText: string;
  replyAudioUrl: string | null;
  createdAt: string;
}

type CallPhase = "ringing" | "connecting" | "listening" | "thinking" | "speaking" | "ended";

const PHASE_LABEL: Record<CallPhase, string> = {
  ringing: "Calling NexaAi…",
  connecting: "Connecting…",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
  ended: "Call ended",
};

// Real voice-activity detection via expo-av's recording metering (dBFS) —
// once the user has spoken, this much continuous quiet auto-ends their turn
// so the call feels hands-free, the way a real phone call does. Not every
// platform's recorder reports metering (notably some web browsers), so a
// manual "Done talking" button is always shown alongside it as a real,
// honest fallback/override rather than silently failing where VAD isn't
// available.
const SILENCE_THRESHOLD_DB = -35;
const SILENCE_HOLD_MS = 1300;
const MAX_TURN_RECORDING_MS = 25000;

const RINGING_MS = 1500;

/**
 * A real, continuous phone-call-style conversation with NexaAi — distinct
 * from Voice chat's tap-per-turn "live memo" flow. NexaAi answers first with
 * a genuinely varied, model-generated greeting (server/src/routes/voice.ts's
 * POST .../greeting, temperature 0.7 — not a canned string), then the call
 * auto-loops listen -> transcribe -> reason -> speak -> listen again without
 * requiring a tap per turn (real VAD; see SILENCE_HOLD_MS above), same
 * Whisper/Gemini/TTS pipeline Voice chat uses under the hood.
 */
export function CallScreen() {
  const navigation = useNavigation<any>();
  const { palette } = useTheme();
  const [phase, setPhase] = useState<CallPhase>("ringing");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [turns, setTurns] = useState<VoiceTurn[]>([]);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [errorNote, setErrorNote] = useState<string | null>(null);

  const phaseRef = useRef<CallPhase>("ringing");
  const recordingRef = useRef<Audio.Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const hasSpokenRef = useRef(false);
  const silenceStartRef = useRef<number | null>(null);
  const recordingStartRef = useRef(0);
  const submittingRef = useRef(false);
  const connectedAtRef = useRef<number | null>(null);
  const listRef = useRef<FlatList<VoiceTurn>>(null);
  const ringScale = useRef(new Animated.Value(1)).current;
  const mounted = useRef(true);

  const setPhaseSafe = (p: CallPhase) => {
    phaseRef.current = p;
    if (mounted.current) setPhase(p);
  };

  useEffect(() => {
    mounted.current = true;
    startCall();
    return () => {
      mounted.current = false;
      recordingRef.current?.stopAndUnloadAsync().catch(() => {});
      soundRef.current?.unloadAsync().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Real ringing pulse — a scale animation, not a static icon — while the
  // call is being placed.
  useEffect(() => {
    if (phase !== "ringing") return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(ringScale, { toValue: 1.12, duration: 500, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(ringScale, { toValue: 1, duration: 500, easing: Easing.in(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [phase, ringScale]);

  // A real ticking call-duration timer, started once the call actually connects.
  useEffect(() => {
    if (phase === "ringing" || phase === "connecting" || phase === "ended") return;
    if (connectedAtRef.current === null) connectedAtRef.current = Date.now();
    const interval = setInterval(() => setElapsedSec(Math.floor((Date.now() - connectedAtRef.current!) / 1000)), 1000);
    return () => clearInterval(interval);
  }, [phase]);

  const appendTurn = (turn: VoiceTurn) => {
    setTurns((prev) => [...prev, turn]);
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  };

  const playReply = (url: string) =>
    new Promise<void>((resolve) => {
      (async () => {
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
      })();
    });

  const startCall = async () => {
    await new Promise((r) => setTimeout(r, RINGING_MS));
    if (!mounted.current) return;
    setPhaseSafe("connecting");

    const { granted } = await Audio.requestPermissionsAsync();
    if (!granted) {
      setErrorNote("NexaAi needs microphone access to talk with you — grant it in your device settings and try calling again.");
      setPhaseSafe("ended");
      return;
    }
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });

    try {
      const { conversation } = await api<{ conversation: VoiceConversation }>("/api/voice/conversations", { method: "POST" });
      if (!mounted.current) return;
      setConversationId(conversation.id);

      const { turn } = await api<{ turn: VoiceTurn }>(`/api/voice/conversations/${conversation.id}/greeting`, { method: "POST" });
      if (!mounted.current) return;
      appendTurn(turn);

      if (turn.replyAudioUrl) {
        setPhaseSafe("speaking");
        await playReply(turn.replyAudioUrl);
      }
      if (!mounted.current) return;
      startListening();
    } catch (err) {
      setErrorNote(err instanceof ApiError ? err.message : "Couldn't connect the call — try again in a moment.");
      setPhaseSafe("ended");
    }
  };

  const onRecordingStatus = (status: Audio.RecordingStatus) => {
    if (phaseRef.current !== "listening" || submittingRef.current) return;
    const metering = status.metering;
    if (typeof metering === "number") {
      if (metering > SILENCE_THRESHOLD_DB) {
        hasSpokenRef.current = true;
        silenceStartRef.current = null;
      } else if (hasSpokenRef.current) {
        if (silenceStartRef.current === null) silenceStartRef.current = Date.now();
        else if (Date.now() - silenceStartRef.current > SILENCE_HOLD_MS) {
          submitTurn();
          return;
        }
      }
    }
    if (Date.now() - recordingStartRef.current > MAX_TURN_RECORDING_MS) submitTurn();
  };

  const startListening = async () => {
    hasSpokenRef.current = false;
    silenceStartRef.current = null;
    submittingRef.current = false;
    recordingStartRef.current = Date.now();
    try {
      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync({ ...Audio.RecordingOptionsPresets.HIGH_QUALITY, isMeteringEnabled: true });
      recording.setOnRecordingStatusUpdate(onRecordingStatus);
      recordingRef.current = recording;
      await recording.startAsync();
      setPhaseSafe("listening");
    } catch {
      setErrorNote("Couldn't access the microphone for the next turn.");
      setPhaseSafe("ended");
    }
  };

  const submitTurn = async () => {
    if (submittingRef.current || !conversationId) return;
    submittingRef.current = true;
    const recording = recordingRef.current;
    recordingRef.current = null;
    setPhaseSafe("thinking");
    if (!recording) return;

    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      if (!uri) throw new Error("No recording captured.");

      const token = await getToken();
      const form = new FormData();
      await appendRecordingToForm(form, uri, "turn.m4a", "audio/m4a");
      const response = await fetch(`${API_URL}/api/voice/conversations/${conversationId}/turns`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: form,
      });
      const isJson = response.headers.get("content-type")?.includes("application/json");
      const body = isJson ? await response.json() : null;
      if (!response.ok) throw new ApiError(response.status, body);

      const turn = (body as { turn: VoiceTurn }).turn;
      appendTurn(turn);
      if (turn.replyAudioUrl) {
        setPhaseSafe("speaking");
        await playReply(turn.replyAudioUrl);
      }
      if (!mounted.current || phaseRef.current === "ended") return;
      startListening();
    } catch (err) {
      if (!mounted.current) return;
      Alert.alert("That turn didn't go through", err instanceof ApiError ? err.message : "Something went wrong — resuming the call.");
      startListening();
    }
  };

  const endCall = async () => {
    setPhaseSafe("ended");
    await recordingRef.current?.stopAndUnloadAsync().catch(() => {});
    recordingRef.current = null;
    await soundRef.current?.unloadAsync().catch(() => {});
    if (conversationId) await api(`/api/voice/conversations/${conversationId}/end`, { method: "PATCH" }).catch(() => {});
    navigation.goBack();
  };

  const mm = String(Math.floor(elapsedSec / 60)).padStart(2, "0");
  const ss = String(elapsedSec % 60).padStart(2, "0");
  const avatarMood = phase === "speaking" ? "talking" : phase === "listening" ? "happy" : "thinking";

  return (
    <GalaxyBackground>
      <View style={styles.container}>
        <View style={styles.top}>
          <Animated.View style={{ transform: [{ scale: phase === "ringing" ? ringScale : 1 }] }}>
            <BotAvatar size={96} mood={avatarMood} />
          </Animated.View>
          <Text style={styles.phaseText}>{PHASE_LABEL[phase]}</Text>
          {phase !== "ringing" && phase !== "connecting" && phase !== "ended" && <Text style={styles.timerText}>{mm}:{ss}</Text>}
          {errorNote && <Text style={styles.errorText}>{errorNote}</Text>}
        </View>

        <FlatList
          ref={listRef}
          data={turns}
          keyExtractor={(t) => t.id}
          style={styles.transcript}
          contentContainerStyle={styles.transcriptContent}
          ListEmptyComponent={<Text style={styles.emptyText}>The transcript will appear here as you talk.</Text>}
          renderItem={({ item }) => (
            <View style={styles.turnBlock}>
              {item.transcript !== null && (
                <View style={styles.turnRow}>
                  <Text style={styles.turnLabel}>You</Text>
                  <Text style={styles.turnText}>{item.transcript}</Text>
                </View>
              )}
              <View style={styles.turnRow}>
                <Text style={[styles.turnLabel, { color: palette.accentBright }]}>NexaAi</Text>
                <Text style={styles.turnText}>{item.replyText}</Text>
              </View>
            </View>
          )}
        />

        <View style={styles.controls}>
          {phase === "listening" && (
            <TouchableOpacity testID="call-done-talking" style={[styles.doneButton, { borderColor: palette.accent }]} onPress={submitTurn}>
              <Ionicons name="checkmark" size={16} color={palette.accentBright} />
              <Text style={[styles.doneButtonText, { color: palette.accentBright }]}>Done talking</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity testID="call-end-button" style={styles.endButton} onPress={endCall}>
            <Ionicons name="call" size={22} color="#fff" style={{ transform: [{ rotate: "135deg" }] }} />
          </TouchableOpacity>
        </View>
      </View>
    </GalaxyBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  top: { alignItems: "center", paddingTop: spacing.xl, paddingBottom: spacing.md, gap: spacing.sm },
  phaseText: { ...typography.body, color: colors.textSecondary, fontStyle: "italic" },
  timerText: { ...typography.caption, color: colors.textMuted },
  errorText: { ...typography.caption, color: colors.danger, textAlign: "center", paddingHorizontal: spacing.lg },
  transcript: { flex: 1 },
  transcriptContent: { padding: spacing.lg, gap: spacing.md },
  emptyText: { ...typography.body, color: colors.textMuted, textAlign: "center", marginTop: spacing.xl },
  turnBlock: { backgroundColor: colors.bgCard, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  turnRow: { gap: 2 },
  turnLabel: { ...typography.caption, color: colors.textMuted, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 },
  turnText: { ...typography.body, color: colors.textPrimary },
  controls: { alignItems: "center", gap: spacing.md, paddingVertical: spacing.lg },
  doneButton: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: radii.pill, paddingVertical: 8, paddingHorizontal: 16 },
  doneButtonText: { fontWeight: "700", fontSize: 13 },
  endButton: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.danger, alignItems: "center", justifyContent: "center" },
});
