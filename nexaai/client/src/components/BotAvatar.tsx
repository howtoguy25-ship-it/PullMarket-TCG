import React, { useEffect, useRef } from "react";
import { Animated, Easing } from "react-native";
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, Stop } from "react-native-svg";
import { colors } from "../theme/colors";

interface BotAvatarProps {
  size?: number;
  mood?: "idle" | "thinking" | "happy";
  glowColor?: string;
}

/**
 * NexaAi's mascot — a small rounded "star-core" bot, drawn entirely in SVG
 * (no external character asset). Two antennae + a soft glowing core that
 * pulses while "thinking".
 */
export function BotAvatar({ size = 72, mood = "idle", glowColor = colors.accent }: BotAvatarProps) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (mood !== "thinking") {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.12, duration: 550, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 550, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [mood, pulse]);

  const eyeHeight = mood === "happy" ? 4 : mood === "thinking" ? 10 : 8;

  return (
    <Animated.View style={{ width: size, height: size, transform: [{ scale: pulse }] }}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <LinearGradient id="botBody" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.bgCardAlt} />
            <Stop offset="1" stopColor={colors.bgCard} />
          </LinearGradient>
          <LinearGradient id="botGlow" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={glowColor} stopOpacity="0.9" />
            <Stop offset="1" stopColor={colors.accentBright} stopOpacity="0.6" />
          </LinearGradient>
        </Defs>

        {/* antennae */}
        <Path d="M35 18 L30 4" stroke={glowColor} strokeWidth={2.5} strokeLinecap="round" />
        <Path d="M65 18 L70 4" stroke={glowColor} strokeWidth={2.5} strokeLinecap="round" />
        <Circle cx={30} cy={4} r={3.5} fill={colors.accentBright} />
        <Circle cx={70} cy={4} r={3.5} fill={colors.accentBright} />

        {/* head/body — one soft rounded blob */}
        <Ellipse cx={50} cy={56} rx={38} ry={34} fill="url(#botBody)" stroke={colors.border} strokeWidth={1.5} />

        {/* glowing core visor */}
        <Ellipse cx={50} cy={56} rx={26} ry={20} fill="url(#botGlow)" opacity={0.28} />

        {/* eyes */}
        <Ellipse cx={38} cy={56} rx={5} ry={eyeHeight} fill={colors.starBright} />
        <Ellipse cx={62} cy={56} rx={5} ry={eyeHeight} fill={colors.starBright} />

        {/* mouth */}
        {mood === "happy" ? (
          <Path d="M40 70 Q50 78 60 70" stroke={colors.starBright} strokeWidth={3} fill="none" strokeLinecap="round" />
        ) : (
          <Path d="M42 71 L58 71" stroke={colors.starBright} strokeWidth={3} strokeLinecap="round" />
        )}
      </Svg>
    </Animated.View>
  );
}
