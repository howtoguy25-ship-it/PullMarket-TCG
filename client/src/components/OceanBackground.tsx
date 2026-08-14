import React, { useEffect, useMemo } from "react";
import { View, StyleSheet, Dimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, withDelay, Easing } from "react-native-reanimated";

const { width, height } = Dimensions.get("window");

interface Bubble {
  x: number;
  size: number;
  delay: number;
  duration: number;
}

function useBubbles(count: number): Bubble[] {
  return useMemo(
    () =>
      Array.from({ length: count }, () => ({
        x: Math.random() * width,
        size: Math.random() * 10 + 5,
        delay: Math.random() * 4000,
        duration: Math.random() * 4000 + 6000,
      })),
    [count],
  );
}

function RisingBubble({ bubble }: { bubble: Bubble }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(bubble.delay, withRepeat(withTiming(1, { duration: bubble.duration, easing: Easing.linear }), -1, false));
  }, [bubble, progress]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * height + bubble.size }, { translateX: Math.sin(progress.value * Math.PI * 2) * 10 }],
    opacity: progress.value < 0.1 ? progress.value * 10 : progress.value > 0.85 ? (1 - progress.value) * 6.6 : 0.5,
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: "absolute", left: bubble.x, bottom: 0, width: bubble.size, height: bubble.size, borderRadius: bubble.size / 2, borderWidth: 1, borderColor: "rgba(186,230,253,0.55)", backgroundColor: "rgba(186,230,253,0.08)" }, style]}
    />
  );
}

function WaveBand({ y, height: bandHeight, color, duration, delay }: { y: number; height: number; color: string; duration: number; delay: number }) {
  const drift = useSharedValue(0);

  useEffect(() => {
    drift.value = withDelay(delay, withRepeat(withTiming(1, { duration, easing: Easing.inOut(Easing.sin) }), -1, true));
  }, [delay, duration, drift]);

  const style = useAnimatedStyle(() => ({ transform: [{ translateX: (drift.value - 0.5) * width * 0.3 }] }));

  return (
    <Animated.View pointerEvents="none" style={[{ position: "absolute", left: -width * 0.3, top: y, width: width * 1.6, height: bandHeight, borderRadius: bandHeight / 2, backgroundColor: color }, style]} />
  );
}

/** A deep-ocean backdrop for pirate/One Piece energy: dark teal-to-navy
 * gradient, slow parallax wave bands drifting side to side, and small
 * bubbles rising continuously from the bottom of the screen. Reanimated
 * (native-thread) animations, same technique as FloatingHoloCards. */
export function OceanBackground({ children }: { children?: React.ReactNode }) {
  const bubbles = useBubbles(16);

  return (
    <View style={StyleSheet.absoluteFill}>
      <LinearGradient colors={["#031A2B", "#062A3E", "#0E7C9E", "#031A2B"]} locations={[0, 0.4, 0.72, 1]} style={StyleSheet.absoluteFill} />

      <WaveBand y={height * 0.18} height={70} color="rgba(14,124,158,0.16)" duration={9000} delay={0} />
      <WaveBand y={height * 0.42} height={90} color="rgba(56,189,248,0.1)" duration={11000} delay={800} />
      <WaveBand y={height * 0.68} height={80} color="rgba(6,42,62,0.35)" duration={10000} delay={1400} />

      {bubbles.map((b, i) => (
        <RisingBubble key={i} bubble={b} />
      ))}

      {children}
    </View>
  );
}
