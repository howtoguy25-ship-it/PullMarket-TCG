import React, { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { radii, spacing, typography } from "../theme/colors";
import { useTheme } from "../lib/ThemeContext";
import type { Palette } from "../theme/palettes";
import { parseBuildFileTasks } from "../lib/buildTaskParser";
import { FadeInUp } from "./FadeInUp";

/**
 * A real, live task-by-task checklist for a streaming build_project reply —
 * parsed straight from the actual streaming text (parseBuildFileTasks), not
 * a simulated progress bar. Each file appears the moment its real fence
 * opens and flips to a checkmark the moment its real fence closes.
 */
export function LiveBuildTaskList({ streamingText }: { streamingText: string }) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const tasks = useMemo(() => parseBuildFileTasks(streamingText), [streamingText]);
  if (tasks.length === 0) return null;

  return (
    <View style={styles.card}>
      {tasks.map((task, i) => (
        // Keyed by index only (not path) — the same in-progress file's row
        // must stay mounted as its own content grows, only mounting fresh
        // (and re-animating in) when a genuinely new file starts.
        <FadeInUp key={i}>
          <TaskRow task={task} palette={palette} styles={styles} />
        </FadeInUp>
      ))}
    </View>
  );
}

function TaskRow({ task, palette, styles }: { task: ReturnType<typeof parseBuildFileTasks>[number]; palette: Palette; styles: ReturnType<typeof makeStyles> }) {
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (task.done) return;
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [task.done, spin]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  return (
    <View style={styles.row}>
      {task.done ? (
        <View style={[styles.iconWrap, { backgroundColor: palette.success }]}>
          <Ionicons name="checkmark" size={13} color="#FFFFFF" />
        </View>
      ) : (
        <Animated.View style={[styles.iconWrap, styles.iconWrapWriting, { borderColor: palette.accentBright, transform: [{ rotate }] }]}>
          <Ionicons name="sync-outline" size={12} color={palette.accentBright} />
        </Animated.View>
      )}
      <Text style={[styles.path, { color: task.done ? palette.textPrimary : palette.accentBright }]} numberOfLines={1}>
        {task.path}
      </Text>
      <Text style={styles.meta}>{task.done ? `${task.lineCount} lines` : "writing…"}</Text>
    </View>
  );
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    card: {
      backgroundColor: palette.bgCardAlt,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.border,
      padding: spacing.sm,
      gap: 6,
      marginBottom: spacing.sm,
    },
    row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    iconWrap: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
    iconWrapWriting: { borderWidth: 1.5, backgroundColor: "transparent" },
    path: { ...typography.caption, fontWeight: "600" as const, flex: 1 },
    meta: { ...typography.caption, color: palette.textMuted },
  });
}
