import React, { useMemo, useRef } from "react";
import { ActivityIndicator, Animated, Easing, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { radii, spacing, typography } from "../theme/colors";
import { useTheme } from "../lib/ThemeContext";
import type { Palette } from "../theme/palettes";

const BUTTON_HEIGHT = 50; // real, fixed — every button in the app shares this height (spec: 48-52px)
const PRESS_SCALE = 0.97;
const PRESS_DURATION_MS = 150;

interface ButtonProps {
  /** "primary" — the one prominent, solid-fill CTA a screen should have at most one of. "secondary" — outlined, for equal-weight alternative actions (social sign-in, cancel, etc). */
  variant?: "primary" | "secondary";
  title?: string;
  icon?: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * The one button used for every primary/secondary action from here on —
 * fixed height, shared corner radius, and a real scale-down micro-
 * interaction on press (Animated, not a CSS-only trick, so it actually
 * runs on native too). A screen should have exactly one visible `primary`
 * button at a time; everything else is `secondary`.
 */
export function Button({ variant = "primary", title, icon, onPress, disabled, loading, testID, style }: ButtonProps) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const scale = useRef(new Animated.Value(1)).current;

  const animateTo = (value: number) =>
    Animated.timing(scale, { toValue: value, duration: PRESS_DURATION_MS, easing: Easing.out(Easing.ease), useNativeDriver: true }).start();

  const isPrimary = variant === "primary";
  const isDisabled = !!disabled || !!loading;

  return (
    <Animated.View style={[{ transform: [{ scale }] }, isDisabled && styles.disabled, style]}>
      <Pressable
        testID={testID}
        onPress={onPress}
        disabled={isDisabled}
        onPressIn={() => !isDisabled && animateTo(PRESS_SCALE)}
        onPressOut={() => animateTo(1)}
        style={[styles.base, isPrimary ? styles.primary : styles.secondary]}
      >
        {loading ? (
          <ActivityIndicator color={isPrimary ? "#fff" : palette.textSecondary} />
        ) : (
          <View style={styles.content}>
            {icon}
            {title && <Text style={[styles.label, isPrimary ? styles.primaryLabel : styles.secondaryLabel]}>{title}</Text>}
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    base: {
      height: BUTTON_HEIGHT,
      borderRadius: radii.lg,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: spacing.xl,
    },
    content: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    label: { ...typography.button },
    primary: {
      backgroundColor: palette.accent,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.2,
      shadowRadius: 10,
      elevation: 3,
    },
    primaryLabel: { color: "#fff" },
    secondary: {
      backgroundColor: "transparent",
      borderWidth: 1,
      borderColor: palette.border,
    },
    secondaryLabel: { color: palette.textPrimary },
    disabled: { opacity: 0.5 },
  });
}
