import React, { useEffect, useRef } from "react";
import { Animated, Easing, Pressable } from "react-native";
import { useTheme } from "../lib/ThemeContext";

interface ToggleSwitchProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}

// iOS's real switch proportions (51x31 track, 27px thumb, 2px inset).
const TRACK_WIDTH = 51;
const TRACK_HEIGHT = 31;
const THUMB_SIZE = 27;
const INSET = 2;

/**
 * The one toggle switch used everywhere in the app: a self-drawn track +
 * thumb (not React Native's own `Switch`), because react-native-web renders
 * `Switch` as a bare native `<input type="checkbox">` on web and does not
 * reliably apply `trackColor`/`thumbColor` there — in practice that native
 * checkbox falls back to the browser's own default toggle appearance (an
 * orange-to-teal gradient in this environment), which is exactly the
 * ungrounded gradient look this design system is trying to remove. Drawing
 * it ourselves guarantees the flat off-gray / solid-accent-on look on every
 * platform, not just native iOS/Android.
 */
export function ToggleSwitch({ value, onValueChange, disabled }: ToggleSwitchProps) {
  const { palette } = useTheme();
  const progress = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(progress, { toValue: value ? 1 : 0, duration: 160, easing: Easing.inOut(Easing.ease), useNativeDriver: false }).start();
  }, [value, progress]);

  const trackColor = progress.interpolate({ inputRange: [0, 1], outputRange: [palette.toggleTrackOff, palette.accent] });
  const thumbTranslate = progress.interpolate({ inputRange: [0, 1], outputRange: [0, TRACK_WIDTH - THUMB_SIZE - INSET * 2] });

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      style={{ opacity: disabled ? 0.5 : 1 }}
      hitSlop={8}
    >
      <Animated.View
        style={{
          width: TRACK_WIDTH,
          height: TRACK_HEIGHT,
          borderRadius: TRACK_HEIGHT / 2,
          backgroundColor: trackColor,
          padding: INSET,
          justifyContent: "center",
        }}
      >
        <Animated.View
          style={{
            width: THUMB_SIZE,
            height: THUMB_SIZE,
            borderRadius: THUMB_SIZE / 2,
            backgroundColor: "#FFFFFF",
            transform: [{ translateX: thumbTranslate }],
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.35,
            shadowRadius: 2,
            elevation: 2,
          }}
        />
      </Animated.View>
    </Pressable>
  );
}
