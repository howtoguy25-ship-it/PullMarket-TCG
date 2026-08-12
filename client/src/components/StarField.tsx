import React, { useMemo } from "react";
import { View, StyleSheet } from "react-native";

/** A scattering of small white dots, percentage-positioned so it scales to
 * whatever container it's placed in — a light "galaxy" accent for dark
 * headers, without needing the container's pixel size up front. */
export function StarField({ count = 24 }: { count?: number }) {
  const stars = useMemo(
    () =>
      Array.from({ length: count }, () => ({
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: Math.random() * 2 + 0.8,
        opacity: Math.random() * 0.6 + 0.3,
      })),
    [count],
  );

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {stars.map((s, i) => (
        <View
          key={i}
          style={{
            position: "absolute",
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: s.size,
            height: s.size,
            borderRadius: s.size,
            backgroundColor: "#FFFFFF",
            opacity: s.opacity,
          }}
        />
      ))}
    </View>
  );
}
