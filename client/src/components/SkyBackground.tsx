import React, { useEffect, useMemo } from "react";
import { View, StyleSheet, Dimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming, withDelay, Easing } from "react-native-reanimated";

const { width, height } = Dimensions.get("window");

interface CloudSpec {
  top: number; // fraction of screen height
  size: number;
  opacity: number;
  driftDistance: number;
  driftDuration: number;
  startLeft: number; // fraction of screen width
}

// Fixed layout, same reasoning as FloatingHoloCards: stable positions so
// clouds don't jump around on re-render.
const CLOUD_SPECS: CloudSpec[] = [
  { top: 0.06, size: 160, opacity: 0.9, driftDistance: 30, driftDuration: 9000, startLeft: 0.02 },
  { top: 0.15, size: 110, opacity: 0.75, driftDistance: 22, driftDuration: 11000, startLeft: 0.58 },
  { top: 0.26, size: 140, opacity: 0.85, driftDistance: 26, driftDuration: 10000, startLeft: 0.28 },
  { top: 0.4, size: 95, opacity: 0.65, driftDistance: 18, driftDuration: 8000, startLeft: 0.7 },
];

// Each puff is a soft blue-gray "shadow" ellipse with a white one nested
// slightly up-left of it — cheap fake shading that keeps the cloud visible
// against both the deeper blue top of the gradient and the near-white
// bottom, without needing an image asset or blur filter.
function CloudPuff({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return (
    <>
      <View style={[styles.puffShadow, { left: x + w * 0.08, top: y + h * 0.12, width: w, height: h, borderRadius: h / 2 }]} />
      <View style={[styles.puff, { left: x, top: y, width: w * 0.92, height: h * 0.92, borderRadius: h / 2 }]} />
    </>
  );
}

function Cloud({ spec }: { spec: CloudSpec }) {
  const drift = useSharedValue(0);

  useEffect(() => {
    drift.value = withDelay(
      Math.random() * 1000,
      withRepeat(
        withSequence(
          withTiming(spec.driftDistance, { duration: spec.driftDuration, easing: Easing.inOut(Easing.sin) }),
          withTiming(-spec.driftDistance, { duration: spec.driftDuration, easing: Easing.inOut(Easing.sin) }),
        ),
        -1,
        true,
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ translateX: drift.value }] }));

  return (
    <Animated.View
      style={[{ position: "absolute", top: height * spec.top, left: width * spec.startLeft, opacity: spec.opacity }, animatedStyle]}
    >
      {/* A cluster of overlapping rounded puffs reads as a simple, flat
         cloud shape without needing an image asset. */}
      <View style={{ width: spec.size, height: spec.size * 0.55 }}>
        <CloudPuff x={spec.size * 0.15} y={spec.size * 0.12} w={spec.size * 0.55} h={spec.size * 0.4} />
        <CloudPuff x={0} y={spec.size * 0.22} w={spec.size * 0.5} h={spec.size * 0.33} />
        <CloudPuff x={spec.size * 0.4} y={spec.size * 0.18} w={spec.size * 0.5} h={spec.size * 0.36} />
        <CloudPuff x={spec.size * 0.6} y={spec.size * 0.24} w={spec.size * 0.42} h={spec.size * 0.3} />
      </View>
    </Animated.View>
  );
}

/** A light, plain sky backdrop for non-Home screens that still want a bit of
 * atmosphere without competing with content: a pale blue-to-white gradient
 * with a handful of slow-drifting cloud shapes, kept low-opacity so text,
 * price tags, and cards on top stay fully legible. */
export function SkyBackground({ children }: { children?: React.ReactNode }) {
  const clouds = useMemo(() => CLOUD_SPECS, []);

  return (
    <View style={StyleSheet.absoluteFill}>
      <LinearGradient colors={["#8FCBF2", "#C7E6FA", "#EEF6FC", "#F7F5EF"]} locations={[0, 0.25, 0.55, 1]} style={StyleSheet.absoluteFill} />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {clouds.map((spec, i) => (
          <Cloud key={i} spec={spec} />
        ))}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  puff: { position: "absolute", backgroundColor: "#FFFFFF" },
  puffShadow: { position: "absolute", backgroundColor: "#B9DCF2" },
});
