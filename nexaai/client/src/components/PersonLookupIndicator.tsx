import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { FontAwesome5 } from "@expo/vector-icons";
import { typography, spacing } from "../theme/colors";
import { useTheme } from "../lib/ThemeContext";
import type { Palette } from "../theme/palettes";

const SOURCES: { key: string; icon: keyof typeof FontAwesome5.glyphMap; label: string }[] = [
  { key: "instagram", icon: "instagram", label: "Checking Instagram…" },
  { key: "snapchat", icon: "snapchat", label: "Checking Snapchat…" },
  { key: "safari", icon: "safari", label: "Searching the web…" },
  { key: "whatsapp", icon: "whatsapp", label: "Checking WhatsApp…" },
];

/**
 * Web person lookup's live "gathering info" animation — cycles through the
 * real sources this mode actually draws from (web search, and whichever
 * social platforms a confirmed account might live on), highlighting one at
 * a time. Purely a progress indicator: it does not imply the search
 * literally queried each platform's own API, only that the real web search
 * this mode runs may surface accounts on any of these.
 */
export function PersonLookupIndicator() {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [active, setActive] = useState(0);
  const scale = useRef(new Animated.Value(1)).current;

  // A real elapsed clock, not a decorative spinner with nothing behind it —
  // the same honest "still working" pattern used during chat/voice waits
  // elsewhere in the app (see MessageBubble's waitingSec).
  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    const startedAt = Date.now();
    const interval = setInterval(() => setElapsedSec(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setActive((i) => (i + 1) % SOURCES.length), 950);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    scale.setValue(0.85);
    Animated.spring(scale, { toValue: 1, friction: 5, useNativeDriver: true }).start();
  }, [active, scale]);

  return (
    <View style={styles.container}>
      <View style={styles.iconRow}>
        {SOURCES.map((source, i) => {
          const isActive = i === active;
          return (
            <Animated.View
              key={source.key}
              style={[styles.iconWrap, { backgroundColor: isActive ? palette.accent : palette.bgCardAlt }, isActive && { transform: [{ scale }] }]}
            >
              <FontAwesome5 name={source.icon} size={16} color={isActive ? "#FFFFFF" : palette.textMuted} />
            </Animated.View>
          );
        })}
      </View>
      <Text style={styles.label}>
        {SOURCES[active].label}
        {elapsedSec > 0 ? ` · ${elapsedSec}s` : ""}
      </Text>
    </View>
  );
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    container: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.md },
    iconRow: { flexDirection: "row", gap: spacing.sm },
    iconWrap: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
    label: { ...typography.caption, color: palette.textSecondary },
  });
}
