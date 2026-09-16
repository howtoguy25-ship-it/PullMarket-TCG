import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import Svg, { Defs, Ellipse, RadialGradient, Stop } from "react-native-svg";
import { useTheme } from "../lib/ThemeContext";
import { BotAvatar } from "./BotAvatar";

export interface WelcomeAvatarProps {
  /** BotAvatar's own size. */
  size?: number;
  /** The word/phrase presented above the mascot — fades and rises in once on mount. */
  welcomeText?: string;
}

/**
 * The sign-in screen's mascot moment: the real animated BotAvatar (now
 * carrying its own AI-motif detail — neural nodes, circuit traces, a
 * glowing core, holographic texture) with a soft aura behind it and a
 * "Welcome" greeting that fades/rises in once on mount. An earlier version
 * of this wrapped the mascot in a hand+arms illustration; that was
 * reverted per feedback in favor of the mascot's own single self-contained
 * shape — this component now only supplies the aura, the float, and the
 * welcome-text reveal.
 */
export function WelcomeAvatar({ size = 100, welcomeText = "Welcome" }: WelcomeAvatarProps) {
  const { palette } = useTheme();
  const auraSize = size * 1.9;
  const totalHeight = size + 34;

  const float = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, { toValue: 1, duration: 2400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(float, { toValue: 0, duration: 2400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [float]);
  const floatY = float.interpolate({ inputRange: [0, 1], outputRange: [0, -5] });

  const textIn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(textIn, { toValue: 1, duration: 650, delay: 450, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [textIn]);
  const textY = textIn.interpolate({ inputRange: [0, 1], outputRange: [10, 0] });

  return (
    <View style={{ width: auraSize, height: totalHeight, alignItems: "center" }}>
      <Svg width={auraSize} height={totalHeight} viewBox={`0 0 ${auraSize} ${totalHeight}`} style={StyleSheet.absoluteFillObject} pointerEvents="none">
        <Defs>
          <RadialGradient id="welcomeAura" cx="50%" cy="62%" r="55%">
            <Stop offset="0" stopColor={palette.accent} stopOpacity="0.28" />
            <Stop offset="1" stopColor={palette.accent} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Ellipse cx={auraSize / 2} cy={totalHeight * 0.6} rx={auraSize * 0.42} ry={totalHeight * 0.42} fill="url(#welcomeAura)" />
      </Svg>

      <Animated.Text style={[styles.welcomeText, { color: palette.textPrimary, opacity: textIn, transform: [{ translateY: textY }] }]}>
        {welcomeText}
      </Animated.Text>

      <Animated.View style={{ transform: [{ translateY: floatY }] }}>
        <BotAvatar size={size} mood="happy" />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  welcomeText: {
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 4,
    letterSpacing: 0.2,
  },
});
