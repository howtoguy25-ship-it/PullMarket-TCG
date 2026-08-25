import React, { useState } from "react";
import { View, StyleSheet, LayoutChangeEvent, StyleProp, ViewStyle } from "react-native";

/** Wraps a photo/video element and applies a real 90/180/270 rotation
 * transform, swapping the element's own box dimensions first so the
 * rotated result still fills this wrapper edge-to-edge instead of getting
 * clipped or leaving gaps — the same trick real video players use to honor
 * a stored rotation matrix without re-encoding pixels. Used identically by
 * the Status composer and viewer so a rotated clip looks the same in both. */
export default function RotatedMedia({ rotation, style, children }: { rotation: number; style?: StyleProp<ViewStyle>; children: React.ReactNode }) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ w: width, h: height });
  };
  const swapped = rotation === 90 || rotation === 270;

  const inner: StyleProp<ViewStyle> =
    swapped && size.w > 0
      ? {
          position: "absolute",
          width: size.h,
          height: size.w,
          left: (size.w - size.h) / 2,
          top: (size.h - size.w) / 2,
          transform: [{ rotate: `${rotation}deg` }],
        }
      : rotation
        ? { width: "100%", height: "100%", transform: [{ rotate: `${rotation}deg` }] }
        : { width: "100%", height: "100%" };

  return (
    <View style={[styles.wrap, style]} onLayout={onLayout}>
      <View style={inner}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { width: "100%", height: "100%", overflow: "hidden" } });
