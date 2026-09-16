import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../lib/ThemeContext";
import type { Palette } from "../theme/palettes";

/**
 * Real "NexaAi is actively working on the previous message" indicator/stop
 * control — sits in the composer's send-button slot in place of the arrow
 * while a reply is streaming and the user hasn't typed anything new yet.
 * The moment they start typing, ChatScreen swaps this back out for a real,
 * enabled send button (queues the new message instead of sending
 * immediately — see ChatScreen.tsx's send()/queue).
 *
 * Genuinely tappable now: `onStop` is ChatScreen's real `stop()`, which
 * aborts the actual in-flight fetch — and, for the streaming route, the
 * server's own upstream Anthropic/self-hosted call too, since the route
 * aborts its own request signal the instant the connection drops (see
 * server/src/routes/chat.ts's `/messages/stream`). Not a fake control.
 * Shows the animated "working" dots at rest, and a stop icon on press so
 * the tap registers as intentional rather than looking like nothing
 * happened.
 */
export function ActiveRunIndicator({ onStop }: { onStop: () => void }) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [pressed, setPressed] = useState(false);
  const dots = [useRef(new Animated.Value(0.3)).current, useRef(new Animated.Value(0.3)).current, useRef(new Animated.Value(0.3)).current];

  useEffect(() => {
    const loops = dots.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 150),
          Animated.timing(dot, { toValue: 1, duration: 350, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0.3, duration: 350, useNativeDriver: true }),
          Animated.delay((2 - i) * 150),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <TouchableOpacity
      style={styles.box}
      testID="chat-run-box"
      accessibilityLabel="Stop generating"
      accessibilityRole="button"
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onPress={onStop}
    >
      {pressed ? (
        <Ionicons name="stop" size={16} color={palette.danger} />
      ) : (
        dots.map((dot, i) => <Animated.View key={i} style={[styles.dot, { opacity: dot, backgroundColor: palette.accentBright }]} />)
      )}
    </TouchableOpacity>
  );
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    box: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: palette.bgCard,
      borderWidth: 1,
      borderColor: palette.border,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 3,
    },
    dot: { width: 5, height: 5, borderRadius: 3 },
  });
}
