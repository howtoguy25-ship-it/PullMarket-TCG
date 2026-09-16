import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Image, Linking, Modal, Platform, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import * as Clipboard from "expo-clipboard";
import * as Sharing from "expo-sharing";
import { captureViewAsImage } from "../lib/shareCapture";
import Markdown from "react-native-markdown-display";
import { Ionicons } from "@expo/vector-icons";
import { API_URL, api, ApiError } from "../lib/api";
import { Alert } from "../lib/alert";
import { radii, spacing, typography } from "../theme/colors";
import { useTheme } from "../lib/ThemeContext";
import type { Palette } from "../theme/palettes";
import { useAuth } from "../lib/AuthContext";
import { BotAvatar } from "./BotAvatar";
import { FadeInUp } from "./FadeInUp";
import { ShareCard } from "./ShareCard";
import { parseWhoIsProfile, WhoIsProfileCard } from "./WhoIsProfileCard";
import { SourceLinksList } from "./SourceLinksList";
import { extractSources } from "../lib/sources";
import { openDirections, type MapsApp } from "../lib/maps";
import { deriveLiveStatus } from "../lib/liveStatus";
import { speak, stopSpeaking, pauseSpeaking, resumeSpeaking, canPauseSpeaking } from "../lib/voice";
import { VideoFrameBreakdown, type VideoFrameBreakdownItem } from "./VideoFrameBreakdown";
import { matchHelpLink } from "../lib/helpLinks";

export interface MessageAttachment {
  url: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  kind: "image" | "video" | "file";
}

export interface NearbyBusiness {
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  distanceKm: number | null;
}

export interface ChatMessageVM {
  id: string;
  role: "user" | "assistant";
  content: string;
  kind?: string;
  attachment?: MessageAttachment;
  metadata?: {
    businesses?: NearbyBusiness[];
    videoFrames?: VideoFrameBreakdownItem[];
    /** A real gpt-image-2 result (server/src/lib/imageGeneration.ts) — url is a real /uploads/*.png this server generated, never invented. */
    generatedImage?: { url: string; prompt: string };
  } | null;
  createdAt?: string;
  /** Set only on a synthetic marker row (ChatScreen.tsx's openSession) — when present, this entry renders as a real "Resumed session" divider with this exact live timestamp instead of a normal chat bubble; every other field on it is meaningless. */
  sessionResumedAt?: string;
}

const EDIT_WINDOW_MS = 60_000;

/**
 * A real, tappable link to the exact in-app screen a reply is about (e.g.
 * "View Credits & Usage" under a billing answer) — only rendered when
 * matchHelpLink actually finds a topic match, never on every reply.
 */
export function HelpLinkChip({ userText }: { userText?: string }) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const navigation = useNavigation<any>();
  const link = useMemo(() => matchHelpLink(userText), [userText]);
  if (!link) return null;
  return (
    <TouchableOpacity
      testID="help-link-chip"
      style={[styles.helpLinkChip, { borderColor: palette.border, backgroundColor: palette.bgCardAlt }]}
      onPress={() => navigation.navigate(link.screen, link.params)}
      activeOpacity={0.75}
    >
      <Ionicons name="arrow-redo-outline" size={13} color={palette.link} />
      <Text style={[styles.helpLinkChipText, { color: palette.link }]}>{link.label}</Text>
    </TouchableOpacity>
  );
}

/** Copies text to the clipboard and flips the icon to a checkmark for a moment — the same real feedback pattern as AgentBuilderScreen's "Copy webhook URL" button, no Alert popup needed for something this quick. */
function CopyButton({ text }: { text: string }) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [copied, setCopied] = useState(false);
  return (
    <TouchableOpacity
      style={styles.actionButton}
      onPress={async () => {
        await Clipboard.setStringAsync(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
    >
      <Ionicons name={copied ? "checkmark" : "copy-outline"} size={15} color={palette.textMuted} />
      <Text style={styles.actionButtonText}>{copied ? "Copied" : "Copy"}</Text>
    </TouchableOpacity>
  );
}

/**
 * Real share sheet, with NexaAi's actual logo genuinely part of what gets
 * shared: an off-screen ShareCard (logo + wordmark + the text) is snapshotted
 * to a real PNG (react-native-view-shot) and shared as an image, so the OS
 * share sheet's own preview/thumbnail shows the branded card, not bare text.
 *   - Web: Web Share Level 2 (`navigator.share` with `files`) shares the
 *     image alongside the caption text, where the browser supports it.
 *   - iOS: RN's Share module genuinely accepts an image `url` alongside a
 *     `message` in one call.
 *   - Android: RN's Share module can't attach a local image file reliably,
 *     so this hands the PNG to expo-sharing (real FileProvider-backed native
 *     file sharing) instead — the real platform split, not a workaround.
 * Any failure at any step (capture, or no share capability at all) falls
 * back to the plain-text share, then to a clipboard copy — never silent.
 */
function ShareButton({ text, role }: { text: string; role: "user" | "assistant" }) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const cardRef = useRef<View>(null);
  const [busy, setBusy] = useState(false);

  const shareBrandedImage = async () => {
    if (!cardRef.current) throw new Error("Share card not ready");
    if (Platform.OS === "web") {
      const dataUri = await captureViewAsImage(cardRef.current, { format: "png", quality: 0.95, result: "data-uri" });
      const blob = await (await fetch(dataUri)).blob();
      const file = new File([blob], "nexaai-share.png", { type: "image/png" });
      const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean };
      if (!nav.canShare?.({ files: [file] })) throw new Error("This browser can't share images.");
      await navigator.share({ files: [file], title: "NexaAi", text });
      return;
    }
    const uri = await captureViewAsImage(cardRef.current, { format: "png", quality: 0.95, result: "tmpfile" });
    if (Platform.OS === "ios") {
      await Share.share({ message: text, url: uri, title: "NexaAi" });
      return;
    }
    if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing isn't available on this device.");
    await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle: "Share via" });
  };

  return (
    <>
      <View style={styles.hiddenCardHost} pointerEvents="none">
        <ShareCard ref={cardRef} role={role} text={text} />
      </View>
      <TouchableOpacity
        style={styles.actionButton}
        disabled={busy}
        onPress={async () => {
          setBusy(true);
          try {
            await shareBrandedImage();
          } catch (err) {
            console.warn("[NexaAi] branded share failed, falling back to plain text:", err);
            try {
              await Share.share({ message: text });
            } catch {
              await Clipboard.setStringAsync(text);
              Alert.alert("Copied instead", "Sharing isn't available here, so this was copied to your clipboard instead.");
            }
          } finally {
            setBusy(false);
          }
        }}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        <Ionicons name="share-outline" size={15} color={palette.textMuted} />
        <Text style={styles.actionButtonText}>Share</Text>
      </TouchableOpacity>
    </>
  );
}

/**
 * Real on-demand read-aloud (expo-speech, on-device TTS — the same engine
 * ChatScreen's autoSpeak capability already uses) — this is the actual
 * "voice audio" for the answer's transcript, not a cosmetic icon: tapping
 * it genuinely plays the message text as speech, independent of the
 * autoSpeak setting, so it works even when that's off or to re-listen.
 */
/**
 * Real playback controls, not just a start/stop toggle: Pause genuinely
 * suspends the on-device speech (expo-speech's own pause/resume — see
 * lib/voice.ts's canPauseSpeaking, which is false on Android since expo-
 * speech itself doesn't implement pause there), and Replay genuinely
 * restarts the same utterance from the beginning rather than continuing
 * a stale one.
 */
function ListenButton({ text }: { text: string }) {
  const { palette } = useTheme();
  const { user } = useAuth();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [status, setStatus] = useState<"idle" | "playing" | "paused">("idle");

  useEffect(() => () => stopSpeaking(), []);

  const start = () => {
    setStatus("playing");
    speak(text.replace(/[*_[\]]/g, ""), user?.voiceCharacterId ?? "nova-neutral", {
      onDone: () => setStatus("idle"),
      onStopped: () => setStatus("idle"),
      onError: () => setStatus("idle"),
    });
  };

  const togglePlayPause = () => {
    if (status === "idle") {
      start();
    } else if (status === "playing") {
      if (canPauseSpeaking) {
        pauseSpeaking();
        setStatus("paused");
      } else {
        // No real pause on this platform — stopping outright beats a
        // button that looks like it paused but silently kept playing.
        stopSpeaking();
        setStatus("idle");
      }
    } else {
      resumeSpeaking();
      setStatus("playing");
    }
  };

  const replay = () => {
    stopSpeaking();
    start();
  };

  return (
    <View style={styles.listenControls}>
      <TouchableOpacity style={styles.actionButton} onPress={togglePlayPause} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
        <Ionicons
          name={status === "playing" ? "pause-circle-outline" : status === "paused" ? "play-circle-outline" : "volume-high-outline"}
          size={15}
          color={status !== "idle" ? palette.accentBright : palette.textMuted}
        />
        <Text style={[styles.actionButtonText, status !== "idle" && { color: palette.accentBright }]}>
          {status === "playing" ? "Pause" : status === "paused" ? "Resume" : "Listen"}
        </Text>
      </TouchableOpacity>
      {status !== "idle" && (
        <TouchableOpacity style={styles.actionButton} onPress={replay} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
          <Ionicons name="refresh-outline" size={14} color={palette.textMuted} />
          <Text style={styles.actionButtonText}>Replay</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

/**
 * Real "report a billing issue" — no money refunds (see terms.html), but a
 * genuine, AI-reviewed CREDIT refund when the charge for this exact reply
 * was a real technical/billing error (server/src/lib/creditDisputes.ts).
 * The review only ever sees structural facts about the charge, never this
 * message's actual content — this button just collects the user's own
 * plain-language description of the problem and shows back whatever the
 * real decision was, including the reasoning either way.
 */
function ReportIssueButton({ messageId }: { messageId: string }) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const trimmed = description.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      const outcome = await api<{ status: "approved" | "declined"; reasoning: string; refundedCents: number }>("/api/credits/disputes", {
        method: "POST",
        body: JSON.stringify({ assistantMessageId: messageId, description: trimmed }),
      });
      setOpen(false);
      setDescription("");
      if (outcome.status === "approved") {
        Alert.alert("Refunded", `${outcome.reasoning}\n\n$${(outcome.refundedCents / 100).toFixed(2)} in credit has been added back to your balance.`);
      } else {
        Alert.alert("Not refunded", outcome.reasoning);
      }
    } catch (err) {
      Alert.alert("Couldn't submit", err instanceof ApiError ? err.body?.error ?? err.message : "Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <TouchableOpacity style={styles.actionButton} onPress={() => setOpen(true)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
        <Ionicons name="flag-outline" size={15} color={palette.textMuted} />
        <Text style={styles.actionButtonText}>Report issue</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.reportOverlay}>
          <View style={styles.reportCard}>
            <Text style={styles.reportTitle}>Report a billing issue</Text>
            <Text style={styles.reportSubtitle}>
              Tell us what went wrong with the credit charge for this reply. A real backend check reviews the charge itself
              (not the conversation) and refunds credit automatically if it finds a genuine error.
            </Text>
            <TextInput
              style={styles.reportInput}
              placeholder="e.g. I was charged but never got a response"
              placeholderTextColor={palette.textMuted}
              value={description}
              onChangeText={setDescription}
              multiline
              autoFocus
            />
            <View style={styles.reportButtonRow}>
              <TouchableOpacity style={styles.reportCancelButton} onPress={() => setOpen(false)} disabled={submitting}>
                <Text style={styles.reportCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.reportSubmitButton, { opacity: description.trim() && !submitting ? 1 : 0.5 }]}
                onPress={submit}
                disabled={!description.trim() || submitting}
              >
                <Text style={styles.reportSubmitText}>{submitting ? "Reviewing…" : "Submit"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const ATTACHMENT_ICON: Record<MessageAttachment["kind"], keyof typeof Ionicons.glyphMap> = {
  image: "image",
  video: "videocam",
  file: "document",
};

function AttachmentPreview({ attachment }: { attachment: MessageAttachment }) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const sizeLabel =
    attachment.sizeBytes > 1024 * 1024 * 1024
      ? `${(attachment.sizeBytes / (1024 * 1024 * 1024)).toFixed(1)}GB`
      : `${(attachment.sizeBytes / (1024 * 1024)).toFixed(1)}MB`;

  if (attachment.kind === "image") {
    return <Image source={{ uri: `${API_URL}${attachment.url}` }} style={styles.attachmentImage} resizeMode="cover" />;
  }
  return (
    <View style={styles.attachmentFile}>
      <Ionicons name={ATTACHMENT_ICON[attachment.kind]} size={18} color={palette.textSecondary} />
      <Text style={styles.attachmentFileName} numberOfLines={1}>
        {attachment.filename}
      </Text>
      <Text style={styles.attachmentFileSize}>{sizeLabel}</Text>
    </View>
  );
}

/** A steadily blinking text-cursor, shown at the end of a message still streaming in — the only "is it working" signal, no separate loading label. */
function BlinkingCursor() {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0, duration: 420, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 420, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.Text style={[styles.cursor, { opacity, color: palette.accentBright }]}>▍</Animated.Text>;
}

// When NexaAi names one of the four focus modes in **bold** (its own
// established habit — see shared/src/nexaPersona.ts — when explaining
// "Quick"/"Build"/"Auto"/"Gorilla" to a user), give each its own real color
// and extra weight so they read as distinct, memorable choices rather than
// four identical bold words. Only fires when a bold span's ENTIRE text is
// exactly one of these words — "**build a website**" or "**auto-saved**"
// stay plain bold, since they aren't actually naming the mode.
const FOCUS_MODE_HIGHLIGHT_COLOR: Record<string, keyof Palette> = {
  Quick: "accentBright",
  Build: "link",
  Auto: "warning",
  Gorilla: "danger",
};

/**
 * A real CommonMark renderer (react-native-markdown-display) instead of a
 * hand-rolled line parser — so `## heading`, `---`, and `1. ordered lists`
 * actually render as a heading/divider/list instead of showing their raw
 * markdown characters. Deliberately no custom "circle badge" numbering:
 * ordered list items render as plain "1.", "2." text, matching Claude/GPT.
 */
export function MarkdownAnswer({ text }: { text: string }) {
  const { palette } = useTheme();
  const styles = useMemo(() => markdownStyles(palette), [palette]);
  return (
    <Markdown
      style={styles}
      onLinkPress={(url) => {
        Linking.openURL(url).catch(() => {});
        return false;
      }}
      rules={{
        image: (node) => (
          <Image
            key={node.key}
            source={{ uri: node.attributes.src }}
            style={{ width: "100%", height: 180, borderRadius: radii.md, marginVertical: spacing.sm, backgroundColor: palette.bgCardAlt }}
            resizeMode="cover"
          />
        ),
        strong: (node, children) => {
          const rawText = (node.children as Array<{ content?: string }> | undefined)?.map((c) => c.content ?? "").join("") ?? "";
          const colorKey = FOCUS_MODE_HIGHLIGHT_COLOR[rawText];
          return (
            <Text key={node.key} style={[styles.strong, colorKey && { color: palette[colorKey] as string, fontWeight: "800" }]}>
              {children}
            </Text>
          );
        },
      }}
    >
      {text}
    </Markdown>
  );
}

/**
 * A real gpt-image-2 result (server/src/lib/imageGeneration.ts) — `image.url`
 * is a genuine /uploads/*.png this server generated from the user's prompt,
 * served the same way AttachmentPreview's image attachments are.
 */
function GeneratedImageCard({ image }: { image: { url: string; prompt: string } }) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  return (
    <View style={styles.generatedImageBlock}>
      <Image source={{ uri: `${API_URL}${image.url}` }} style={styles.generatedImage} resizeMode="cover" />
      <Text style={styles.generatedImageCaption} numberOfLines={2}>
        {image.prompt}
      </Text>
    </View>
  );
}

/**
 * Real, tappable "Get directions" rows for places NexaAi actually found
 * (server/src/lib/businessLookup.ts's real seeded results, attached as
 * this message's metadata — see routes/chat.ts's finish()). Tapping one
 * opens the user's chosen Directions app (Settings > Directions app) via
 * lib/maps.ts's openDirections, with the real address/coordinates already
 * filled in — not a generic web link the model guessed at.
 */
function DirectionsList({ businesses }: { businesses: NearbyBusiness[] }) {
  const { palette } = useTheme();
  const { user } = useAuth();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  if (!businesses.length) return null;
  const app: MapsApp = user?.preferredMapsApp ?? "apple";

  return (
    <View style={styles.directionsBlock}>
      <Text style={styles.directionsLabel}>Nearby</Text>
      <View style={styles.directionsCard}>
        {businesses.map((b, i) => (
          <View key={`${b.name}-${i}`} style={[styles.directionsRow, i < businesses.length - 1 && styles.directionsRowDivider]}>
            <View style={styles.directionsRowText}>
              <Text style={styles.directionsName} numberOfLines={1}>
                {b.name}
              </Text>
              <Text style={styles.directionsMeta} numberOfLines={1}>
                {b.distanceKm != null ? `${b.distanceKm.toFixed(1)}km away` : b.address ?? "Distance unknown"}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.directionsButton, { backgroundColor: palette.accent }]}
              onPress={() =>
                openDirections(app, { label: b.name, address: b.address ?? undefined, lat: b.lat ?? undefined, lng: b.lng ?? undefined }).catch(
                  (err) => Alert.alert("Couldn't open directions", err instanceof Error ? err.message : "Try again."),
                )
              }
            >
              <Ionicons name="navigate" size={14} color="#fff" />
              <Text style={styles.directionsButtonText}>Directions</Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * A real "you're picking this conversation back up" divider — inserted by
 * ChatScreen.tsx's openSession only when the gap since the last real
 * message was long enough to actually call this a resumption (not fired on
 * every reopen). `at` is the real live moment this happened, not the old
 * message's own timestamp, so it reads correctly even much later.
 */
function ResumedSessionMarker({ at }: { at: string }) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const label = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(at));
  return (
    <View style={styles.resumedRow}>
      <View style={[styles.resumedLine, { backgroundColor: palette.border }]} />
      <View style={styles.resumedPill}>
        <Ionicons name="refresh" size={12} color={palette.textMuted} />
        <Text style={styles.resumedText}>Resumed session · {label}</Text>
      </View>
      <View style={[styles.resumedLine, { backgroundColor: palette.border }]} />
    </View>
  );
}

interface MessageBubbleProps {
  message: ChatMessageVM;
  /** True while this exact message is still receiving live stream deltas. */
  isStreaming?: boolean;
  /** Assistant avatar mood — "talking" while tokens are arriving or TTS is playing, "happy" once settled. */
  avatarMood?: "idle" | "thinking" | "happy" | "talking";
  /** Renders a thin divider above this message — marks the start of a new turn (a fresh user message after at least one earlier exchange). */
  showSeparatorAbove?: boolean;
  /** The focus mode this reply is running under — only used to pick the honest word for the pre-first-token wait below ("Building" for Build mode, etc.), not a cosmetic label. */
  focusMode?: "quick" | "build" | "auto" | "gorilla";
  /** Real "edit a sent message" — only rendered on the user's own text messages, and only while still inside the 1-minute window (see EDIT_WINDOW_MS). Saving calls this with the new text; the caller (ChatScreen) hits the server, which regenerates the reply against it. */
  onEdit?: (messageId: string, newText: string) => void;
  /** The user's own message this reply is answering — passed through to HelpLinkChip so it can match on the question, not just the answer. */
  precedingUserText?: string;
}

const WAITING_WORD: Record<NonNullable<MessageBubbleProps["focusMode"]>, string> = {
  quick: "Thinking",
  build: "Building",
  auto: "Working",
  gorilla: "Going deep",
};

export function MessageBubble({ message, isStreaming, avatarMood, showSeparatorAbove, focusMode, onEdit, precedingUserText }: MessageBubbleProps) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const isUser = message.role === "user";

  // Real elapsed seconds during the gap between sending and the first
  // stream delta arriving — the network+model latency before there's any
  // real content yet to derive deriveLiveStatus's phrase from. Same honest
  // "still working" pattern as VoiceChatScreen's phaseElapsedSec: a real
  // clock, not a canned "..." with nothing behind it.
  const hasContent = message.content.length > 0;
  const [waitingSec, setWaitingSec] = useState(0);
  useEffect(() => {
    if (!isStreaming || hasContent) {
      setWaitingSec(0);
      return;
    }
    const startedAt = Date.now();
    const interval = setInterval(() => setWaitingSec(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(interval);
  }, [isStreaming, hasContent]);

  // Live countdown for "you can still edit this" — ticks every second so the
  // Edit action disables itself in place once the real 60s deadline passes,
  // without needing a screen refresh. Anchored to the message's own
  // createdAt (never reset by editing), matching the server's own check.
  const [editRemainingMs, setEditRemainingMs] = useState(() =>
    isUser && message.createdAt ? EDIT_WINDOW_MS - (Date.now() - new Date(message.createdAt).getTime()) : 0,
  );
  useEffect(() => {
    if (!isUser || !message.createdAt) return;
    const createdAtMs = new Date(message.createdAt).getTime();
    const tick = () => setEditRemainingMs(EDIT_WINDOW_MS - (Date.now() - createdAtMs));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [isUser, message.createdAt]);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  useEffect(() => {
    if (!editing) setDraft(message.content);
  }, [message.content, editing]);

  const canEdit = isUser && !!onEdit && !message.attachment && (message.kind === undefined || message.kind === "text") && editRemainingMs > 0;

  if (message.sessionResumedAt) {
    return <ResumedSessionMarker at={message.sessionResumedAt} />;
  }

  if (isUser) {
    const saveEdit = () => {
      const trimmed = draft.trim();
      setEditing(false);
      if (!trimmed || trimmed === message.content) return;
      onEdit?.(message.id, trimmed);
    };
    return (
      <>
        {showSeparatorAbove && <View style={[styles.separator, { backgroundColor: palette.border }]} />}
        <FadeInUp style={[styles.row, styles.rowUser]}>
          <View style={styles.userColumn}>
            <View style={[styles.bubble, { backgroundColor: palette.accent }]}>
              {message.attachment && <AttachmentPreview attachment={message.attachment} />}
              {editing ? (
                <TextInput
                  style={styles.editInput}
                  value={draft}
                  onChangeText={setDraft}
                  multiline
                  autoFocus
                  placeholderTextColor="rgba(255,255,255,0.65)"
                />
              ) : (
                <Text style={styles.userText}>{message.content}</Text>
              )}
            </View>
            {editing ? (
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={styles.actionButton}
                  onPress={() => {
                    setDraft(message.content);
                    setEditing(false);
                  }}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Ionicons name="close" size={15} color={palette.textMuted} />
                  <Text style={styles.actionButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionButton} onPress={saveEdit} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                  <Ionicons name="checkmark" size={15} color={palette.accentBright} />
                  <Text style={[styles.actionButtonText, { color: palette.accentBright }]}>Save & re-ask</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.actionRow}>
                <CopyButton text={message.content} />
                <ShareButton text={message.content} role="user" />
                {canEdit && (
                  <TouchableOpacity style={styles.actionButton} onPress={() => setEditing(true)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                    <Ionicons name="pencil-outline" size={15} color={palette.textMuted} />
                    <Text style={styles.actionButtonText}>Edit · {Math.max(1, Math.ceil(editRemainingMs / 1000))}s</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        </FadeInUp>
      </>
    );
  }

  // Assistant replies render as plain text directly on the background —
  // no card, no border, no bubble — exactly like Claude/ChatGPT. Only the
  // user's own messages get a bubble (above).
  return (
    <>
      {showSeparatorAbove && <View style={[styles.separator, { backgroundColor: palette.border }]} />}
      <FadeInUp style={[styles.row, styles.rowAssistant]}>
        <BotAvatar size={32} mood={avatarMood ?? "happy"} />
        <View style={styles.assistantContent}>
          {message.attachment && <AttachmentPreview attachment={message.attachment} />}
          {!!message.metadata?.videoFrames?.length && <VideoFrameBreakdown frames={message.metadata.videoFrames} />}
          {isStreaming ? (
            <View>
              <Text style={styles.bodyText}>
                {message.content}
                <BlinkingCursor />
              </Text>
              <Text style={[styles.liveStatus, { color: palette.accentBright }]}>
                {hasContent
                  ? deriveLiveStatus(message.content)
                  : `${WAITING_WORD[focusMode ?? "quick"]}${waitingSec > 0 ? ` · ${waitingSec}s` : ""}`}
              </Text>
            </View>
          ) : (() => {
            const profile = parseWhoIsProfile(message.content);
            if (profile) return <WhoIsProfileCard profile={profile} />;
            const { mainText, sources } = extractSources(message.content);
            return (
              <>
                <MarkdownAnswer text={mainText} />
                <SourceLinksList sources={sources} />
              </>
            );
          })()}
          {message.metadata?.businesses && <DirectionsList businesses={message.metadata.businesses} />}
          {message.metadata?.generatedImage && <GeneratedImageCard image={message.metadata.generatedImage} />}
          {!isStreaming && !parseWhoIsProfile(message.content) && <HelpLinkChip userText={precedingUserText} />}
          {!isStreaming && (
            <View style={styles.actionRow}>
              <CopyButton text={message.content} />
              <ShareButton text={message.content} role="assistant" />
              <ListenButton text={message.content} />
              <ReportIssueButton messageId={message.id} />
            </View>
          )}
        </View>
      </FadeInUp>
    </>
  );
}

function markdownStyles(palette: Palette) {
  return {
    body: { ...typography.body, color: palette.textPrimary },
    heading1: { ...typography.h2, color: palette.accentBright, marginTop: spacing.sm, marginBottom: 4 },
    heading2: { ...typography.h2, fontSize: 17, color: palette.accentBright, marginTop: spacing.sm, marginBottom: 4 },
    heading3: { ...typography.bodyBold, color: palette.accentBright, marginTop: spacing.sm, marginBottom: 4 },
    heading4: { ...typography.bodyBold, color: palette.textPrimary, marginTop: spacing.sm, marginBottom: 4 },
    strong: { ...typography.bodyBold, color: palette.textPrimary },
    em: { fontStyle: "italic" as const, color: palette.textSecondary },
    paragraph: { marginTop: 0, marginBottom: spacing.sm },
    hr: { backgroundColor: palette.divider, height: 1, marginVertical: spacing.sm },
    bullet_list: { marginBottom: spacing.sm },
    ordered_list: { marginBottom: spacing.sm },
    list_item: { ...typography.body, color: palette.textPrimary, marginBottom: 4 },
    bullet_list_icon: { color: palette.textSecondary, marginRight: spacing.sm },
    ordered_list_icon: { ...typography.body, color: palette.textSecondary, marginRight: spacing.sm, minWidth: 20 },
    code_inline: {
      ...typography.caption,
      backgroundColor: palette.bgCardAlt,
      color: palette.accentBright,
      borderRadius: 4,
      paddingHorizontal: 4,
    },
    code_block: { ...typography.caption, backgroundColor: palette.bgCardAlt, color: palette.textPrimary, borderRadius: radii.md, padding: spacing.sm },
    fence: { ...typography.caption, backgroundColor: palette.bgCardAlt, color: palette.textPrimary, borderRadius: radii.md, padding: spacing.sm },
    blockquote: {
      backgroundColor: "transparent",
      borderLeftWidth: 2,
      borderLeftColor: palette.border,
      paddingLeft: spacing.sm,
      marginVertical: spacing.xs,
    },
    link: { color: palette.link, textDecorationLine: "underline" as const },
  };
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    separator: { height: 2, alignSelf: "stretch", marginVertical: spacing.lg, borderRadius: 1, opacity: 1 },
    row: { flexDirection: "row", gap: spacing.sm, marginVertical: spacing.sm, alignItems: "flex-end" },
    rowUser: { justifyContent: "flex-end" },
    rowAssistant: { justifyContent: "flex-start", alignItems: "flex-start" },
    bubble: { borderRadius: radii.lg, borderTopRightRadius: radii.sm, padding: spacing.md },
    userColumn: { maxWidth: "82%", alignItems: "flex-end", gap: 4 },
    assistantContent: { flex: 1, paddingTop: 2 },
    userText: { ...typography.body, color: "#FFFFFF" },
    editInput: { ...typography.body, color: "#FFFFFF", padding: 0, minWidth: 140 },
    bodyText: { ...typography.body, color: palette.textPrimary },
    liveStatus: { ...typography.caption, fontStyle: "italic", marginTop: 4 },
    cursor: { fontWeight: "700" },
    actionRow: { flexDirection: "row", gap: spacing.md, marginTop: 2 },
    helpLinkChip: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-start",
      gap: 5,
      borderWidth: 1,
      borderRadius: radii.pill,
      paddingHorizontal: spacing.sm,
      paddingVertical: 5,
      marginTop: spacing.sm,
    },
    helpLinkChipText: { ...typography.caption, fontWeight: "600" as const },
    // Rendered but visually off-screen — react-native-view-shot needs the
    // ShareCard actually laid out in the DOM/view tree to snapshot it.
    hiddenCardHost: { position: "absolute", top: 0, left: -9999, opacity: 0.01 },
    actionButton: { flexDirection: "row", alignItems: "center", gap: 3, paddingVertical: 2 },
    listenControls: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    actionButtonText: { ...typography.caption, color: palette.textMuted },

    reportOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
    reportCard: { width: "100%", maxWidth: 380, backgroundColor: palette.bgCard, borderRadius: radii.lg, borderWidth: 1, borderColor: palette.border, padding: spacing.lg, gap: spacing.sm },
    reportTitle: { ...typography.h2, color: palette.textPrimary },
    reportSubtitle: { ...typography.caption, color: palette.textMuted, lineHeight: 17 },
    reportInput: {
      ...typography.body,
      color: palette.textPrimary,
      backgroundColor: palette.bgCardAlt,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.md,
      padding: spacing.sm,
      minHeight: 90,
      textAlignVertical: "top",
    },
    reportButtonRow: { flexDirection: "row", gap: spacing.sm, marginTop: 4 },
    reportCancelButton: { flex: 1, alignItems: "center", paddingVertical: spacing.sm, borderRadius: radii.md, borderWidth: 1, borderColor: palette.border },
    reportCancelText: { ...typography.bodyBold, color: palette.textSecondary },
    reportSubmitButton: { flex: 1, alignItems: "center", paddingVertical: spacing.sm, borderRadius: radii.md, backgroundColor: palette.accent },
    reportSubmitText: { ...typography.bodyBold, color: "#fff" },
    attachmentImage: { width: "100%", height: 160, borderRadius: radii.md, marginBottom: spacing.sm, backgroundColor: palette.bgCardAlt },
    attachmentFile: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: palette.bgCardAlt,
      borderRadius: radii.md,
      padding: spacing.sm,
      marginBottom: spacing.sm,
    },
    attachmentFileName: { ...typography.caption, color: palette.textPrimary, flex: 1 },
    attachmentFileSize: { ...typography.caption, color: palette.textMuted },

    directionsBlock: { marginTop: spacing.md, gap: 6 },
    directionsLabel: { ...typography.sectionLabel, color: palette.textMuted, textTransform: "uppercase" },
    directionsCard: { backgroundColor: palette.bgCard, borderRadius: radii.md, borderWidth: 1, borderColor: palette.border, overflow: "hidden" },
    directionsRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.sm },
    directionsRowDivider: { borderBottomWidth: 1, borderBottomColor: palette.divider },
    directionsRowText: { flex: 1, gap: 1 },
    directionsName: { ...typography.bodyBold, color: palette.textPrimary },
    directionsMeta: { ...typography.caption, color: palette.textMuted },
    directionsButton: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: radii.pill, paddingVertical: 6, paddingHorizontal: spacing.sm },
    directionsButtonText: { ...typography.caption, color: "#fff", fontWeight: "700" },

    generatedImageBlock: { marginTop: spacing.md, gap: 6 },
    generatedImage: { width: "100%", aspectRatio: 1, borderRadius: radii.md, backgroundColor: palette.bgCardAlt },
    generatedImageCaption: { ...typography.caption, color: palette.textMuted },

    resumedRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginVertical: spacing.lg },
    resumedLine: { flex: 1, height: 1, opacity: 0.8 },
    resumedPill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.pill,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    resumedText: { ...typography.caption, color: palette.textMuted, fontSize: 11 },
  });
}
