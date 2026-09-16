import React, { useEffect, useRef } from "react";
import { Animated, Easing } from "react-native";
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, Pattern, Polygon, Rect, Stop } from "react-native-svg";
import { useTheme } from "../lib/ThemeContext";

const AnimatedEllipse = Animated.createAnimatedComponent(Ellipse);

export interface BotAvatarProps {
  size?: number;
  mood?: "idle" | "thinking" | "happy" | "talking";
  glowColor?: string;
  /**
   * A real 0-1 mouth-openness value the caller updates every animation frame
   * from ACTUAL playing audio (e.g. a Web Audio AnalyserNode reading the TTS
   * reply's real waveform amplitude — see CallScreen's playReplyWeb). When
   * provided, this replaces the internal simulated "talking" loop below with
   * genuine audio-reactive lip movement. Omit it (the native default, since
   * expo-av exposes no playback amplitude on iOS/Android) to keep the
   * believable-but-simulated cadence.
   */
  liveMouthLevel?: Animated.Value;
}

/**
 * NexaAi's mascot — a small rounded "spark" bot, drawn entirely in SVG
 * (no external character asset, no video/gif loop, no raster image — a
 * generated reference picture can't itself blink, so this shape was
 * hand-built from that reference as real vector parts). A single
 * self-contained rounded gem-like body (deliberately no arms/hands — an
 * earlier hand+arms version was tried and reverted per feedback: "simple"
 * won over "character with limbs"), layered with real AI-motif detail
 * rather than a plain flat body: a small neural-node cluster near the top,
 * two circuit traces with pads on the lower flanks, a glowing "core"
 * readout with a small N monogram (legible NexaAi branding at icon scale —
 * spelling out "NexaAi" would be unreadable mush at the 32px size this
 * renders at in chat), and a subtle holographic scan-line texture across
 * the body surface. Colors come entirely from the theme palette
 * (`useTheme`), so it reads correctly in Original/Black/White rather than
 * carrying its own fixed brand colors. Real, state-driven animations:
 *  - "thinking": the whole body pulses gently while waiting on a reply.
 *  - "talking": the mouth opens/closes in real sync with `liveMouthLevel`
 *    when the caller supplies real playback-amplitude data (web); otherwise
 *    an irregular open/close loop, driven by whoever renders this (live
 *    token streaming or TTS playback actually happening) — not a fixed
 *    decorative loop.
 *  - idle blink: a small periodic blink regardless of mood, so the bot
 *    reads as alive rather than static.
 */
export function BotAvatar({ size = 72, mood = "idle", glowColor, liveMouthLevel }: BotAvatarProps) {
  const { palette } = useTheme();
  const glow = glowColor ?? palette.accent;
  const pulse = useRef(new Animated.Value(1)).current;
  const simulatedMouthOpen = useRef(new Animated.Value(0)).current;
  const mouthOpen = liveMouthLevel ?? simulatedMouthOpen;
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
    // A real liveMouthLevel is driven directly by the caller (setValue per
    // audio frame) — running the simulated loop on top of it would fight it.
    if (liveMouthLevel) return;
    if (mood !== "talking") {
      Animated.timing(simulatedMouthOpen, { toValue: 0, duration: 120, useNativeDriver: false }).start();
      return;
    }
    // An irregular open/close cadence (varied durations + a "closed" beat
    // now and then) reads far more like real talking than a clean sine wave.
    const beats = [0.15, 0.9, 0.35, 1, 0.1, 0.7, 0.5, 0.95, 0.2];
    const sequence = beats.map((v) =>
      Animated.timing(simulatedMouthOpen, { toValue: v, duration: 90 + Math.random() * 70, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
    );
    const loop = Animated.loop(Animated.sequence(sequence));
    loop.start();
    return () => loop.stop();
  }, [mood, simulatedMouthOpen, liveMouthLevel]);

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
            <Stop offset="0" stopColor={palette.accentBright} />
            <Stop offset="1" stopColor={palette.accent} />
          </LinearGradient>
          <LinearGradient id="botGlow" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={glow} stopOpacity="0.9" />
            <Stop offset="1" stopColor={palette.accentBright} stopOpacity="0.6" />
          </LinearGradient>
          {/* a tileable single scan-line, repeated by the pattern below to
              give the body a subtle holographic surface texture */}
          <Pattern id="botScanlines" patternUnits="userSpaceOnUse" width={100} height={4}>
            <Rect x={0} y={0} width={100} height={1} fill={palette.starBright} />
          </Pattern>
        </Defs>

        {/* spark tip — a small raised point at the top, reading as "a spark
            of intelligence" rather than a literal antenna */}
        <Polygon points="50,4 55,20 45,20" fill="url(#botGlow)" />

        {/* body — a single rounded gem/"squircle" shape (a Rect with a large
            corner radius), not a split face */}
        <Rect x={16} y={20} width={68} height={68} rx={26} ry={26} fill="url(#botBody)" stroke={palette.border} strokeWidth={1.5} />

        {/* holographic scan-line texture on the body surface — the pattern
            rect shares the body's exact bounds/radius so it never spills
            past the silhouette */}
        <Rect x={16} y={20} width={68} height={68} rx={26} ry={26} fill="url(#botScanlines)" opacity={0.08} />

        {/* neural-node cluster near the top — a small connected-dot graph,
            reading as "a network/a mind" rather than a literal circuit */}
        <Path d="M30 30 L42 26 M42 26 L58 26 M58 26 L70 30 M42 26 L50 34 M58 26 L50 34" stroke={palette.starBright} strokeWidth={1} fill="none" opacity={0.4} />
        <Circle cx={30} cy={30} r={1.6} fill={palette.starBright} opacity={0.75} />
        <Circle cx={42} cy={26} r={1.6} fill={palette.starBright} opacity={0.75} />
        <Circle cx={58} cy={26} r={1.6} fill={palette.starBright} opacity={0.75} />
        <Circle cx={70} cy={30} r={1.6} fill={palette.starBright} opacity={0.75} />
        <Circle cx={50} cy={34} r={1.8} fill={palette.starBright} opacity={0.85} />

        {/* circuit traces + pads on the lower flanks — literal PCB-style
            detail, kept clear of the eyes/mouth band */}
        <Path d="M22 50 L22 60 L28 60" stroke={palette.accentBright} strokeWidth={1} fill="none" opacity={0.55} />
        <Rect x={20} y={48} width={4} height={4} rx={1} fill={palette.accentBright} opacity={0.6} />
        <Rect x={26} y={58} width={4} height={4} rx={1} fill={palette.accentBright} opacity={0.6} />
        <Path d="M78 50 L78 60 L72 60" stroke={palette.accentBright} strokeWidth={1} fill="none" opacity={0.55} />
        <Rect x={76} y={48} width={4} height={4} rx={1} fill={palette.accentBright} opacity={0.6} />
        <Rect x={70} y={58} width={4} height={4} rx={1} fill={palette.accentBright} opacity={0.6} />

        {/* glowing core visor */}
        <Ellipse cx={50} cy={58} rx={26} ry={20} fill="url(#botGlow)" opacity={0.3} />

        {/* a small glowing "core" readout near the base of the body, with a
            compact N monogram — the legible-at-icon-scale stand-in for
            spelling out "NexaAi" (unreadable at the 32px this renders at
            in chat), and the literal "processor" this mascot is themed on */}
        <Rect x={41} y={79} width={18} height={8} rx={2} fill={palette.bgElevated} stroke={palette.accentBright} strokeWidth={1} opacity={0.9} />
        <Path d="M46 86 L46 81 L54 86 L54 81" stroke={palette.accentBright} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" fill="none" />

        {/* eyes — blink via a scaled ry, driven by an Animated value */}
        <AnimatedEllipse cx={38} cy={56} rx={5} ry={eyeHeight as unknown as number} fill={palette.starBright} />
        <AnimatedEllipse cx={62} cy={56} rx={5} ry={eyeHeight as unknown as number} fill={palette.starBright} />

        {/* mouth */}
        {mood === "talking" ? (
          <AnimatedEllipse cx={50} cy={72} rx={mouthRx as unknown as number} ry={mouthRy as unknown as number} fill={palette.starBright} />
        ) : mood === "happy" ? (
          <Path d="M40 70 Q50 78 60 70" stroke={palette.starBright} strokeWidth={3} fill="none" strokeLinecap="round" />
        ) : (
          <Path d="M42 71 L58 71" stroke={palette.starBright} strokeWidth={3} strokeLinecap="round" />
        )}
      </Svg>
    </Animated.View>
  );
}
