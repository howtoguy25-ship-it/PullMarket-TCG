import React, { useEffect, useRef } from "react";
import { Animated, Easing } from "react-native";
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, Stop } from "react-native-svg";
import { colors } from "../theme/colors";

const AnimatedEllipse = Animated.createAnimatedComponent(Ellipse);

interface BotAvatarProps {
  size?: number;
  mood?: "idle" | "thinking" | "happy" | "talking";
  glowColor?: string;
}

/**
 * NexaAi's mascot — a small rounded "star-core" bot, drawn entirely in SVG
 * (no external character asset, no video/gif loop). Two antennae + a soft
 * glowing core. Three real, state-driven animations:
 *  - "thinking": the whole body pulses gently while waiting on a reply.
 *  - "talking": the mouth genuinely opens/closes in an irregular loop,
 *    driven by whoever renders this (live token streaming or TTS playback
 *    actually happening) — not a fixed decorative loop.
 *  - idle blink: a small periodic blink regardless of mood, so the bot
 *    reads as alive rather than static.
 */
export function BotAvatar({ size = 72, mood = "idle", glowColor = colors.accent }: BotAvatarProps) {
  const pulse = useRef(new Animated.Value(1)).current;
  const mouthOpen = useRef(new Animated.Value(0)).current;
  const blink = useRef(new Animated.Value(1)).current;

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

  useEffect(() => {
    if (mood !== "talking") {
      Animated.timing(mouthOpen, { toValue: 0, duration: 120, useNativeDriver: false }).start();
      return;
    }
    // An irregular open/close cadence (varied durations + a "closed" beat
    // now and then) reads far more like real talking than a clean sine wave.
    const beats = [0.15, 0.9, 0.35, 1, 0.1, 0.7, 0.5, 0.95, 0.2];
    const sequence = beats.map((v) =>
      Animated.timing(mouthOpen, { toValue: v, duration: 90 + Math.random() * 70, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
    );
    const loop = Animated.loop(Animated.sequence(sequence));
    loop.start();
    return () => loop.stop();
  }, [mood, mouthOpen]);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const scheduleBlink = () => {
      timeout = setTimeout(() => {
        Animated.sequence([
          Animated.timing(blink, { toValue: 0.08, duration: 70, useNativeDriver: false }),
          Animated.timing(blink, { toValue: 1, duration: 90, useNativeDriver: false }),
        ]).start(scheduleBlink);
      }, 2200 + Math.random() * 2600);
    };
    scheduleBlink();
    return () => clearTimeout(timeout);
  }, [blink]);

  const baseEyeHeight = mood === "happy" ? 4 : mood === "thinking" ? 10 : 8;
  const eyeHeight = Animated.multiply(baseEyeHeight, blink);
  const mouthRy = mouthOpen.interpolate({ inputRange: [0, 1], outputRange: [2, 9] });
  const mouthRx = mouthOpen.interpolate({ inputRange: [0, 1], outputRange: [7, 10] });

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

        {/* eyes — blink via a scaled ry, driven by an Animated value */}
        <AnimatedEllipse cx={38} cy={56} rx={5} ry={eyeHeight as unknown as number} fill={colors.starBright} />
        <AnimatedEllipse cx={62} cy={56} rx={5} ry={eyeHeight as unknown as number} fill={colors.starBright} />

        {/* mouth */}
        {mood === "talking" ? (
          <AnimatedEllipse cx={50} cy={72} rx={mouthRx as unknown as number} ry={mouthRy as unknown as number} fill={colors.starBright} />
        ) : mood === "happy" ? (
          <Path d="M40 70 Q50 78 60 70" stroke={colors.starBright} strokeWidth={3} fill="none" strokeLinecap="round" />
        ) : (
          <Path d="M42 71 L58 71" stroke={colors.starBright} strokeWidth={3} strokeLinecap="round" />
        )}
      </Svg>
    </Animated.View>
  );
}
