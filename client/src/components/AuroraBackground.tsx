import React, { useEffect, useMemo } from "react";
import { View, StyleSheet, Dimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, withDelay, Easing } from "react-native-reanimated";

const { width, height } = Dimensions.get("window");

interface Star {
  x: number;
  y: number;
  size: number;
  delay: number;
}

function useStars(count: number): Star[] {
  return useMemo(
    () => Array.from({ length: count }, () => ({ x: Math.random() * width, y: Math.random() * height * 0.6, size: Math.random() * 2 + 0.8, delay: Math.random() * 2500 })),
    [count],
  );
}

function TwinkleStar({ star }: { star: Star }) {
  const opacity = useSharedValue(0.2);

  useEffect(() => {
    opacity.value = withDelay(star.delay, withRepeat(withTiming(0.9, { duration: 1600, easing: Easing.inOut(Easing.sin) }), -1, true));
  }, [star, opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return <Animated.View pointerEvents="none" style={[{ position: "absolute", left: star.x, top: star.y, width: star.size, height: star.size, borderRadius: star.size, backgroundColor: "#FFFFFF" }, style]} />;
}

interface RibbonSpec {
  left: number;
  colors: [string, string, string];
  rotate: string;
  duration: number;
  delay: number;
}

const RIBBONS: RibbonSpec[] = [
  { left: -0.1, colors: ["#16A34A", "#16A0A0", "transparent"], rotate: "8deg", duration: 6000, delay: 0 },
  { left: 0.15, colors: ["#7C3AED", "#DB2777", "transparent"], rotate: "-6deg", duration: 7200, delay: 600 },
  { left: 0.45, colors: ["#0EA5E9", "#16A0A0", "transparent"], rotate: "10deg", duration: 6600, delay: 1200 },
  { left: 0.72, colors: ["#DB2777", "#7C3AED", "transparent"], rotate: "-9deg", duration: 7800, delay: 300 },
];

function AuroraRibbon({ spec }: { spec: RibbonSpec }) {
  const sway = useSharedValue(0);

  useEffect(() => {
    sway.value = withDelay(spec.delay, withRepeat(withTiming(1, { duration: spec.duration, easing: Easing.inOut(Easing.sin) }), -1, true));
  }, [spec, sway]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: (sway.value - 0.5) * width * 0.16 }, { rotate: spec.rotate }],
    opacity: 0.35 + sway.value * 0.35,
  }));

  return (
    <Animated.View pointerEvents="none" style={[{ position: "absolute", left: spec.left * width, top: -height * 0.15, width: width * 0.4, height: height * 1.3 }, style]}>
      <LinearGradient colors={spec.colors} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={{ flex: 1 }} />
    </Animated.View>
  );
}

/** A dark aurora-sky backdrop: deep indigo night gradient, twinkling stars,
 * and a handful of translucent color ribbons that gently sway and pulse
 * like the northern lights. Reanimated (native-thread) animations. */
export function AuroraBackground({ children }: { children?: React.ReactNode }) {
  const stars = useStars(50);

  return (
    <View style={StyleSheet.absoluteFill}>
      <LinearGradient colors={["#0B1230", "#101B45", "#0B1230"]} locations={[0, 0.5, 1]} style={StyleSheet.absoluteFill} />

      {stars.map((s, i) => (
        <TwinkleStar key={i} star={s} />
      ))}

      <View style={StyleSheet.absoluteFill}>
        {RIBBONS.map((r, i) => (
          <AuroraRibbon key={i} spec={r} />
        ))}
      </View>

      {children}
    </View>
  );
}
