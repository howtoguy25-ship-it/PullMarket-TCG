import React, { useEffect, useMemo, useRef } from "react";
import { Animated, Image, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { API_URL } from "../lib/api";
import { radii, spacing, typography } from "../theme/colors";
import { useTheme } from "../lib/ThemeContext";
import type { Palette } from "../theme/palettes";
import { BotAvatar } from "./BotAvatar";
import { FadeInUp } from "./FadeInUp";
import { parseWhoIsProfile, WhoIsProfileCard } from "./WhoIsProfileCard";
import { deriveLiveStatus } from "../lib/liveStatus";

export interface MessageAttachment {
  url: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  kind: "image" | "video" | "file";
}

export interface ChatMessageVM {
  id: string;
  role: "user" | "assistant";
  content: string;
  kind?: string;
  attachment?: MessageAttachment;
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

/** A steadily blinking text-cursor, shown at the end of a message still streaming in. */
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

/**
 * Renders assistant text with light markdown-ish styling: **bold** headings
 * and lines starting with a number become a visually distinct step list,
 * matching the "highlighted in bold letters with description/instructions"
 * layout from the product spec.
 */
const PHOTO_LINE = /^!\[(.*?)\]\((https?:\/\/[^\s)]+)\)$/;

function FormattedAnswer({ text }: { text: string }) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  // The model doesn't always put a photo markdown line on its own line (e.g.
  // it can land right after an italicized lead-in with no newline between) —
  // force one so the PHOTO_LINE match below (which requires the whole line)
  // still catches it instead of showing raw "![alt](url)" as plain text.
  const normalized = text.replace(/([^\n])(!\[[^\]]*\]\(https?:\/\/[^\s)]+\))/g, "$1\n$2");
  const lines = normalized.split("\n");

  // Group consecutive real image lines (who-is's single attributed photo,
  // or the "Real images for topics" capability's 1-2 web_search results —
  // shared/src/nexaPersona.ts's WHO_IS_FORMAT / TOPIC_IMAGES_ADDENDUM) into
  // one neat row instead of stacking each as its own full-width block.
  type Block = { kind: "line"; line: string; key: number } | { kind: "photos"; photos: { alt: string; url: string }[]; key: number };
  const blocks: Block[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].trim().match(PHOTO_LINE);
    if (match) {
      const last = blocks[blocks.length - 1];
      if (last?.kind === "photos") last.photos.push({ alt: match[1], url: match[2] });
      else blocks.push({ kind: "photos", photos: [{ alt: match[1], url: match[2] }], key: i });
    } else {
      blocks.push({ kind: "line", line: lines[i], key: i });
    }
  }

  return (
    <View>
      {blocks.map((block) => {
        if (block.kind === "photos") {
          return (
            <View key={block.key} style={styles.photoGrid}>
              {block.photos.map((photo, j) => (
                <View key={j} style={styles.photoGridItem}>
                  <Image source={{ uri: photo.url }} style={styles.photoGridImage} resizeMode="cover" />
                  {photo.alt && (
                    <Text style={styles.photoGridCaption} numberOfLines={1}>
                      {photo.alt}
                    </Text>
                  )}
                </View>
              ))}
            </View>
          );
        }
        const { line, key: i } = block;
        const trimmed = line.trim();
        if (!trimmed) return <View key={i} style={{ height: 6 }} />;
        const boldMatch = trimmed.match(/^\*\*(.+)\*\*$/);
        if (boldMatch) {
          return (
            <Text key={i} style={[styles.heading, { color: palette.accentBright }]}>
              {boldMatch[1]}
            </Text>
          );
        }
        const stepMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
        if (stepMatch) {
          return (
            <View key={i} style={styles.stepRow}>
              <View style={[styles.stepBadge, { backgroundColor: palette.accent }]}>
                <Text style={styles.stepBadgeText}>{stepMatch[1]}</Text>
              </View>
              <Text style={styles.stepText}>{stepMatch[2]}</Text>
            </View>
          );
        }
        if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
          return (
            <View key={i} style={styles.imageHint}>
              <Text style={styles.imageHintText}>🖼 {trimmed.slice(1, -1)}</Text>
            </View>
          );
        }
        if (trimmed.startsWith("_") && trimmed.endsWith("_")) {
          return (
            <Text key={i} style={styles.italic}>
              {trimmed.slice(1, -1)}
            </Text>
          );
        }
        return (
          <Text key={i} style={styles.bodyText}>
            {trimmed.replace(/\*\*(.+?)\*\*/g, "$1")}
          </Text>
        );
      })}
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
}

export function MessageBubble({ message, isStreaming, avatarMood, showSeparatorAbove }: MessageBubbleProps) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const isUser = message.role === "user";
  return (
    <>
      {showSeparatorAbove && <View style={[styles.separator, { backgroundColor: palette.border }]} />}
      <FadeInUp style={[styles.row, isUser ? styles.rowUser : styles.rowAssistant]}>
        {!isUser && <BotAvatar size={32} mood={avatarMood ?? "happy"} />}
        <View style={[styles.bubble, isUser ? [styles.bubbleUser, { backgroundColor: palette.accent }] : styles.bubbleAssistant]}>
          {message.attachment && <AttachmentPreview attachment={message.attachment} />}
          {isUser ? (
            <Text style={styles.userText}>{message.content}</Text>
          ) : isStreaming ? (
            <View>
              <Text style={styles.bodyText}>
                {message.content}
                <BlinkingCursor />
              </Text>
              {message.content.length > 0 && (
                <Text style={[styles.liveStatus, { color: palette.accentBright }]}>{deriveLiveStatus(message.content)}</Text>
              )}
            </View>
          ) : (() => {
            const profile = parseWhoIsProfile(message.content);
            return profile ? <WhoIsProfileCard profile={profile} /> : <FormattedAnswer text={message.content} />;
          })()}
        </View>
      </FadeInUp>
    </>
  );
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    separator: { height: 1, alignSelf: "stretch", marginVertical: spacing.md, opacity: 0.6 },
    row: { flexDirection: "row", gap: spacing.sm, marginVertical: spacing.sm, alignItems: "flex-end" },
    rowUser: { justifyContent: "flex-end" },
    rowAssistant: { justifyContent: "flex-start" },
    bubble: { maxWidth: "82%", borderRadius: radii.lg, padding: spacing.md },
    bubbleUser: { borderTopRightRadius: radii.sm },
    bubbleAssistant: { backgroundColor: palette.bgCard, borderTopLeftRadius: radii.sm, borderWidth: 1, borderColor: palette.border },
    userText: { ...typography.body, color: "#FFFFFF" },
    bodyText: { ...typography.body, color: palette.textPrimary, marginBottom: 2 },
    liveStatus: { ...typography.caption, fontStyle: "italic", marginTop: 4 },
    heading: { ...typography.bodyBold, marginTop: spacing.sm, marginBottom: 2 },
    italic: { ...typography.body, color: palette.textSecondary, fontStyle: "italic", marginBottom: 6 },
    stepRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start", marginVertical: 2 },
    stepBadge: { width: 20, height: 20, borderRadius: radii.pill, alignItems: "center", justifyContent: "center", marginTop: 1 },
    stepBadgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
    stepText: { ...typography.body, color: palette.textPrimary, flex: 1 },
    imageHint: { backgroundColor: palette.bgCardAlt, borderRadius: radii.sm, padding: spacing.sm, marginVertical: 4 },
    imageHintText: { ...typography.caption, color: palette.textMuted },
    cursor: { fontWeight: "700" },
    attachmentImage: { width: "100%", height: 160, borderRadius: radii.md, marginBottom: spacing.sm, backgroundColor: palette.bgCardAlt },
    photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginVertical: spacing.sm },
    photoGridItem: { flexGrow: 1, minWidth: "45%" },
    photoGridImage: { width: "100%", height: 140, borderRadius: radii.md, backgroundColor: palette.bgCardAlt },
    photoGridCaption: { ...typography.caption, color: palette.textMuted, marginTop: 4 },
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
  });
}
