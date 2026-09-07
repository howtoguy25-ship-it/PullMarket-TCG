import React, { useEffect, useRef } from "react";
import { Animated, Image, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { API_URL } from "../lib/api";
import { colors, radii, spacing, typography } from "../theme/colors";
import { useTheme } from "../lib/ThemeContext";
import { BotAvatar } from "./BotAvatar";

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
  const sizeLabel =
    attachment.sizeBytes > 1024 * 1024 * 1024
      ? `${(attachment.sizeBytes / (1024 * 1024 * 1024)).toFixed(1)}GB`
      : `${(attachment.sizeBytes / (1024 * 1024)).toFixed(1)}MB`;

  if (attachment.kind === "image") {
    return <Image source={{ uri: `${API_URL}${attachment.url}` }} style={styles.attachmentImage} resizeMode="cover" />;
  }
  return (
    <View style={styles.attachmentFile}>
      <Ionicons name={ATTACHMENT_ICON[attachment.kind]} size={18} color={colors.textSecondary} />
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
function FormattedAnswer({ text }: { text: string }) {
  const { palette } = useTheme();
  const lines = text.split("\n");
  return (
    <View>
      {lines.map((line, i) => {
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
}

export function MessageBubble({ message, isStreaming, avatarMood }: MessageBubbleProps) {
  const { palette } = useTheme();
  const isUser = message.role === "user";
  return (
    <View style={[styles.row, isUser ? styles.rowUser : styles.rowAssistant]}>
      {!isUser && <BotAvatar size={32} mood={avatarMood ?? "happy"} />}
      <View style={[styles.bubble, isUser ? [styles.bubbleUser, { backgroundColor: palette.accent }] : styles.bubbleAssistant]}>
        {message.attachment && <AttachmentPreview attachment={message.attachment} />}
        {isUser ? (
          <Text style={styles.userText}>{message.content}</Text>
        ) : isStreaming ? (
          <Text style={styles.bodyText}>
            {message.content}
            <BlinkingCursor />
          </Text>
        ) : (
          <FormattedAnswer text={message.content} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing.sm, marginVertical: spacing.sm, alignItems: "flex-end" },
  rowUser: { justifyContent: "flex-end" },
  rowAssistant: { justifyContent: "flex-start" },
  bubble: { maxWidth: "82%", borderRadius: radii.lg, padding: spacing.md },
  bubbleUser: { borderTopRightRadius: radii.sm },
  bubbleAssistant: { backgroundColor: colors.bgCard, borderTopLeftRadius: radii.sm, borderWidth: 1, borderColor: colors.border },
  userText: { ...typography.body, color: "#FFFFFF" },
  bodyText: { ...typography.body, color: colors.textPrimary, marginBottom: 2 },
  heading: { ...typography.bodyBold, marginTop: spacing.sm, marginBottom: 2 },
  italic: { ...typography.body, color: colors.textSecondary, fontStyle: "italic", marginBottom: 6 },
  stepRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start", marginVertical: 2 },
  stepBadge: { width: 20, height: 20, borderRadius: radii.pill, alignItems: "center", justifyContent: "center", marginTop: 1 },
  stepBadgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  stepText: { ...typography.body, color: colors.textPrimary, flex: 1 },
  imageHint: { backgroundColor: colors.bgCardAlt, borderRadius: radii.sm, padding: spacing.sm, marginVertical: 4 },
  imageHintText: { ...typography.caption, color: colors.textMuted },
  cursor: { fontWeight: "700" },
  attachmentImage: { width: "100%", height: 160, borderRadius: radii.md, marginBottom: spacing.sm, backgroundColor: colors.bgCardAlt },
  attachmentFile: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.bgCardAlt,
    borderRadius: radii.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  attachmentFileName: { ...typography.caption, color: colors.textPrimary, flex: 1 },
  attachmentFileSize: { ...typography.caption, color: colors.textMuted },
});
