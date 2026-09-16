import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, TouchableOpacity } from "react-native";
import { radii, spacing, typography } from "../theme/colors";
import { useTheme } from "../lib/ThemeContext";
import type { Palette } from "../theme/palettes";

interface RotatingChipProps {
  phrases: string[];
  onPress: (currentPhrase: string) => void;
  intervalMs?: number;
}

/**
 * One suggested-prompt chip that cycles through several phrases on a real
 * timer (default every 5s) instead of showing one static label — a slide
 * down + fade transition between phrases, looping continuously. Tapping it
 * acts on whichever phrase is showing at that moment.
 */
export function RotatingChip({ phrases, onPress, intervalMs = 5000 }: RotatingChipProps) {
  const { palette } = useTheme();
  const styles = React.useMemo(() => makeStyles(palette), [palette]);
  const [index, setIndex] = useState(0);
  const translateY = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const timer = setInterval(() => {
      Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => {
        setIndex((i) => (i + 1) % phrases.length);
        translateY.setValue(-10);
        Animated.parallel([
          Animated.timing(opacity, { toValue: 1, duration: 260, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(translateY, { toValue: 0, duration: 260, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        ]).start();
      });
    }, intervalMs);
    return () => clearInterval(timer);
  }, [phrases.length, intervalMs, opacity, translateY]);

  return (
    <TouchableOpacity style={styles.chip} onPress={() => onPress(phrases[index])}>
      <Animated.Text style={[styles.chipText, { opacity, transform: [{ translateY }] }]}>{phrases[index]}</Animated.Text>
    </TouchableOpacity>
  );
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    chip: {
      backgroundColor: palette.bgCardAlt,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: palette.border,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      minWidth: 150,
      alignItems: "center",
      overflow: "hidden",
    },
    chipText: { ...typography.caption, color: palette.textSecondary },
  });
}
