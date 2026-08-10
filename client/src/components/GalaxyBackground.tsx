import React, { useMemo } from "react";
import { View, StyleSheet, Dimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

const { width, height } = Dimensions.get("window");

interface Star {
  x: number;
  y: number;
  size: number;
  opacity: number;
}

function useStars(count: number): Star[] {
  return useMemo(
    () =>
      Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        size: Math.random() * 2.4 + 0.6,
        opacity: Math.random() * 0.7 + 0.25,
      })),
    [count],
  );
}

function GlowBlob({ x, y, size, colors }: { x: number; y: number; size: number; colors: [string, string] }) {
  return (
    <View style={{ position: "absolute", left: x, top: y, width: size, height: size, opacity: 0.55 }} pointerEvents="none">
      <LinearGradient
        colors={[colors[0], colors[1], "transparent"]}
        style={{ width: size, height: size, borderRadius: size / 2 }}
      />
    </View>
  );
}

/** A dark galaxy-style backdrop: deep navy/purple gradient, scattered stars,
 * and a couple of soft colorful nebula glows echoing the app's brand
 * gradient (blue → purple → pink → gold). Pure View/LinearGradient — no
 * extra native deps. */
export function GalaxyBackground({ children }: { children?: React.ReactNode }) {
  const stars = useStars(70);

  return (
    <View style={StyleSheet.absoluteFill}>
      <LinearGradient colors={["#0B0716", "#150C2E", "#1C1040", "#0B0716"]} locations={[0, 0.4, 0.7, 1]} style={StyleSheet.absoluteFill} />

      <GlowBlob x={-width * 0.25} y={-height * 0.08} size={width * 0.9} colors={["#6D28D9", "#0B0716"]} />
      <GlowBlob x={width * 0.35} y={height * 0.35} size={width * 0.8} colors={["#DB2777", "#0B0716"]} />
      <GlowBlob x={-width * 0.15} y={height * 0.65} size={width * 0.7} colors={["#0EA5E9", "#0B0716"]} />

      {stars.map((s, i) => (
        <View
          key={i}
          style={{
            position: "absolute",
            left: s.x,
            top: s.y,
            width: s.size,
            height: s.size,
            borderRadius: s.size,
            backgroundColor: "#FFFFFF",
            opacity: s.opacity,
          }}
        />
      ))}

      {children}
    </View>
  );
}
