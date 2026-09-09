import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { BotAvatar } from "./BotAvatar";
import { typography } from "../theme/colors";
import { useTheme } from "../lib/ThemeContext";
import type { Palette } from "../theme/palettes";

const DEFAULT_PHRASES = [
  "Thinking…",
  "Ooohhh…",
  "Tinkering…",
  "Gathering info…",
  "NexaAi is laying it all out…",
];

/** Live animated "thinking" state shown between sending a message and getting a reply. Pass `phrases` to swap in a mode-specific set (e.g. the who-is deep dive's "Searching the web…"). */
export function ThinkingIndicator({ phrases = DEFAULT_PHRASES }: { phrases?: string[] }) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [phraseIndex, setPhraseIndex] = useState(0);
  const fade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const interval = setInterval(() => {
      Animated.sequence([
        Animated.timing(fade, { toValue: 0, duration: 180, useNativeDriver: true }),
        Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }),
      ]).start();
      setTimeout(() => setPhraseIndex((i) => (i + 1) % phrases.length), 180);
    }, 1400);
    return () => clearInterval(interval);
  }, [fade, phrases]);

  return (
    <View style={styles.row}>
      <BotAvatar size={40} mood="thinking" />
      <Animated.Text style={[styles.text, { opacity: fade }]}>{phrases[phraseIndex % phrases.length]}</Animated.Text>
    </View>
  );
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: 4 },
    text: { ...typography.body, color: palette.textSecondary, fontStyle: "italic" },
  });
}
