import React, { useEffect, useMemo, useRef } from "react";
import { Animated, StyleSheet, View, useWindowDimensions } from "react-native";
import Svg, { Circle, Defs, LinearGradient, RadialGradient, Rect, Stop } from "react-native-svg";
import { useTheme } from "../lib/ThemeContext";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface Star {
  x: number;
  y: number;
  r: number;
  opacity: number;
}

function makeStars(count: number, width: number, height: number, seed: number): Star[] {
  // Simple deterministic pseudo-random so the starfield doesn't jump around on re-render.
  let s = seed;
  const rand = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  return Array.from({ length: count }, () => ({
    x: rand() * width,
    y: rand() * height,
    r: rand() * 1.4 + 0.3,
    opacity: rand() * 0.7 + 0.25,
  }));
}

interface OrbSpec {
  cx: number;
  cy: number;
  r: number;
  driftPx: number;
  durationMs: number;
}

function makeOrbs(width: number, height: number): OrbSpec[] {
  return [
    { cx: width * 0.18, cy: height * 0.22, r: Math.max(width, height) * 0.24, driftPx: 26, durationMs: 7000 },
    { cx: width * 0.82, cy: height * 0.4, r: Math.max(width, height) * 0.2, driftPx: 34, durationMs: 9000 },
    { cx: width * 0.35, cy: height * 0.82, r: Math.max(width, height) * 0.22, driftPx: 30, durationMs: 8000 },
  ];
}

/**
 * Real animated floating orbs — each one is a driven Animated.Value looping
 * a vertical drift + a slow opacity pulse (Animated.loop, not a one-shot
 * mount animation), so the whole app background genuinely feels alive
 * rather than a static gradient. Rendered as soft radial-gradient SVG
 * circles (no image assets, no blur library dependency) tinted from the
 * active theme's own accentGlow, so it stays correct across every palette.
 */
function FloatingOrb({ spec, color, index }: { spec: OrbSpec; color: string; index: number }) {
  const drift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, { toValue: 1, duration: spec.durationMs, useNativeDriver: false }),
        Animated.timing(drift, { toValue: 0, duration: spec.durationMs, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [drift, spec.durationMs]);

  const cy = drift.interpolate({ inputRange: [0, 1], outputRange: [spec.cy, spec.cy - spec.driftPx] });
  const opacity = drift.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0.9] });

  return (
    <AnimatedCircle cx={spec.cx} cy={cy as unknown as number} r={spec.r} fill={`url(#orb${index})`} opacity={opacity as unknown as number} />
  );
}

/** Hand-drawn dark backdrop: gradient sky (from the active theme palette) + scattered stars + real floating animated glow orbs, no image assets. */
export function GalaxyBackground({ children }: { children?: React.ReactNode }) {
  const { width, height } = useWindowDimensions();
  const { palette } = useTheme();
  const stars = useMemo(() => makeStars(90, width, height, 42), [width, height]);
  const orbs = useMemo(() => makeOrbs(width, height), [width, height]);

  return (
    <View style={[styles.container, { backgroundColor: palette.bg }]}>
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={palette.gradientGalaxy[2]} />
            <Stop offset="0.5" stopColor={palette.gradientGalaxy[1]} />
            <Stop offset="1" stopColor={palette.gradientGalaxy[0]} />
          </LinearGradient>
          {orbs.map((_, i) => (
            <RadialGradient key={i} id={`orb${i}`} cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={palette.accentGlow} stopOpacity="0.9" />
              <Stop offset="1" stopColor={palette.accentGlow} stopOpacity="0" />
            </RadialGradient>
          ))}
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill="url(#sky)" />
        {orbs.map((orb, i) => (
          <FloatingOrb key={i} spec={orb} color={palette.accentGlow} index={i} />
        ))}
        {stars.map((star, i) => (
          <Circle key={i} cx={star.x} cy={star.y} r={star.r} fill={palette.starBright} opacity={star.opacity} />
        ))}
      </Svg>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
