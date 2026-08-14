import React, { useEffect, useMemo } from "react";
import { View, StyleSheet, Dimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, withDelay, Easing } from "react-native-reanimated";

const { width, height } = Dimensions.get("window");

interface Ember {
  x: number;
  size: number;
  delay: number;
  duration: number;
  drift: number;
}

function useEmbers(count: number): Ember[] {
  return useMemo(
    () =>
      Array.from({ length: count }, () => ({
        x: Math.random() * width,
        size: Math.random() * 5 + 2.5,
        delay: Math.random() * 5000,
        duration: Math.random() * 3500 + 5000,
        drift: (Math.random() - 0.5) * 60,
      })),
    [count],
  );
}

function RisingEmber({ ember }: { ember: Ember }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(ember.delay, withRepeat(withTiming(1, { duration: ember.duration, easing: Easing.out(Easing.quad) }), -1, false));
  }, [ember, progress]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * height * 1.05 }, { translateX: Math.sin(progress.value * Math.PI * 3) * ember.drift }],
    opacity: progress.value < 0.15 ? progress.value * 6.6 : progress.value > 0.75 ? (1 - progress.value) * 4 : 1,
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          left: ember.x,
          bottom: 0,
          width: ember.size,
          height: ember.size,
          borderRadius: ember.size / 2,
          backgroundColor: "#FDBA74",
          shadowColor: "#F97316",
          shadowOpacity: 0.9,
          shadowRadius: 4,
          shadowOffset: { width: 0, height: 0 },
        },
        style,
      ]}
    />
  );
}

function EmberGlow({ x, y, size, delay }: { x: number; y: number; size: number; delay: number }) {
  const pulse = useSharedValue(0.35);

  useEffect(() => {
    pulse.value = withDelay(delay, withRepeat(withTiming(0.6, { duration: 3200, easing: Easing.inOut(Easing.sin) }), -1, true));
  }, [delay, pulse]);

  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View pointerEvents="none" style={[{ position: "absolute", left: x, top: y, width: size, height: size }, style]}>
      <LinearGradient colors={["#EA580C", "#2B0E08", "transparent"]} style={{ width: size, height: size, borderRadius: size / 2 }} />
    </Animated.View>
  );
}

/** A warm, dark ember backdrop for Charizard/fire energy: charcoal-to-maroon
 * gradient, a couple of slow-pulsing glow blobs, and small embers
 * continuously rising from the bottom with a gentle side-to-side drift.
 * Reanimated (native-thread) animations. */
export function EmberBackground({ children }: { children?: React.ReactNode }) {
  const embers = useEmbers(20);

  return (
    <View style={StyleSheet.absoluteFill}>
      <LinearGradient colors={["#170805", "#2B0E08", "#170805"]} locations={[0, 0.5, 1]} style={StyleSheet.absoluteFill} />

      <EmberGlow x={-width * 0.2} y={height * 0.55} size={width * 0.9} delay={0} />
      <EmberGlow x={width * 0.4} y={height * 0.1} size={width * 0.7} delay={900} />

      {embers.map((e, i) => (
        <RisingEmber key={i} ember={e} />
      ))}

      {children}
    </View>
  );
}
