import React, { useMemo, useRef, useState } from "react";
import { Animated, StyleSheet, Text, TextInput, TouchableOpacity, View, type KeyboardTypeOptions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { radii, spacing, typography } from "../theme/colors";
import { useTheme } from "../lib/ThemeContext";
import type { Palette } from "../theme/palettes";

const FOCUS_DURATION_MS = 150;

interface TextFieldProps {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  testID?: string;
}

/**
 * The one text input used across auth/forms — small uppercase label above
 * a pill-radius field with a muted leading icon, and a real animated
 * focus state (border brightens to the accent color + a soft glow),
 * rather than a hard instant color swap. Password fields get a built-in
 * show/hide toggle instead of every screen re-implementing its own.
 */
export function TextField({ label, icon, value, onChangeText, placeholder, secureTextEntry, keyboardType, autoCapitalize, testID }: TextFieldProps) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const focus = useRef(new Animated.Value(0)).current;

  const animateFocus = (toFocused: boolean) => {
    setFocused(toFocused);
    Animated.timing(focus, { toValue: toFocused ? 1 : 0, duration: FOCUS_DURATION_MS, useNativeDriver: false }).start();
  };

  const borderColor = focus.interpolate({ inputRange: [0, 1], outputRange: [palette.border, palette.accentBright] });
  const shadowOpacity = focus.interpolate({ inputRange: [0, 1], outputRange: [0, 0.35] });

  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <Animated.View style={[styles.field, { borderColor, shadowColor: palette.accentBright, shadowOpacity, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } }]}>
        <Ionicons name={icon} size={17} color={focused ? palette.accentBright : palette.textMuted} style={styles.icon} />
        <TextInput
          testID={testID}
          style={styles.input}
          placeholder={placeholder}
          placeholderTextColor={palette.textMuted}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={secureTextEntry && !revealed}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize ?? "none"}
          onFocus={() => animateFocus(true)}
          onBlur={() => animateFocus(false)}
        />
        {secureTextEntry && (
          <TouchableOpacity onPress={() => setRevealed((v) => !v)} hitSlop={8}>
            <Ionicons name={revealed ? "eye-off-outline" : "eye-outline"} size={17} color={palette.textMuted} />
          </TouchableOpacity>
        )}
      </Animated.View>
    </View>
  );
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    label: { ...typography.sectionLabel, color: palette.textMuted, textTransform: "uppercase", marginBottom: spacing.xs },
    field: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: palette.bgCardAlt,
      borderRadius: radii.lg,
      borderWidth: 1,
      paddingHorizontal: spacing.lg,
      paddingVertical: 14,
    },
    icon: { flexShrink: 0 },
    input: { flex: 1, fontSize: typography.body.fontSize, fontFamily: typography.body.fontFamily, color: palette.textPrimary, padding: 0 },
  });
}
