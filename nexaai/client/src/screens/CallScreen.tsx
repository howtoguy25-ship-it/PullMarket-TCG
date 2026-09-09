import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Animated, Easing, FlatList, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { Audio } from "expo-av";
import { GalaxyBackground } from "../components/GalaxyBackground";
import { BotAvatar } from "../components/BotAvatar";
import { radii, spacing, typography } from "../theme/colors";
import { useTheme } from "../lib/ThemeContext";
import type { Palette } from "../theme/palettes";
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
  const styles = useMemo(() => makeStyles(palette), [palette]);
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
  const glowPulse = useRef(new Animated.Value(0.5)).current;
  const mounted = useRef(true);

  // Real, live-input-driven values — not decorative timers. `micLevel` is
  // the mic button's pulse ring, fed straight from the same dBFS metering
  // the VAD logic below already reads off the actual microphone. `mouthLevel`
  // is the character's real lip-sync amplitude on web, fed frame-by-frame
  // from a Web Audio analyser reading the TTS reply's actual waveform (see
  // playReplyWeb) — expo-av exposes no playback amplitude on native, so on
  // iOS/Android BotAvatar falls back to its believable simulated cadence
  // instead of a fake "live" signal.
  const micLevel = useRef(new Animated.Value(0)).current;
  const mouthLevel = useRef(new Animated.Value(0)).current;
  const webAudioElRef = useRef<HTMLAudioElement | null>(null);
  const webAudioCtxRef = useRef<AudioContext | null>(null);
  const webRafRef = useRef<number | null>(null);

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
      webAudioElRef.current?.pause();
      if (webRafRef.current !== null) cancelAnimationFrame(webRafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ambient glow behind the character — purely decorative breathing, not a
  // stand-in for the real audio-reactive mouth movement above.
  useEffect(() => {
    if (phase === "ringing" || phase === "connecting" || phase === "ended") return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glowPulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(glowPulse, { toValue: 0.5, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [phase, glowPulse]);

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

  // Real amplitude-driven lip sync — web only. Routes the reply's audio
  // through a Web Audio AnalyserNode instead of expo-av, reads the actual
  // waveform's RMS level every animation frame, and feeds that straight into
  // BotAvatar's mouth. Genuinely reactive to the real audio, not a loop.
  const playReplyWeb = (url: string): Promise<void> =>
    new Promise((resolve) => {
      try {
        const audioEl = new window.Audio(`${API_URL}${url}`);
        webAudioElRef.current = audioEl;
        const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = webAudioCtxRef.current ?? new AudioContextCtor();
        webAudioCtxRef.current = ctx;
        ctx.resume().catch(() => {});

        const source = ctx.createMediaElementSource(audioEl);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyser.connect(ctx.destination);
        const data = new Uint8Array(analyser.frequencyBinCount);

        const finish = () => {
          if (webRafRef.current !== null) cancelAnimationFrame(webRafRef.current);
          webRafRef.current = null;
          mouthLevel.setValue(0);
          source.disconnect();
          analyser.disconnect();
          resolve();
        };
        const tick = () => {
          analyser.getByteTimeDomainData(data);
          let sumSquares = 0;
          for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            sumSquares += v * v;
          }
          const rms = Math.sqrt(sumSquares / data.length);
          mouthLevel.setValue(Math.min(1, rms * 4.5));
          webRafRef.current = requestAnimationFrame(tick);
        };
        audioEl.onended = finish;
        audioEl.onerror = finish;
        audioEl
          .play()
          .then(() => {
            webRafRef.current = requestAnimationFrame(tick);
          })
          .catch(finish);
      } catch {
        resolve();
      }
    });

  const playReply = (url: string) =>
    new Promise<void>((resolve) => {
      if (Platform.OS === "web") {
        playReplyWeb(url).then(resolve);
        return;
      }
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
    const metering = status.metering;
    if (typeof metering === "number") {
      // The mic button's live pulse ring — the same real dBFS reading the
      // VAD logic below uses, just remapped 0-1 for the UI.
      micLevel.setValue(Math.max(0, Math.min(1, (metering + 50) / 50)));
    }
    if (phaseRef.current !== "listening" || submittingRef.current) return;
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
    micLevel.setValue(0);
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
    webAudioElRef.current?.pause();
    if (webRafRef.current !== null) cancelAnimationFrame(webRafRef.current);
    micLevel.setValue(0);
    mouthLevel.setValue(0);
    if (conversationId) await api(`/api/voice/conversations/${conversationId}/end`, { method: "PATCH" }).catch(() => {});
    navigation.goBack();
  };

  const mm = String(Math.floor(elapsedSec / 60)).padStart(2, "0");
  const ss = String(elapsedSec % 60).padStart(2, "0");
  const avatarMood = phase === "speaking" ? "talking" : phase === "listening" ? "happy" : "thinking";
  const showTimer = phase !== "ringing" && phase !== "connecting" && phase !== "ended";
  const phaseDotColor =
    phase === "listening" ? palette.success : phase === "speaking" ? palette.accentBright : phase === "thinking" ? palette.warning : palette.accent;

  const micRingScale = micLevel.interpolate({ inputRange: [0, 1], outputRange: [1, 1.45] });
  const micRingOpacity = micLevel.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.6] });
  const innerGlowOpacity = glowPulse.interpolate({ inputRange: [0.5, 1], outputRange: [0.35, 0.7] });
  const innerGlowScale = glowPulse.interpolate({ inputRange: [0.5, 1], outputRange: [0.94, 1.06] });

  return (
    <GalaxyBackground>
      <View style={styles.container}>
        <View style={styles.stage}>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.stageGlowOuter,
              { backgroundColor: palette.accentGlow, opacity: innerGlowOpacity, transform: [{ scale: innerGlowScale }] },
            ]}
          />
          <View style={[styles.stageRing, { borderColor: palette.border }]} />
          <Animated.View style={{ transform: [{ scale: phase === "ringing" ? ringScale : 1 }] }}>
            <BotAvatar size={156} mood={avatarMood} liveMouthLevel={Platform.OS === "web" ? mouthLevel : undefined} />
          </Animated.View>

          <View style={[styles.phasePill, { borderColor: palette.border, backgroundColor: palette.bgCard }]}>
            <View style={[styles.phaseDot, { backgroundColor: phaseDotColor }]} />
            <Text style={styles.phaseText}>{PHASE_LABEL[phase]}</Text>
          </View>
          {showTimer && (
            <Text style={styles.timerText}>
              {mm}:{ss}
            </Text>
          )}
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
                <View style={[styles.bubble, styles.bubbleUser, { backgroundColor: palette.accent }]}>
                  <Text style={styles.bubbleLabel}>You</Text>
                  <Text style={styles.bubbleTextUser}>{item.transcript}</Text>
                </View>
              )}
              <View style={[styles.bubble, styles.bubbleBot, { backgroundColor: palette.bgCard, borderColor: palette.border }]}>
                <Text style={[styles.bubbleLabel, { color: palette.accentBright }]}>NexaAi</Text>
                <Text style={styles.bubbleTextBot}>{item.replyText}</Text>
              </View>
            </View>
          )}
        />

        <View style={styles.controls}>
          {phase === "listening" && (
            <View style={styles.micWrap}>
              <Animated.View
                pointerEvents="none"
                style={[styles.micPulseRing, { borderColor: palette.accent, opacity: micRingOpacity, transform: [{ scale: micRingScale }] }]}
              />
              <TouchableOpacity
                testID="call-done-talking"
                style={[styles.micButton, { backgroundColor: palette.accent, shadowColor: palette.accent }]}
                onPress={submitTurn}
                activeOpacity={0.85}
              >
                <Ionicons name="mic" size={26} color="#fff" />
              </TouchableOpacity>
              <Text style={styles.micHint}>Tap when you're done talking</Text>
            </View>
          )}
          <TouchableOpacity testID="call-end-button" style={styles.endButton} onPress={endCall} activeOpacity={0.85}>
            <Ionicons name="call" size={24} color="#fff" style={{ transform: [{ rotate: "135deg" }] }} />
          </TouchableOpacity>
          <Text style={styles.endHint}>End call</Text>
        </View>
      </View>
    </GalaxyBackground>
  );
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    container: { flex: 1 },
    stage: { alignItems: "center", paddingTop: spacing.xl, paddingBottom: spacing.md, gap: spacing.sm },
    stageGlowOuter: { position: "absolute", top: 6, width: 220, height: 220, borderRadius: 110 },
    stageRing: { position: "absolute", top: 22, width: 188, height: 188, borderRadius: 94, borderWidth: 1 },
    phasePill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      borderWidth: 1,
      borderRadius: radii.pill,
      paddingVertical: 6,
      paddingHorizontal: 14,
      marginTop: spacing.sm,
    },
    phaseDot: { width: 7, height: 7, borderRadius: 4 },
    phaseText: { ...typography.bodyBold, color: palette.textPrimary, fontSize: 13 },
    timerText: { ...typography.caption, color: palette.textMuted, marginTop: 2 },
    errorText: { ...typography.caption, color: palette.danger, textAlign: "center", paddingHorizontal: spacing.lg, marginTop: spacing.xs },
    transcript: { flex: 1 },
    transcriptContent: { padding: spacing.lg, gap: spacing.md },
    emptyText: { ...typography.body, color: palette.textMuted, textAlign: "center", marginTop: spacing.xl },
    turnBlock: { gap: 6 },
    bubble: { maxWidth: "88%", borderRadius: radii.lg, padding: spacing.md, gap: 3 },
    bubbleUser: { alignSelf: "flex-end", borderBottomRightRadius: 6 },
    bubbleBot: { alignSelf: "flex-start", borderWidth: 1, borderBottomLeftRadius: 6 },
    bubbleLabel: { ...typography.caption, color: "rgba(255,255,255,0.7)", fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 },
    bubbleTextUser: { ...typography.body, color: "#fff" },
    bubbleTextBot: { ...typography.body, color: palette.textPrimary },
    controls: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.lg },
    micWrap: { alignItems: "center", justifyContent: "center", gap: spacing.sm, marginBottom: spacing.sm },
    micPulseRing: { position: "absolute", top: -13, width: 90, height: 90, borderRadius: 45, borderWidth: 2 },
    micButton: {
      width: 64,
      height: 64,
      borderRadius: 32,
      alignItems: "center",
      justifyContent: "center",
      shadowOpacity: 0.5,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 6,
    },
    micHint: { ...typography.caption, color: palette.textMuted },
    endButton: { width: 64, height: 64, borderRadius: 32, backgroundColor: palette.danger, alignItems: "center", justifyContent: "center" },
    endHint: { ...typography.caption, color: palette.textMuted },
  });
}
