import React, { useMemo } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { colors } from "../theme/colors";

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

/** Hand-drawn dark "galaxy" backdrop: gradient sky + scattered stars, no image assets. */
export function GalaxyBackground({ children }: { children?: React.ReactNode }) {
  const { width, height } = useWindowDimensions();
  const stars = useMemo(() => makeStars(90, width, height, 42), [width, height]);

  return (
    <View style={styles.container}>
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.gradientGalaxy[2]} />
            <Stop offset="0.5" stopColor={colors.gradientGalaxy[1]} />
            <Stop offset="1" stopColor={colors.gradientGalaxy[0]} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill="url(#sky)" />
        {stars.map((star, i) => (
          <Circle key={i} cx={star.x} cy={star.y} r={star.r} fill={colors.starBright} opacity={star.opacity} />
        ))}
      </Svg>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
});
