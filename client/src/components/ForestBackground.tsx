import React, { useEffect, useMemo } from "react";
import { View, StyleSheet, Dimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, withDelay, Easing } from "react-native-reanimated";

const { width, height } = Dimensions.get("window");

interface Firefly {
  x: number;
  y: number;
  size: number;
  delay: number;
  duration: number;
  driftX: number;
  driftY: number;
}

function useFireflies(count: number): Firefly[] {
  return useMemo(
    () =>
      Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        size: Math.random() * 3.5 + 2,
        delay: Math.random() * 3000,
        duration: Math.random() * 2200 + 1800,
        driftX: (Math.random() - 0.5) * 40,
        driftY: (Math.random() - 0.5) * 40,
      })),
    [count],
  );
}

function DriftingFirefly({ firefly }: { firefly: Firefly }) {
  const t = useSharedValue(0);

  useEffect(() => {
    t.value = withDelay(firefly.delay, withRepeat(withTiming(1, { duration: firefly.duration, easing: Easing.inOut(Easing.sin) }), -1, true));
  }, [firefly, t]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: t.value * firefly.driftX }, { translateY: t.value * firefly.driftY }],
    opacity: 0.25 + t.value * 0.65,
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          left: firefly.x,
          top: firefly.y,
          width: firefly.size,
          height: firefly.size,
          borderRadius: firefly.size,
          backgroundColor: "#D9F99D",
          shadowColor: "#BEF264",
          shadowOpacity: 0.9,
          shadowRadius: 3,
          shadowOffset: { width: 0, height: 0 },
        },
        style,
      ]}
    />
  );
}

/** A deep forest-at-night backdrop: dark green gradient with soft glow
 * pockets, and fireflies drifting and twinkling across the whole screen.
 * Reanimated (native-thread) animations. */
export function ForestBackground({ children }: { children?: React.ReactNode }) {
  const fireflies = useFireflies(22);

  return (
    <View style={StyleSheet.absoluteFill}>
      <LinearGradient colors={["#04140A", "#08210F", "#0C2A14", "#04140A"]} locations={[0, 0.4, 0.7, 1]} style={StyleSheet.absoluteFill} />

      <View style={{ position: "absolute", left: -width * 0.2, top: -height * 0.1, width: width * 0.9, height: width * 0.9, opacity: 0.4 }}>
        <LinearGradient colors={["#166534", "#04140A", "transparent"]} style={{ flex: 1, borderRadius: 9999 }} />
      </View>
      <View style={{ position: "absolute", left: width * 0.3, top: height * 0.55, width: width * 0.8, height: width * 0.8, opacity: 0.35 }}>
        <LinearGradient colors={["#15803D", "#04140A", "transparent"]} style={{ flex: 1, borderRadius: 9999 }} />
      </View>

      {fireflies.map((f, i) => (
        <DriftingFirefly key={i} firefly={f} />
      ))}

      {children}
    </View>
  );
}
