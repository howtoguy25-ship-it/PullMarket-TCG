import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, radii, spacing, typography } from "../theme/colors";
import { BotAvatar } from "./BotAvatar";

export interface ChatMessageVM {
  id: string;
  role: "user" | "assistant";
  content: string;
  kind?: string;
}

/**
 * Renders assistant text with light markdown-ish styling: **bold** headings
 * and lines starting with a number become a visually distinct step list,
 * matching the "highlighted in bold letters with description/instructions"
 * layout from the product spec.
 */
function FormattedAnswer({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <View>
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return <View key={i} style={{ height: 6 }} />;
        const boldMatch = trimmed.match(/^\*\*(.+)\*\*$/);
        if (boldMatch) {
          return (
            <Text key={i} style={styles.heading}>
              {boldMatch[1]}
            </Text>
          );
        }
        const stepMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
        if (stepMatch) {
          return (
            <View key={i} style={styles.stepRow}>
              <View style={styles.stepBadge}>
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

export function MessageBubble({ message }: { message: ChatMessageVM }) {
  const isUser = message.role === "user";
  return (
    <View style={[styles.row, isUser ? styles.rowUser : styles.rowAssistant]}>
      {!isUser && <BotAvatar size={32} mood="happy" />}
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
        {isUser ? <Text style={styles.userText}>{message.content}</Text> : <FormattedAnswer text={message.content} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing.sm, marginVertical: spacing.sm, alignItems: "flex-end" },
  rowUser: { justifyContent: "flex-end" },
  rowAssistant: { justifyContent: "flex-start" },
  bubble: { maxWidth: "82%", borderRadius: radii.lg, padding: spacing.md },
  bubbleUser: { backgroundColor: colors.accent, borderTopRightRadius: radii.sm },
  bubbleAssistant: { backgroundColor: colors.bgCard, borderTopLeftRadius: radii.sm, borderWidth: 1, borderColor: colors.border },
  userText: { ...typography.body, color: "#FFFFFF" },
  bodyText: { ...typography.body, color: colors.textPrimary, marginBottom: 2 },
  heading: { ...typography.bodyBold, color: colors.accentBright, marginTop: spacing.sm, marginBottom: 2 },
  italic: { ...typography.body, color: colors.textSecondary, fontStyle: "italic", marginBottom: 6 },
  stepRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start", marginVertical: 2 },
  stepBadge: { width: 20, height: 20, borderRadius: radii.pill, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", marginTop: 1 },
  stepBadgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  stepText: { ...typography.body, color: colors.textPrimary, flex: 1 },
  imageHint: { backgroundColor: colors.bgCardAlt, borderRadius: radii.sm, padding: spacing.sm, marginVertical: 4 },
  imageHintText: { ...typography.caption, color: colors.textMuted },
});
