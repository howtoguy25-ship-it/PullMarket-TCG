import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Alert } from "../lib/alert";
import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GalaxyBackground } from "../components/GalaxyBackground";
import { BotAvatar } from "../components/BotAvatar";
import { MessageBubble, type ChatMessageVM } from "../components/MessageBubble";
import { ModeDropdown, type AnswerMode, type FocusMode } from "../components/ModeDropdown";
import { UsageBanner } from "../components/UsageBanner";
import { ActiveRunIndicator } from "../components/ActiveRunIndicator";
import { ChatSideMenu, type ChatSessionSummary } from "../components/ChatSideMenu";
import { PersonLookupIndicator } from "../components/PersonLookupIndicator";
import { RotatingChip } from "../components/RotatingChip";
import { radii, spacing, typography } from "../theme/colors";
import { useTheme } from "../lib/ThemeContext";
import type { Palette } from "../theme/palettes";
import { api, streamChatMessage, editSentMessage, ApiError, getLastSessionId, setLastSessionId } from "../lib/api";
import { uploadAttachment, type UploadedAttachment } from "../lib/attachments";
import { useAuth } from "../lib/AuthContext";
import { speak, transcribeVoiceMemo } from "../lib/voice";

type ChatKind = "text" | "voice_memo" | "file_attachment" | "who_is_lookup";

type BotMood = "idle" | "thinking" | "talking";

/**
 * A real, visible message queued because it was sent while a previous turn
 * was still active (send()'s `sending` check below) — not silently dropped,
 * not silently combined with the in-flight one. Rendered as a real chip
 * above the composer (removable) until its turn comes, then dispatched
 * through the exact same send() path as a normal message the moment the
 * active one settles (see the queue-draining effect in ChatScreen).
 */
interface QueuedSend {
  id: string;
  text: string;
  kind: ChatKind;
  attachment?: UploadedAttachment;
  opts?: { setActiveTask?: string; focusModeOverride?: FocusMode };
}

/** Real dictionary suggestion from server/src/lib/spellcheck.ts's nspell check — never applied automatically, only offered. */
interface SpellingSuggestion {
  word: string;
  suggestions: string[];
  index: number;
}

/** Pending send held back for a "Did you mean" confirmation. */
interface PendingSpellCheck {
  text: string;
  kind: ChatKind;
  attachment?: UploadedAttachment;
  suggestions: SpellingSuggestion[];
}

const SUGGESTED_PROMPTS = ["Help me plan something", "Explain a concept simply", "Look up a business or public figure"];

const ROTATING_PHRASES = ["Start a conversation", "Build/Design with NexaAi", "Ask NexaAi anything"];

// How long a gap since the last real message has to be before reopening a
// session earns a real "Resumed session" marker — short enough to catch
// "came back later today", long enough that switching tabs for a minute
// doesn't spam one on every reopen.
const RESUME_GAP_MS = 20 * 60 * 1000;

/**
 * A real, time-of-day-derived greeting for the empty chat state — plain,
 * dignified, in-built copy (no AI-invented nickname/epithet). An earlier
 * version layered a model-generated nickname on top (e.g. "Audit the
 * Night Owl?", via routes/chat.ts's GET /nickname) for extra warmth, but
 * that read as random and off-brand rather than premium — this is the
 * whole greeting now, every time, with real time-of-day and real first
 * name only. The server endpoint/column still exist (see schema.ts's
 * cachedNickname) but nothing on the client calls them anymore.
 */
function getGreeting(firstName?: string): string {
  const withName = (base: string) => (firstName ? `${base}, ${firstName}?` : `${base}?`);
  const hour = new Date().getHours();
  if (hour < 5) return withName("Late-night build");
  if (hour < 12) return withName("Morning spark");
  if (hour < 17) return withName("Afternoon build");
  if (hour < 21) return withName("Evening chat");
  return withName("Late-night build");
}

function useFirstName(displayName?: string): string | undefined {
  return useMemo(() => displayName?.trim().split(/\s+/)[0], [displayName]);
}

export function ChatScreen() {
  const { user, refreshUser } = useAuth();
  const firstName = useFirstName(user?.displayName);
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [messages, setMessages] = useState<ChatMessageVM[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [botMood, setBotMood] = useState<BotMood>("idle");
  const [limitBanner, setLimitBanner] = useState<{ message: string; resetAt: string | null; kind: "usage_limit" | "insufficient_credit" } | null>(
    null,
  );
  // The exact turn that failed for real lack of credit — kept so that once
  // the user actually buys more (they'll typically go straight from the
  // "Buy credits" button below to the Credits screen and back), coming back
  // to this screen offers to genuinely resend that same request rather than
  // making them remember and retype it. Cleared the moment any new message
  // is sent, successfully or not, so it never nags about a stale turn.
  const [pendingRetry, setPendingRetry] = useState<{
    text: string;
    kind: ChatKind;
    attachment?: UploadedAttachment;
    opts?: { setActiveTask?: string; focusModeOverride?: FocusMode };
  } | null>(null);
  const [answerMode, setAnswerMode] = useState<AnswerMode>(user?.answerMode ?? "normal");
  const [focusMode, setFocusMode] = useState<FocusMode>(user?.defaultFocusMode ?? "quick");
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  // Real, live values from expo-av's own RecordingStatus callback — not
  // simulated. durationMillis and metering (dBFS audio level) both come
  // straight from the native recorder, polled every 100ms while recording.
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingLevel, setRecordingLevel] = useState(0);
  const [recordingPaused, setRecordingPaused] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [whoIsMode, setWhoIsMode] = useState(false);
  const [lookupPending, setLookupPending] = useState(false);
  const [sideMenuOpen, setSideMenuOpen] = useState(false);
  const [loadingSession, setLoadingSession] = useState(false);
  const [activeTask, setActiveTask] = useState<string | null>(null);
  const [planPanelOpen, setPlanPanelOpen] = useState(false);
  const [planInput, setPlanInput] = useState("");
  const [queue, setQueue] = useState<QueuedSend[]>([]);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [attachCosts, setAttachCosts] = useState<{ photoCents: number; videoCents: number; fileCents: number } | null>(null);
  const [pendingSpellCheck, setPendingSpellCheck] = useState<PendingSpellCheck | null>(null);
  const [checkingSpelling, setCheckingSpelling] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // A real stop — aborts the actual in-flight fetch (and, for the SSE
  // stream route, the server's own upstream Anthropic/self-hosted call,
  // since the route aborts its own request signal the instant this
  // connection drops). Whatever text already streamed in via onDelta stays
  // on screen; this is why ActiveRunIndicator is tappable now.
  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const startNewChat = () => {
    setSessionId(undefined);
    setMessages([]);
    setStreamingMessageId(null);
    setInput("");
    setWhoIsMode(false);
    setLimitBanner(null);
    setActiveTask(null);
    setFocusMode(user?.defaultFocusMode ?? "quick");
    // Anything still queued was headed for the conversation being left
    // behind — carrying it into a brand new chat would send it with none
    // of the context it was written against.
    setQueue([]);
  };

  const openSession = async (session: Pick<ChatSessionSummary, "id" | "activeTask">) => {
    setLoadingSession(true);
    setStreamingMessageId(null);
    setWhoIsMode(false);
    setLimitBanner(null);
    setQueue([]); // same reasoning as startNewChat — queued sends belonged to whatever session was open before
    try {
      const { messages: history } = await api<{ messages: ChatMessageVM[] }>(`/api/chat/sessions/${session.id}/messages`);
      setSessionId(session.id);
      // Real "you're picking this back up" marker — only when the gap since
      // the real last message actually earns it (RESUME_GAP_MS), not on
      // every reopen. `at` is right now, live, not the old message's own
      // timestamp — that's the moment the resumption itself happened.
      const lastReal = history[history.length - 1];
      const gapMs = lastReal ? Date.now() - new Date(lastReal.createdAt!).getTime() : 0;
      setMessages(
        lastReal && gapMs >= RESUME_GAP_MS
          ? [...history, { id: `resumed-${Date.now()}`, role: "assistant", content: "", sessionResumedAt: new Date().toISOString() }]
          : history,
      );
      setActiveTask(session.activeTask ?? null);
      setLastSessionId(session.id).catch(() => {});
    } finally {
      setLoadingSession(false);
    }
  };

  // Real deep link from History (navigation.navigate("Chat", { openSessionId })):
  // jump straight into that session the moment this screen focuses with the
  // param set, then clear it so re-focusing later doesn't re-trigger it.
  React.useEffect(() => {
    const openSessionId = route.params?.openSessionId as string | undefined;
    if (!openSessionId) return;
    openSession({ id: openSessionId, activeTask: null });
    navigation.setParams({ openSessionId: undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.openSessionId]);

  // Real "reopen the app and pick up where you left off" — without this,
  // Chat always started blank and the "Resumed session" marker above would
  // never have anything to attach to. Fires once, and only when nothing
  // else (the deep-link effect above, or a fresh "New chat") has already
  // claimed this screen.
  React.useEffect(() => {
    if (route.params?.openSessionId || sessionId) return;
    getLastSessionId().then(async (id) => {
      if (id) {
        openSession({ id, activeTask: null });
        return;
      }
      // No local last-session id — either a genuinely brand-new user, or
      // an existing account signing in on a fresh device. Either way the
      // server (not this client) is the real source of truth: it only
      // actually generates and charges a welcome message when this
      // account has zero chat sessions ever (see routes/chat.ts's real
      // POST /welcome), so this is safe to call unconditionally here.
      setLoadingSession(true);
      try {
        const result = await api<{ skipped: boolean; sessionId?: string; message?: ChatMessageVM }>("/api/chat/welcome", { method: "POST" });
        if (!result.skipped && result.sessionId && result.message) {
          setSessionId(result.sessionId);
          setMessages([result.message]);
          setLastSessionId(result.sessionId).catch(() => {});
          refreshUser();
        }
      } catch {
        // best-effort — the normal empty state still works fine if this fails
      } finally {
        setLoadingSession(false);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh the real credit balance every time this screen regains focus —
  // the common path here is "tapped Buy credits on the insufficient-credit
  // banner, bought some on the Credits screen, came back" — so the header/
  // balance and the pendingRetry banner below both reflect reality without
  // needing a manual pull-to-refresh.
  useFocusEffect(
    React.useCallback(() => {
      refreshUser();
    }, [refreshUser]),
  );

  const changeAnswerMode = async (mode: AnswerMode) => {
    setAnswerMode(mode);
    await api("/api/chat/answer-mode", { method: "PATCH", body: JSON.stringify({ mode }) });
  };

  const changeFocusMode = async (mode: FocusMode) => {
    setFocusMode(mode);
    await api("/api/auth/settings", { method: "PATCH", body: JSON.stringify({ defaultFocusMode: mode }) });
  };

  // The definitive, instant way to drop an in-progress task — no message
  // round trip, no model call, just clears the real DB column (see
  // server/src/routes/chat.ts's PATCH /sessions/:id/task).
  const cancelTask = async () => {
    setActiveTask(null);
    if (!sessionId) return;
    try {
      await api(`/api/chat/sessions/${sessionId}/task`, { method: "PATCH", body: JSON.stringify({ activeTask: null }) });
    } catch {
      // best-effort — the banner is already gone locally either way
    }
  };

  // Smart Build's two real, server-persisted banners (see
  // server/src/routes/auth.ts's smart-build/* routes and shared/src/schema.ts's
  // smartBuildIntroDismissedAt/smartBuildFirstRunAt/smartBuildFollowUpDismissedAt).
  // `enabled` — present when the user picked "Keep it on"/"Turn off" from the
  // banner itself — patches the capability in the same round trip; omitted
  // for a plain X dismiss, which leaves the current setting untouched.
  const dismissSmartBuildIntro = async (enabled?: boolean) => {
    try {
      await api("/api/auth/smart-build/intro-seen", { method: "POST", body: JSON.stringify(enabled === undefined ? {} : { enabled }) });
    } finally {
      refreshUser();
    }
  };
  const dismissSmartBuildFollowUp = async (enabled?: boolean) => {
    try {
      await api("/api/auth/smart-build/followup-seen", { method: "POST", body: JSON.stringify(enabled === undefined ? {} : { enabled }) });
    } finally {
      refreshUser();
    }
  };
  const showSmartBuildIntro = !!user && !user.smartBuildIntroDismissedAt;
  const showSmartBuildFollowUp = !!user && !!user.smartBuildFirstRunAt && !user.smartBuildFollowUpDismissedAt && !showSmartBuildIntro;

  const send = useCallback(
    async (text: string, kind: ChatKind = "text", attachment?: UploadedAttachment, opts?: { setActiveTask?: string; focusModeOverride?: FocusMode }) => {
      if (!text.trim()) return;
      // NexaAi is still actively answering the previous turn — queue this
      // one for real instead of dropping it. The queue-draining effect
      // below dispatches it through this exact same function the moment
      // `sending` settles back to false.
      if (sending) {
        setQueue((prev) => [...prev, { id: `queued-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text, kind, attachment, opts }]);
        setInput("");
        return;
      }
      const now = Date.now();
      const effectiveFocusMode = opts?.focusModeOverride ?? focusMode;

      setPendingRetry(null); // a real new send in flight — any earlier stalled turn is moot now
      const localUserId = `local-${now}`;
      const userMsg: ChatMessageVM = { id: localUserId, role: "user", content: text, attachment };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setSending(true);
      setWhoIsMode(false);
      setBotMood("thinking");
      setLimitBanner(null);

      const finishWithMessage = (final: {
        sessionId: string;
        message: ChatMessageVM;
        userMessage?: ChatMessageVM;
        activeTask?: string | null;
        followUpMessage?: ChatMessageVM | null;
        smartBuild?: { triggered: true };
      }) => {
        setSessionId(final.sessionId);
        setLastSessionId(final.sessionId).catch(() => {});
        setSending(false);
        setLookupPending(false);
        setBotMood("idle");
        if (final.activeTask !== undefined) setActiveTask(final.activeTask);
        // Swap the optimistic local id for the real, persisted row (id +
        // createdAt) — needed so the user's own message can later be edited
        // (see MessageBubble's onEdit / EDIT_WINDOW_MS): the real 1-minute
        // window is anchored to this real createdAt, not the local one.
        if (final.userMessage) {
          const realUserMessage = final.userMessage;
          setMessages((prev) => prev.map((m) => (m.id === localUserId ? { ...m, id: realUserMessage.id, createdAt: realUserMessage.createdAt } : m)));
        }
        // Smart Build's real "once finished" notice (routes/chat.ts) — a
        // genuine second assistant message (real SiteSpark push result),
        // appended right after the main reply, not a replacement of it.
        if (final.followUpMessage) {
          const followUp = final.followUpMessage;
          setMessages((prev) => [...prev, followUp]);
        }
        refreshUser();
        // Smart Build speaks its own build/follow-up replies through its
        // own dedicated toggle (Capabilities > Smart Build) — independent
        // of the general "Auto-speak replies" toggle below, so it still
        // talks even when that one's off, and never double-speaks when
        // both happen to be on.
        if (final.smartBuild?.triggered && (user?.capabilities.smartBuild ?? true)) {
          const spokenText = (final.followUpMessage?.content ?? final.message.content).replace(/[*_[\]]/g, "");
          speak(spokenText, user?.voiceCharacterId ?? "nova-neutral", {
            onStart: () => setBotMood("talking"),
            onDone: () => setBotMood("idle"),
            onStopped: () => setBotMood("idle"),
            onError: () => setBotMood("idle"),
          });
        } else if (user?.capabilities.autoSpeak ?? true) {
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
        setLookupPending(false);
        setBotMood("idle");
        setStreamingMessageId(null);
        if (status === 429) {
          // A real, time-based rolling-window limit — the server always
          // sends a real resetAt for this one (middleware/usage.ts).
          setLimitBanner({ message, resetAt: errorBody?.resetAt ?? null, kind: "usage_limit" });
        } else if (status === 402) {
          // Out of credit has no natural reset time at all — there's no
          // recurring free refill, just "buy more" (lib/credits.ts). Showing
          // a fake countdown here would be actively misleading, so this
          // banner deliberately carries resetAt: null and UsageBanner
          // renders a "Buy credits" call to action instead of a timer.
          setLimitBanner({ message, resetAt: null, kind: "insufficient_credit" });
          // Remember exactly what failed to send — see pendingRetry's own
          // comment — so coming back from buying credits can offer to
          // genuinely resend this same turn instead of losing it.
          setPendingRetry({ text, kind, attachment, opts });
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

      const controller = new AbortController();
      abortRef.current = controller;

      // A stopped turn keeps whatever partial reply the user already saw
      // instead of erasing it or showing an error — same idea as Claude's
      // own stop button. Only removes the assistant bubble if it's still
      // genuinely empty (stopped before the first delta ever arrived).
      const handleStopped = () => {
        abortRef.current = null;
        setSending(false);
        setLookupPending(false);
        setBotMood("idle");
        setStreamingMessageId(null);
        setMessages((prev) => prev.filter((m) => !(m.id === assistantId && m.role === "assistant" && m.content.trim().length === 0)));
      };

      // Live typing is a real, toggleable capability (Settings -> Capabilities):
      // off means a plain request/response instead of the SSE stream.
      if (!(user?.capabilities.liveTyping ?? true)) {
        try {
          const final = await api<{
            sessionId: string;
            message: ChatMessageVM;
            userMessage: ChatMessageVM;
            activeTask: string | null;
            followUpMessage?: ChatMessageVM | null;
            smartBuild?: { triggered: true };
          }>("/api/chat/messages", {
            method: "POST",
            body: JSON.stringify({ sessionId, text, kind, requestedFocusMode: effectiveFocusMode, attachment, setActiveTask: opts?.setActiveTask }),
            signal: controller.signal,
          });
          abortRef.current = null;
          setMessages((prev) => [...prev, final.message]);
          finishWithMessage(final);
        } catch (err) {
          if (controller.signal.aborted) {
            setSending(false);
            setBotMood("idle");
            return;
          }
          abortRef.current = null;
          if (err instanceof ApiError) handleFailure(err.message, err.status, err.body);
          else handleFailure("Something went wrong reaching NexaAi. Try again in a moment.");
        }
        return;
      }

      const assistantId = `stream-${now}`;
      const isPersonLookup = kind === "who_is_lookup";
      if (isPersonLookup) {
        // The real web search this mode runs has to finish before any text
        // exists at all — the server delivers it as one block, not
        // token-by-token — so there's nothing to stream into yet. Show the
        // dedicated source-checking animation instead of an empty bubble.
        setLookupPending(true);
      } else {
        // Everything else streams token-by-token, so the assistant's row
        // appears immediately (empty, with just the blinking cursor from
        // MessageBubble's isStreaming state) rather than waiting for the
        // first delta — no separate "..."/loading label above it, matching
        // Claude/ChatGPT's own reply-in-progress feel.
        setStreamingMessageId(assistantId);
        setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "" }]);
      }

      let lookupPlaceholderCreated = false;

      await streamChatMessage(
        { sessionId, text, kind, requestedFocusMode: effectiveFocusMode, attachment, setActiveTask: opts?.setActiveTask },
        {
          onDelta: (delta) => {
            setBotMood("talking");
            if (isPersonLookup && !lookupPlaceholderCreated) {
              lookupPlaceholderCreated = true;
              setLookupPending(false);
              setStreamingMessageId(assistantId);
              setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: delta }]);
              return;
            }
            setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m)));
          },
          // Real, live per-frame video breakdown: the still arrives first
          // (render its thumbnail right away), then its real Claude vision
          // description follows shortly after, same index — see
          // components/VideoFrameBreakdown.tsx. Only the thumbnail is
          // ever client-side-only: the persisted metadata.videoFrames the
          // server returns in onDone carries the real timestamp +
          // description but never the image, so it's merged back in below.
          onVideoFrame: (frame) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      metadata: {
                        ...m.metadata,
                        videoFrames: [
                          ...(m.metadata?.videoFrames ?? []),
                          {
                            index: frame.index,
                            timestampSeconds: frame.timestampSeconds,
                            description: "",
                            thumbnailUri: `data:${frame.mediaType};base64,${frame.thumbnailBase64}`,
                          },
                        ],
                      },
                    }
                  : m,
              ),
            );
          },
          onVideoFrameDescription: (event) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      metadata: {
                        ...m.metadata,
                        videoFrames: (m.metadata?.videoFrames ?? []).map((f) =>
                          f.index === event.index ? { ...f, description: event.description } : f,
                        ),
                      },
                    }
                  : m,
              ),
            );
          },
          onDone: (final) => {
            abortRef.current = null;
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantId) return m;
                const liveFrames = m.metadata?.videoFrames ?? [];
                const finalFrames = final.message.metadata?.videoFrames;
                const mergedVideoFrames = finalFrames?.map((f) => ({
                  ...f,
                  thumbnailUri: liveFrames.find((lf) => lf.index === f.index)?.thumbnailUri,
                }));
                return {
                  ...final.message,
                  metadata: mergedVideoFrames ? { ...final.message.metadata, videoFrames: mergedVideoFrames } : final.message.metadata,
                };
              }),
            );
            setStreamingMessageId(null);
            finishWithMessage(final);
          },
          onStopped: handleStopped,
          onError: (message, status, errorBody) => {
            abortRef.current = null;
            handleFailure(message, status, errorBody);
          },
        },
        controller.signal,
      );
    },
    [sessionId, sending, user, refreshUser, focusMode],
  );

  // Genuinely resends the exact turn that stalled on insufficient credit —
  // not a canned "let's continue!" message, the same real text/kind/
  // attachment/opts the user originally sent. If credits are still short
  // (e.g. they navigated back without actually buying any), this just
  // fails the normal way and the same insufficient-credit banner reappears.
  const resumePendingTask = () => {
    if (!pendingRetry) return;
    const { text, kind, attachment, opts } = pendingRetry;
    setPendingRetry(null);
    send(text, kind, attachment, opts);
  };

  // Drains the real queue the moment the active turn settles — success or
  // failure, there's no point leaving a queued message sitting there once
  // the thing it was waiting on is no longer in flight. Re-fires whenever
  // `sending` flips or the queue itself changes; the `!sending` guard
  // means it only ever actually dispatches once per settle, never mid-turn.
  React.useEffect(() => {
    if (sending || queue.length === 0) return;
    const [next, ...rest] = queue;
    setQueue(rest);
    send(next.text, next.kind, next.attachment, next.opts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sending, queue]);

  const removeFromQueue = (id: string) => setQueue((prev) => prev.filter((item) => item.id !== id));

  // Real spellcheck gate on the two places a message actually leaves the
  // composer (Enter and the send button) — never silently autocorrects.
  // A clean spelling (or a failed check — fails open, never blocks
  // sending) goes straight through to send(); a real misspelling holds it
  // for confirmation instead.
  const checkSpellingThenSend = async (text: string, kind: ChatKind, attachment?: UploadedAttachment) => {
    if (!text.trim() || kind === "who_is_lookup") {
      send(text, kind, attachment);
      return;
    }
    setCheckingSpelling(true);
    try {
      const { suggestions } = await api<{ suggestions: SpellingSuggestion[] }>("/api/chat/spellcheck", {
        method: "POST",
        body: JSON.stringify({ text }),
      });
      if (suggestions.length > 0) setPendingSpellCheck({ text, kind, attachment, suggestions });
      else send(text, kind, attachment);
    } catch {
      send(text, kind, attachment);
    } finally {
      setCheckingSpelling(false);
    }
  };

  const applyCorrectionsAndSend = () => {
    if (!pendingSpellCheck) return;
    let corrected = pendingSpellCheck.text;
    for (const { word, suggestions } of pendingSpellCheck.suggestions) {
      if (!suggestions[0]) continue;
      corrected = corrected.replace(new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), suggestions[0]);
    }
    const { kind, attachment } = pendingSpellCheck;
    setPendingSpellCheck(null);
    send(corrected, kind, attachment);
  };

  const sendAsTypedAnyway = () => {
    if (!pendingSpellCheck) return;
    const { text, kind, attachment } = pendingSpellCheck;
    setPendingSpellCheck(null);
    send(text, kind, attachment);
  };

  // Real "edit a sent message, AI re-answers" — server enforces the real
  // 1-minute window (see routes/chat.ts's EDIT_WINDOW_MS) and genuinely
  // regenerates the reply against the edited text, replacing the stale one
  // it invalidates. Optimistic locally (edited text + a "regenerating"
  // placeholder appear immediately), with a full revert on failure.
  const handleEditMessage = useCallback(
    async (messageId: string, newText: string) => {
      const snapshot = messages;
      const index = messages.findIndex((m) => m.id === messageId);
      if (index === -1) return;
      const nextItem = messages[index + 1];
      const hasStaleReply = !!nextItem && nextItem.role === "assistant";
      const placeholderId = hasStaleReply ? nextItem.id : `edit-${Date.now()}`;

      setMessages((prev) => {
        const updated = [...prev];
        updated[index] = { ...updated[index], content: newText };
        const placeholder: ChatMessageVM = { id: placeholderId, role: "assistant", content: "" };
        if (hasStaleReply) updated[index + 1] = placeholder;
        else updated.splice(index + 1, 0, placeholder);
        return updated;
      });
      setStreamingMessageId(placeholderId);
      setBotMood("thinking");

      try {
        const result = await editSentMessage(messageId, newText, focusMode);
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id === messageId) return { ...m, content: result.userMessage.content, createdAt: result.userMessage.createdAt };
            if (m.id === placeholderId) return { id: result.message.id, role: "assistant", content: result.message.content, kind: result.message.kind };
            return m;
          }),
        );
        setStreamingMessageId(null);
        setBotMood("idle");
        refreshUser();
        if (user?.capabilities.autoSpeak ?? true) {
          speak(result.message.content.replace(/[*_[\]]/g, ""), user?.voiceCharacterId ?? "nova-neutral", {
            onStart: () => setBotMood("talking"),
            onDone: () => setBotMood("idle"),
            onStopped: () => setBotMood("idle"),
            onError: () => setBotMood("idle"),
          });
        }
      } catch (err) {
        setMessages(snapshot);
        setStreamingMessageId(null);
        setBotMood("idle");
        Alert.alert("Couldn't save edit", err instanceof ApiError ? err.message : "Something went wrong. Try again.");
      }
    },
    [messages, focusMode, refreshUser, user],
  );

  // "Help me plan something" doesn't just prefill the input — it starts a
  // real, remembered task (see server/src/routes/chat.ts's activeTask):
  // switches this session into Build focus mode (more thinking budget per
  // reply) and tells the server to keep every later turn anchored to this
  // goal until the user cancels it, rather than only relying on the plain
  // chat-history window to "remember" what they're doing.
  const startPlan = () => {
    const goal = planInput.trim();
    if (!goal) return;
    setPlanPanelOpen(false);
    setPlanInput("");
    setFocusMode("build");
    send(goal, "text", undefined, { setActiveTask: goal, focusModeOverride: "build" });
  };

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

  const pickPhoto = async () => {
    setAttachMenuOpen(false);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    const asset = result.assets?.[0];
    if (result.canceled || !asset) return;
    await handlePickedFile(asset.uri, asset.fileName ?? `photo-${Date.now()}`, asset.mimeType ?? "image/jpeg");
  };

  const pickVideo = async () => {
    setAttachMenuOpen(false);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Videos, quality: 0.8 });
    const asset = result.assets?.[0];
    if (result.canceled || !asset) return;
    await handlePickedFile(asset.uri, asset.fileName ?? `video-${Date.now()}`, asset.mimeType ?? "video/mp4");
  };

  const pickAttachmentDocument = async () => {
    setAttachMenuOpen(false);
    const result = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
    const asset = result.assets?.[0];
    if (result.canceled || !asset) return;
    await handlePickedFile(asset.uri, asset.name, asset.mimeType ?? "application/octet-stream");
  };

  // Real per-type cost preview — fetched fresh each time the menu opens
  // (see server/src/routes/chat.ts's GET /attachment-cost-estimate), computed
  // with the exact same formula that actually charges the turn, so these
  // aren't a separately-maintained guess that could drift from the real
  // charge. Failing quietly (costs stay null, menu still fully usable) beats
  // blocking the whole attach flow on one extra network call.
  const openAttachmentMenu = () => {
    setAttachCosts(null);
    setAttachMenuOpen(true);
    api<{ photoCents: number; videoCents: number; fileCents: number }>(`/api/chat/attachment-cost-estimate?focusMode=${focusMode}`)
      .then(setAttachCosts)
      .catch(() => {});
  };

  const startRecording = async () => {
    const { granted } = await Audio.requestPermissionsAsync();
    if (!granted) return;
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
    setRecordingSeconds(0);
    setRecordingLevel(0);
    setRecordingPaused(false);
    const { recording: rec } = await Audio.Recording.createAsync(
      { ...Audio.RecordingOptionsPresets.HIGH_QUALITY, isMeteringEnabled: true },
      (status) => {
        if (!status.isRecording) return;
        setRecordingSeconds(Math.floor(status.durationMillis / 1000));
        // Real dBFS level from the native recorder (roughly -60 silence to
        // 0 loudest) — normalized to a 0-1 bar height, not a fake pulse.
        if (typeof status.metering === "number") setRecordingLevel(Math.max(0, Math.min(1, (status.metering + 60) / 60)));
      },
      100,
    );
    setRecording(rec);
  };

  // Real pause/resume via expo-av's own Recording.pauseAsync/startAsync —
  // the native recorder actually stops writing audio while paused (the
  // level bar freezes because the status callback's isRecording flips
  // false), not a UI-only freeze that keeps taping over silence.
  const togglePauseRecording = async () => {
    if (!recording) return;
    if (recordingPaused) {
      await recording.startAsync();
      setRecordingPaused(false);
    } else {
      await recording.pauseAsync();
      setRecordingPaused(true);
    }
  };

  // Stop and discard — no transcription, no message. Real cancel, not a
  // dressed-up stop: the memo is deleted, not silently sent anyway.
  const cancelRecording = async () => {
    if (!recording) return;
    const uri = recording.getURI();
    await recording.stopAndUnloadAsync();
    setRecording(null);
    setRecordingSeconds(0);
    setRecordingLevel(0);
    setRecordingPaused(false);
    if (uri) FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
  };

  const stopRecording = async () => {
    if (!recording) return;
    await recording.stopAndUnloadAsync();
    const uri = recording.getURI();
    setRecording(null);
    setRecordingSeconds(0);
    setRecordingLevel(0);
    setRecordingPaused(false);
    if (!uri) return;
    setTranscribing(true);
    try {
      const transcript = await transcribeVoiceMemo(uri);
      setInput(transcript); // pre-filled so the user can edit before sending, per spec
    } catch (err) {
      const detail = err instanceof ApiError ? err.message : "Couldn't reach the transcription service — check your connection and try again.";
      setMessages((prev) => [
        ...prev,
        { id: `stt-note-${Date.now()}`, role: "assistant", content: `_Voice memo recorded._\n\n**Couldn't transcribe it**\n${detail}` },
      ]);
    } finally {
      setTranscribing(false);
    }
  };

  return (
    <GalaxyBackground>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
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
          <TouchableOpacity testID="chat-new-button" style={styles.headerNewButton} onPress={startNewChat}>
            <Ionicons name="create-outline" size={22} color={palette.textSecondary} />
          </TouchableOpacity>
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

        {pendingRetry ? (
          // Supersedes the plain insufficient-credit banner once there's a
          // specific stalled turn to offer resuming — "Buy credits" still
          // works the same way underneath, but resuming is now the more
          // useful first action for a user who came back after topping up.
          <View style={styles.resumeBanner}>
            <Ionicons name="play-circle-outline" size={16} color={palette.accentBright} />
            <Text style={styles.resumeBannerText} numberOfLines={2}>
              Ran out of credit on: "{pendingRetry.text}"
            </Text>
            <TouchableOpacity testID="chat-resume-task" onPress={resumePendingTask} style={styles.resumeBannerButton}>
              <Text style={styles.resumeBannerButtonText}>Resume</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => navigation.navigate("Credits")} style={styles.resumeBannerBuyButton}>
              <Text style={styles.resumeBannerBuyText}>Buy credits</Text>
            </TouchableOpacity>
          </View>
        ) : (
          limitBanner && (
            <UsageBanner
              message={limitBanner.message}
              resetAtIso={limitBanner.resetAt}
              onBuyCreditsPress={limitBanner.kind === "insufficient_credit" ? () => navigation.navigate("Credits") : undefined}
            />
          )
        )}

        {activeTask && (
          <View style={styles.taskBanner}>
            <Ionicons name="flag" size={14} color={palette.accentBright} />
            <Text style={styles.taskBannerText} numberOfLines={1}>
              Working on: {activeTask}
            </Text>
            <TouchableOpacity onPress={cancelTask} style={styles.taskBannerCancel}>
              <Text style={styles.taskBannerCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}

        {showSmartBuildIntro && (
          <View style={styles.smartBuildBanner} testID="smart-build-intro-banner">
            <View style={styles.smartBuildBannerHeader}>
              <Ionicons name="hammer-outline" size={16} color={palette.accentBright} />
              <Text style={styles.smartBuildBannerTitle}>Smart Build is on</Text>
              <TouchableOpacity testID="smart-build-intro-close" onPress={() => dismissSmartBuildIntro()} hitSlop={8}>
                <Ionicons name="close" size={16} color={palette.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.smartBuildBannerText}>
              Say something like "build me a website for my bakery" and NexaAi builds it right here — asking first if your
              request needs more detail — with a spoken reply, and pushes it live to SiteSpark if you've connected it.
            </Text>
            <View style={styles.smartBuildBannerActions}>
              <TouchableOpacity testID="smart-build-intro-keep-on" style={styles.smartBuildBannerButton} onPress={() => dismissSmartBuildIntro(true)}>
                <Text style={styles.smartBuildBannerButtonText}>Keep it on</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="smart-build-intro-turn-off"
                style={styles.smartBuildBannerButtonSecondary}
                onPress={() => dismissSmartBuildIntro(false)}
              >
                <Text style={styles.smartBuildBannerButtonSecondaryText}>Turn off</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {showSmartBuildFollowUp && (
          <View style={styles.smartBuildBanner} testID="smart-build-followup-banner">
            <View style={styles.smartBuildBannerHeader}>
              <Ionicons name="hammer-outline" size={16} color={palette.accentBright} />
              <Text style={styles.smartBuildBannerTitle}>Keep Smart Build on?</Text>
              <TouchableOpacity testID="smart-build-followup-close" onPress={() => dismissSmartBuildFollowUp()} hitSlop={8}>
                <Ionicons name="close" size={16} color={palette.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.smartBuildBannerText}>
              You just saw Smart Build in action. Want NexaAi to keep auto-detecting and building "build me a..." requests
              like that one in Chat?
            </Text>
            <View style={styles.smartBuildBannerActions}>
              <TouchableOpacity
                testID="smart-build-followup-keep-on"
                style={styles.smartBuildBannerButton}
                onPress={() => dismissSmartBuildFollowUp(true)}
              >
                <Text style={styles.smartBuildBannerButtonText}>Keep it on</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="smart-build-followup-turn-off"
                style={styles.smartBuildBannerButtonSecondary}
                onPress={() => dismissSmartBuildFollowUp(false)}
              >
                <Text style={styles.smartBuildBannerButtonSecondaryText}>Turn off</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {messages.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.brandLockup}>
              <Image source={require("../../../assets/icon-transparent.png")} style={styles.brandLogo} resizeMode="contain" />
              <Text style={styles.brandName}>NexaAi</Text>
            </View>
            <View style={styles.greetingRow}>
              <Ionicons name="sparkles" size={26} color={palette.accentBright} />
              <Text style={styles.emptyTitle}>{getGreeting(firstName)}</Text>
            </View>
            <View style={styles.promptGrid}>
              {SUGGESTED_PROMPTS.map((prompt) => (
                <TouchableOpacity
                  key={prompt}
                  style={styles.promptChip}
                  onPress={() => (prompt === "Help me plan something" ? setPlanPanelOpen(true) : setInput(prompt))}
                >
                  <Text style={styles.promptChipText}>{prompt}</Text>
                </TouchableOpacity>
              ))}
              <RotatingChip phrases={ROTATING_PHRASES} onPress={(phrase) => setInput(phrase === "Start a conversation" ? "" : phrase)} />
            </View>
          </View>
        ) : (
          <FlatList
            style={styles.flex}
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.list}
            renderItem={({ item, index }) => (
              <MessageBubble
                message={item}
                isStreaming={item.id === streamingMessageId}
                avatarMood={item.id === streamingMessageId ? "talking" : "happy"}
                showSeparatorAbove={index > 0 && item.role === "user" && !messages[index - 1]?.sessionResumedAt}
                focusMode={item.id === streamingMessageId ? focusMode : undefined}
                onEdit={handleEditMessage}
                precedingUserText={item.role === "assistant" && messages[index - 1]?.role === "user" ? messages[index - 1].content : undefined}
              />
            )}
            ListFooterComponent={
              lookupPending ? (
                <TouchableOpacity testID="chat-stop-lookup" activeOpacity={0.7} onPress={stop}>
                  <PersonLookupIndicator />
                </TouchableOpacity>
              ) : null
            }
          />
        )}

        {whoIsMode && (
          <View style={styles.whoIsBanner}>
            <Ionicons name="person-circle" size={14} color={palette.accentBright} />
            <Text style={styles.whoIsBannerText}>Web person lookup — type a name and send. Works for anyone with a real public footprint.</Text>
          </View>
        )}

        {queue.length > 0 && (
          <View style={styles.queueList} testID="chat-queue-list">
            <Text style={styles.queueLabel}>
              Up next {queue.length > 1 ? `(${queue.length})` : ""}
            </Text>
            {queue.map((q) => (
              <View key={q.id} style={styles.queueChip}>
                <Ionicons name="time-outline" size={13} color={palette.textMuted} />
                <Text style={styles.queueChipText} numberOfLines={1}>
                  {q.text || q.attachment?.filename || "Message"}
                </Text>
                <TouchableOpacity onPress={() => removeFromQueue(q.id)} hitSlop={6}>
                  <Ionicons name="close" size={14} color={palette.textMuted} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {pendingSpellCheck && (
          <View style={styles.spellCheckBanner} testID="chat-spellcheck-banner">
            <View style={styles.spellCheckHeader}>
              <Ionicons name="text-outline" size={15} color={palette.accentBright} />
              <Text style={styles.spellCheckTitle}>Did you mean…</Text>
            </View>
            <View style={styles.spellCheckWordList}>
              {pendingSpellCheck.suggestions.map((s) => (
                <Text key={s.word} style={styles.spellCheckWordItem}>
                  <Text style={styles.spellCheckWrong}>{s.word}</Text>
                  {s.suggestions[0] ? (
                    <>
                      {" → "}
                      <Text style={styles.spellCheckRight}>{s.suggestions[0]}</Text>
                    </>
                  ) : null}
                </Text>
              ))}
            </View>
            <View style={styles.spellCheckButtons}>
              <TouchableOpacity testID="spellcheck-send-as-typed" style={styles.spellCheckSecondaryButton} onPress={sendAsTypedAnyway}>
                <Text style={styles.spellCheckSecondaryText}>Send as typed</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="spellcheck-apply-corrections"
                style={[styles.spellCheckPrimaryButton, { backgroundColor: palette.accent }]}
                onPress={applyCorrectionsAndSend}
              >
                <Text style={styles.spellCheckPrimaryText}>Use corrections</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={[styles.inputRow, { paddingBottom: insets.bottom + spacing.sm }]}>
          <View style={styles.composerCard}>
            {recording ? (
              // Real live feedback while recording — durationMillis and
              // metering (dBFS level) both come from expo-av's own
              // RecordingStatus callback (see startRecording), not a
              // simulated animation. Cancel genuinely discards the file
              // (cancelRecording) rather than silently sending it.
              <View style={styles.recordingRow} testID="chat-recording-row">
                <TouchableOpacity testID="chat-recording-cancel" style={styles.recordingIconButton} onPress={cancelRecording}>
                  <Ionicons name="trash-outline" size={18} color={palette.danger} />
                </TouchableOpacity>
                <TouchableOpacity testID="chat-recording-pause" style={styles.recordingIconButton} onPress={togglePauseRecording}>
                  <Ionicons name={recordingPaused ? "play" : "pause"} size={16} color={palette.textPrimary} />
                </TouchableOpacity>
                {!recordingPaused && <View style={styles.recordingDot} />}
                <Text style={styles.recordingTimer}>
                  {formatRecordingTime(recordingSeconds)}
                  {recordingPaused ? " · Paused" : ""}
                </Text>
                <View style={styles.recordingLevelTrack}>
                  <View style={[styles.recordingLevelFill, { width: `${Math.round(recordingLevel * 100)}%`, backgroundColor: palette.accentBright }]} />
                </View>
                <TouchableOpacity
                  testID="chat-recording-confirm"
                  style={[styles.recordingIconButton, { backgroundColor: palette.accent }]}
                  onPress={stopRecording}
                >
                  <Ionicons name="checkmark" size={20} color="#fff" />
                </TouchableOpacity>
              </View>
            ) : transcribing ? (
              <View style={styles.recordingRow} testID="chat-transcribing-row">
                <ActivityIndicator size="small" color={palette.accentBright} />
                <Text style={styles.recordingTimer}>Transcribing your voice memo…</Text>
              </View>
            ) : (
              <TextInput
                testID="chat-input"
                style={styles.composerInput}
                placeholder={whoIsMode ? "Who do you want to look up?" : "How can I help you today?"}
                placeholderTextColor={palette.textMuted}
                value={input}
                onChangeText={setInput}
                onSubmitEditing={() => checkSpellingThenSend(input, whoIsMode ? "who_is_lookup" : "text")}
                multiline
                // react-native-web's TextInput only fires onSubmitEditing on
                // Enter for a multiline field when blurOnSubmit is explicitly
                // true (see its handleKeyDown) — without this, Enter silently
                // does nothing on web. This also gives the real, expected
                // Enter-to-send / Shift+Enter-for-newline split.
                blurOnSubmit
              />
            )}
            {sending && input.trim().length > 0 && !recording && !transcribing && (
              <Text style={styles.queueHint}>NexaAi is still replying — this will send right after, in order.</Text>
            )}
            {!recording && !transcribing && <View style={styles.composerToolbar}>
              <View style={[styles.composerToolbarSide, styles.composerToolbarSideShrink]}>
                <TouchableOpacity testID="chat-attach-button" style={styles.roundIconButton} onPress={openAttachmentMenu} disabled={uploading}>
                  {uploading ? <ActivityIndicator size="small" color={palette.textSecondary} /> : <Ionicons name="add" size={22} color={palette.textSecondary} />}
                </TouchableOpacity>
                <ModeDropdown
                  answerMode={answerMode}
                  onAnswerModeChange={changeAnswerMode}
                  focusMode={focusMode}
                  onFocusModeChange={changeFocusMode}
                  planTier={user?.planTier ?? "beginner"}
                  onNavigateToPlans={() => navigation.navigate("Plans")}
                />
                <TouchableOpacity
                  testID="chat-whois-toggle"
                  style={[styles.roundIconButton, whoIsMode && styles.roundIconButtonActive]}
                  onPress={() => setWhoIsMode((v) => !v)}
                >
                  <Ionicons name="person-circle-outline" size={19} color={whoIsMode ? palette.accentBright : palette.textSecondary} />
                </TouchableOpacity>
              </View>
              <View style={[styles.composerToolbarSide, styles.composerToolbarSideFixed]}>
                <TouchableOpacity testID="chat-mic-button" style={styles.roundIconButton} onPress={startRecording}>
                  <Ionicons name="mic" size={19} color={palette.textSecondary} />
                </TouchableOpacity>
                <TouchableOpacity testID="chat-call-button" style={styles.roundIconButton} onPress={() => navigation.navigate("Call")}>
                  <Ionicons name="pulse-outline" size={19} color={palette.textSecondary} />
                </TouchableOpacity>
                {sending && !input.trim() ? (
                  // NexaAi is actively working and there's nothing typed to
                  // queue yet — a real "in progress" indicator, not a
                  // pointless disabled arrow. The moment the user types
                  // anything, this flips back to a real send button below
                  // (which queues instead of sending immediately).
                  <ActiveRunIndicator onStop={stop} />
                ) : (
                  <TouchableOpacity
                    testID="chat-send-button"
                    style={[styles.sendButton, { backgroundColor: input.trim() ? palette.accent : palette.bgCard }]}
                    onPress={() => checkSpellingThenSend(input, whoIsMode ? "who_is_lookup" : "text")}
                    disabled={!input.trim() || checkingSpelling}
                  >
                    {checkingSpelling ? (
                      <ActivityIndicator size="small" color={palette.textMuted} />
                    ) : (
                      <Ionicons name="arrow-up" size={20} color={input.trim() ? "#fff" : palette.textMuted} />
                    )}
                  </TouchableOpacity>
                )}
              </View>
            </View>}
          </View>
        </View>
      </KeyboardAvoidingView>

      <Modal visible={planPanelOpen} transparent animationType="fade" onRequestClose={() => setPlanPanelOpen(false)}>
        <View style={styles.planOverlay}>
          <View style={styles.planCard}>
            <View style={styles.planIconCircle}>
              <Ionicons name="flag" size={20} color={palette.accentBright} />
            </View>
            <Text style={styles.planTitle}>Let's plan it</Text>
            <Text style={styles.planSubtitle}>
              What do you want to build or plan? NexaAi will switch into Build mode and keep this in mind for the rest of the
              conversation.
            </Text>
            <TextInput
              testID="plan-goal-input"
              style={styles.planInput}
              placeholder="e.g. a two-week trip to Japan"
              placeholderTextColor={palette.textMuted}
              value={planInput}
              onChangeText={setPlanInput}
              autoFocus
              multiline
              onSubmitEditing={startPlan}
            />
            <View style={styles.planButtons}>
              <TouchableOpacity
                testID="plan-cancel-button"
                style={styles.planCancelButton}
                onPress={() => {
                  setPlanPanelOpen(false);
                  setPlanInput("");
                }}
              >
                <Text style={styles.planCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="plan-start-button"
                style={[styles.planStartButton, { backgroundColor: planInput.trim() ? palette.accent : palette.bgCardAlt }]}
                onPress={startPlan}
                disabled={!planInput.trim()}
              >
                <Text style={[styles.planStartText, { color: planInput.trim() ? "#fff" : palette.textMuted }]}>Start planning</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={attachMenuOpen} transparent animationType="fade" onRequestClose={() => setAttachMenuOpen(false)}>
        <TouchableOpacity style={styles.planOverlay} activeOpacity={1} onPress={() => setAttachMenuOpen(false)}>
          <View style={styles.attachCard} onStartShouldSetResponder={() => true}>
            <Text style={styles.planTitle}>Attach</Text>
            <Text style={styles.planSubtitle}>
              Real per-type cost, computed the same way the actual charge is — not a guess.
            </Text>
            {(
              [
                { key: "photo", label: "Photo", icon: "image-outline" as const, cents: attachCosts?.photoCents, onPress: pickPhoto },
                { key: "video", label: "Video", icon: "videocam-outline" as const, cents: attachCosts?.videoCents, onPress: pickVideo },
                { key: "file", label: "File", icon: "document-outline" as const, cents: attachCosts?.fileCents, onPress: pickAttachmentDocument },
              ] as const
            ).map((option) => (
              <TouchableOpacity key={option.key} testID={`attach-option-${option.key}`} style={styles.attachRow} onPress={option.onPress}>
                <Ionicons name={option.icon} size={20} color={palette.accentBright} />
                <Text style={styles.attachRowLabel}>{option.label}</Text>
                {attachCosts ? (
                  <Text style={styles.attachRowCost}>{formatCreditCents(option.cents ?? 0)}</Text>
                ) : (
                  <ActivityIndicator size="small" color={palette.textMuted} />
                )}
              </TouchableOpacity>
            ))}
            <TouchableOpacity testID="attach-cancel-button" style={styles.attachCancelButton} onPress={() => setAttachMenuOpen(false)}>
              <Text style={styles.planCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </GalaxyBackground>
  );
}

/** Real credit-cent formatting for the attach-menu cost preview — under a dollar shows as cents, at/above shows dollars, matching how the rest of the app (Credits/Plans screens) already presents amount_cents. */
function formatCreditCents(cents: number): string {
  return cents < 100 ? `~${cents}¢` : `~$${(cents / 100).toFixed(2)}`;
}

/** mm:ss for the live recording timer — recordingSeconds is a real elapsed count from expo-av's own status callback, not a display trick. */
function formatRecordingTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
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
      paddingTop: spacing.md, // overridden with insets.top + spacing.sm at render time
      paddingBottom: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: palette.divider,
    },
    headerText: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm, flex: 1 },
    headerTitle: { ...typography.h2, color: palette.textPrimary },
    headerStatus: { ...typography.caption, fontStyle: "italic" },
    headerNewButton: { padding: 4 },
    taskBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginHorizontal: spacing.md,
      marginBottom: spacing.sm,
      backgroundColor: palette.bgCardAlt,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.border,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    taskBannerText: { ...typography.caption, color: palette.textPrimary, fontWeight: "600", flex: 1 },
    taskBannerCancel: { paddingHorizontal: spacing.xs },
    taskBannerCancelText: { ...typography.caption, color: palette.textMuted, fontWeight: "700" },
    smartBuildBanner: {
      marginHorizontal: spacing.md,
      marginBottom: spacing.sm,
      backgroundColor: palette.bgCardAlt,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.accentBright,
      padding: spacing.md,
      gap: spacing.sm,
    },
    smartBuildBannerHeader: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    smartBuildBannerTitle: { ...typography.bodyBold, color: palette.textPrimary, flex: 1 },
    smartBuildBannerText: { ...typography.caption, color: palette.textSecondary, lineHeight: 18 },
    smartBuildBannerActions: { flexDirection: "row", gap: spacing.sm },
    smartBuildBannerButton: { backgroundColor: palette.accent, borderRadius: radii.pill, paddingVertical: 7, paddingHorizontal: spacing.md },
    smartBuildBannerButtonText: { ...typography.caption, color: "#fff", fontWeight: "700" },
    smartBuildBannerButtonSecondary: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.pill,
      paddingVertical: 7,
      paddingHorizontal: spacing.md,
    },
    smartBuildBannerButtonSecondaryText: { ...typography.caption, color: palette.textMuted, fontWeight: "700" },
    resumeBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginHorizontal: spacing.md,
      marginBottom: spacing.sm,
      backgroundColor: palette.bgCardAlt,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.accentBright,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    resumeBannerText: { ...typography.caption, color: palette.textPrimary, flex: 1 },
    resumeBannerButton: { backgroundColor: palette.accent, borderRadius: radii.pill, paddingVertical: 6, paddingHorizontal: spacing.md },
    resumeBannerButtonText: { ...typography.caption, color: "#fff", fontWeight: "700" },
    resumeBannerBuyButton: { paddingHorizontal: spacing.xs },
    resumeBannerBuyText: { ...typography.caption, color: palette.textMuted, fontWeight: "700" },
    list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
    emptyState: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl, gap: spacing.lg },
    brandLockup: { alignItems: "center", gap: spacing.xs },
    brandLogo: { width: 64, height: 64 },
    brandName: { ...typography.h2, color: palette.textPrimary, letterSpacing: 1.2 },
    greetingRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    emptyTitle: { ...typography.h1, color: palette.textPrimary },
    promptGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: spacing.sm },
    promptChip: {
      backgroundColor: palette.bgCardAlt,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: palette.border,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      shadowColor: "#000",
      shadowOpacity: 0.12,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 1,
    },
    promptChipText: { ...typography.caption, color: palette.textSecondary },
    inputRow: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xl },
    // A single rounded card holding two rows — the text field on top, a real
    // icon toolbar underneath — instead of a one-line pill with icons
    // crammed to its left. Matches the Claude-style composer shape: type
    // first, act second.
    composerCard: {
      backgroundColor: palette.bgCardAlt,
      borderRadius: 26,
      borderWidth: 1.5,
      borderColor: palette.border,
      paddingTop: spacing.md,
      paddingBottom: spacing.xs,
      paddingHorizontal: spacing.md,
      gap: spacing.xs,
      shadowColor: "#000",
      shadowOpacity: 0.22,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 4,
    },
    composerInput: {
      color: palette.textPrimary,
      minHeight: 26,
      maxHeight: 140,
      paddingHorizontal: 2,
      ...typography.body,
      fontSize: (typography.body.fontSize ?? 15) + 1,
    },
    // Real breathing room between the two button clusters (attach/mode/
    // whois on the left, mic/call/send on the right) — space-between
    // alone can still read as cramped on narrower screens, so a real
    // minimum gap is enforced here too, matching Claude's own composer
    // spacing rather than icons crowding the send button.
    composerToolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, paddingTop: 2, paddingBottom: spacing.xs },
    composerToolbarSide: { flexDirection: "row", alignItems: "center", gap: 8 },
    // The left cluster (attach/mode/who-is) is allowed to shrink — its
    // ModeDropdown label truncates first — while the right cluster
    // (mic/call/send) never shrinks, so those buttons can never be pushed
    // off-screen on a narrow device (see ModeDropdown's trigger style for
    // the matching truncation fix).
    composerToolbarSideShrink: { flexShrink: 1, minWidth: 0 },
    composerToolbarSideFixed: { flexShrink: 0 },
    roundIconButton: {
      width: 40,
      height: 40,
      borderRadius: radii.pill,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.bgCard,
      borderWidth: 1.5,
      borderColor: palette.border,
    },
    roundIconButtonActive: { backgroundColor: palette.accentGlow, borderColor: palette.accent },
    whoIsBanner: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.md, paddingBottom: spacing.xs },
    whoIsBannerText: { ...typography.caption, color: palette.textMuted },
    recordingRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44, paddingHorizontal: 4 },
    recordingIconButton: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: palette.bgCardAlt },
    recordingDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: palette.danger },
    recordingTimer: { ...typography.bodyBold, color: palette.textPrimary, fontVariant: ["tabular-nums"] },
    recordingLevelTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: palette.bgCardAlt, overflow: "hidden" },
    recordingLevelFill: { height: "100%", borderRadius: 3 },

    // The real, visible send queue — a message typed and sent while
    // NexaAi was still answering the previous one. Each chip is exactly
    // what will actually be sent next, in this exact order, removable
    // before its turn comes.
    queueList: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm, gap: 6 },
    queueLabel: { ...typography.caption, color: palette.textMuted, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5 },
    queueChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: palette.bgCardAlt,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.md,
      paddingVertical: 6,
      paddingHorizontal: 10,
    },
    queueChipText: { ...typography.caption, color: palette.textSecondary, flex: 1 },
    queueHint: { ...typography.caption, color: palette.textMuted, fontSize: 11, paddingHorizontal: spacing.sm, paddingBottom: 4 },

    // Real "did you mean" confirmation — holds the send until the user
    // picks a side, never applies a correction on its own.
    spellCheckBanner: {
      marginHorizontal: spacing.md,
      marginBottom: spacing.sm,
      backgroundColor: palette.bgCard,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.md,
      padding: spacing.sm,
      gap: spacing.xs,
    },
    spellCheckHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
    spellCheckTitle: { ...typography.bodyBold, fontSize: 13, color: palette.textPrimary },
    spellCheckWordList: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    spellCheckWordItem: { ...typography.caption, color: palette.textMuted },
    spellCheckWrong: { textDecorationLine: "line-through", color: palette.textMuted },
    spellCheckRight: { color: palette.accentBright, fontWeight: "600" },
    spellCheckButtons: { flexDirection: "row", gap: spacing.sm, marginTop: 2 },
    spellCheckSecondaryButton: { flex: 1, backgroundColor: palette.bgCardAlt, borderRadius: radii.md, paddingVertical: 8, alignItems: "center" },
    spellCheckSecondaryText: { ...typography.caption, color: palette.textSecondary, fontWeight: "600" },
    spellCheckPrimaryButton: { flex: 1, borderRadius: radii.md, paddingVertical: 8, alignItems: "center" },
    spellCheckPrimaryText: { ...typography.caption, color: "#fff", fontWeight: "700" },
    sendButton: {
      width: 38,
      height: 38,
      borderRadius: radii.pill,
      alignItems: "center",
      justifyContent: "center",
      shadowColor: palette.accent,
      shadowOpacity: 0.4,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
      elevation: 4,
    },

    planOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
    planCard: {
      width: "100%",
      maxWidth: 380,
      backgroundColor: palette.bgCard,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      padding: spacing.lg,
      gap: spacing.xs,
    },
    planIconCircle: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: palette.bgCardAlt,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: spacing.xs,
    },
    planTitle: { ...typography.h1, fontSize: 21, color: palette.textPrimary },
    planSubtitle: { ...typography.caption, color: palette.textMuted, marginBottom: spacing.sm },
    planInput: {
      backgroundColor: palette.bgCardAlt,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.border,
      padding: spacing.md,
      color: palette.textPrimary,
      minHeight: 64,
      textAlignVertical: "top",
      ...typography.body,
    },
    planButtons: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
    planCancelButton: { flex: 1, backgroundColor: palette.bgCardAlt, borderRadius: radii.md, padding: spacing.md, alignItems: "center" },
    planCancelText: { ...typography.bodyBold, color: palette.textSecondary },
    planStartButton: { flex: 1, borderRadius: radii.md, padding: spacing.md, alignItems: "center" },
    planStartText: { ...typography.bodyBold },
    attachCard: {
      width: "100%",
      maxWidth: 380,
      backgroundColor: palette.bgCard,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      padding: spacing.lg,
      gap: spacing.xs,
    },
    attachRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: palette.bgCardAlt,
      borderRadius: radii.md,
      padding: spacing.md,
      marginTop: spacing.sm,
    },
    attachRowLabel: { ...typography.bodyBold, color: palette.textPrimary, flex: 1 },
    attachRowCost: { ...typography.caption, color: palette.textMuted },
    attachCancelButton: { backgroundColor: palette.bgCardAlt, borderRadius: radii.md, padding: spacing.md, alignItems: "center", marginTop: spacing.md },
  });
}
