import React, { useMemo } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { spacing, typography } from "../theme/colors";
import { useTheme } from "../lib/ThemeContext";
import type { Palette } from "../theme/palettes";

/** One real sampled video still in the live/persisted frame-by-frame breakdown. `thumbnailUri` only exists client-side during/just after a live send — history reloads carry the real timestamp + description only (see server/src/lib/videoFrames.ts's VideoFrameBreakdownEntry — thumbnails are never persisted, to keep message rows small). An empty-string `description` means the real Claude vision call for that frame hasn't finished yet. */
export interface VideoFrameBreakdownItem {
  index: number;
  timestampSeconds: number;
  description: string;
  thumbnailUri?: string;
}

/** Real "1:07" / "0:04" elapsed-position formatting — not a frame index, an actual position in the source video. */
function formatTimestamp(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * "NexaAi is watching" — a vertical timeline of the real frames sampled from
 * an attached video, each with its actual elapsed-time position and a real
 * live Claude-vision description of what that still shows. Rendered both
 * while a send is still streaming (frames/descriptions arrive one at a
 * time — see ChatScreen's onVideoFrame/onVideoFrameDescription) and after
 * reload from persisted history (timestamp + description only).
 */
export function VideoFrameBreakdown({ frames }: { frames: VideoFrameBreakdownItem[] }) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  if (!frames.length) return null;
  const sorted = [...frames].sort((a, b) => a.index - b.index);

  return (
    <View style={styles.block}>
      <View style={styles.headerRow}>
        <Ionicons name="film-outline" size={13} color={palette.accentBright} />
        <Text style={styles.headerLabel}>WATCHING THE VIDEO</Text>
        <View style={styles.headerRule} />
      </View>

      {sorted.map((frame, i) => {
        const isLast = i === sorted.length - 1;
        const pending = frame.description.length === 0;
        return (
          <View key={frame.index} style={styles.entryRow}>
            <View style={styles.railCol}>
              <View style={[styles.railDot, pending && styles.railDotPending]} />
              {!isLast && <View style={styles.railLine} />}
            </View>

            <View style={[styles.entryCard, isLast && styles.entryCardLast]}>
              <View style={styles.entryHeaderRow}>
                <Text style={styles.entryTimestamp}>{formatTimestamp(frame.timestampSeconds)}</Text>
                <Text style={styles.entryFrameLabel}>Frame {frame.index + 1}</Text>
              </View>

              {frame.thumbnailUri && (
                <Image source={{ uri: frame.thumbnailUri }} style={styles.entryThumbnail} resizeMode="cover" />
              )}

              <View style={styles.entryDivider} />

              <Text style={[styles.entryDescription, pending && styles.entryDescriptionPending]}>
                {pending ? "Looking closely at this moment…" : frame.description}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    block: { marginTop: spacing.sm, marginBottom: 2, gap: 0 },
    headerRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: spacing.sm },
    headerLabel: { ...typography.caption, color: palette.accentBright, fontWeight: "700", fontSize: 10, letterSpacing: 0.8 },
    headerRule: { flex: 1, height: 1, backgroundColor: palette.border, opacity: 0.8, marginLeft: 4 },

    entryRow: { flexDirection: "row", gap: spacing.sm },
    // The vertical rail: a dot per frame connected by a real line — the
    // "custom style separation" between each frame's card, not just margin.
    railCol: { width: 14, alignItems: "center" },
    railDot: {
      width: 9,
      height: 9,
      borderRadius: 5,
      backgroundColor: palette.accentBright,
      marginTop: 14,
    },
    railDotPending: { backgroundColor: palette.textMuted },
    railLine: { width: 2, flex: 1, backgroundColor: palette.border, opacity: 0.8, marginVertical: 2, borderRadius: 1 },

    entryCard: {
      flex: 1,
      backgroundColor: palette.bgCardAlt,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: 10,
      padding: spacing.sm,
      marginBottom: spacing.sm,
      gap: 6,
    },
    entryCardLast: { marginBottom: spacing.sm },
    entryHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    entryTimestamp: { ...typography.caption, color: palette.textPrimary, fontWeight: "700", fontVariant: ["tabular-nums"] },
    entryFrameLabel: {
      ...typography.caption,
      color: palette.textMuted,
      fontSize: 10,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    entryThumbnail: { width: "100%", aspectRatio: 16 / 9, borderRadius: 8, backgroundColor: palette.border },
    entryDivider: { height: 1, backgroundColor: palette.border, opacity: 0.6 },
    entryDescription: { ...typography.caption, color: palette.textSecondary, lineHeight: 18 },
    entryDescriptionPending: { color: palette.textMuted, fontStyle: "italic" },
  });
}
