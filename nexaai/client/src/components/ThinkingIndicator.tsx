import React, { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { BotAvatar } from "./BotAvatar";
import { colors, typography } from "../theme/colors";

const PHRASES = [
  "Thinking…",
  "Ooohhh…",
  "Tinkering…",
  "Gathering info…",
  "NexaAi is laying it all out…",
];

/** Live animated "thinking" state shown between sending a message and getting a reply. */
export function ThinkingIndicator() {
  const [phraseIndex, setPhraseIndex] = useState(0);
  const fade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const interval = setInterval(() => {
      Animated.sequence([
        Animated.timing(fade, { toValue: 0, duration: 180, useNativeDriver: true }),
        Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }),
      ]).start();
      setTimeout(() => setPhraseIndex((i) => (i + 1) % PHRASES.length), 180);
    }, 1400);
    return () => clearInterval(interval);
  }, [fade]);

  return (
    <View style={styles.row}>
      <BotAvatar size={40} mood="thinking" />
      <Animated.Text style={[styles.text, { opacity: fade }]}>{PHRASES[phraseIndex]}</Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: 4 },
  text: { ...typography.body, color: colors.textSecondary, fontStyle: "italic" },
});
