import React, { useEffect, useMemo } from "react";
import { View, StyleSheet, Text, Dimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, withSequence, withDelay, Easing } from "react-native-reanimated";

const { width, height } = Dimensions.get("window");

interface CardSpec {
  label: "POKÉMON" | "ONE PIECE";
  colors: [string, string, string];
  top: number;
  left: number;
  size: number;
  spinDuration: number;
  spinDelay: number;
  bobDuration: number;
  rotateDirection: 1 | -1;
}

// Fixed layout (not re-randomized per render) so cards don't jump around on
// re-render — six original, non-infringing holo-card graphics (a colored
// gradient panel + franchise label, same idea as RotatingHoloCard but small
// and numerous) scattered as pure background texture. Positions are
// percentages of the viewport so they scale across phones without needing
// per-screen-size tuning.
const CARD_SPECS: CardSpec[] = [
  { label: "POKÉMON", colors: ["#38BDF8", "#2563EB", "#1E3A8A"], top: 0.06, left: 0.06, size: 64, spinDuration: 6000, spinDelay: 0, bobDuration: 2400, rotateDirection: 1 },
  { label: "ONE PIECE", colors: ["#F97316", "#DC2626", "#7C2D12"], top: 0.1, left: 0.72, size: 56, spinDuration: 7200, spinDelay: 400, bobDuration: 2800, rotateDirection: -1 },
  { label: "POKÉMON", colors: ["#FACC15", "#F59E0B", "#B45309"], top: 0.24, left: 0.4, size: 48, spinDuration: 5400, spinDelay: 900, bobDuration: 2000, rotateDirection: 1 },
  { label: "ONE PIECE", colors: ["#FBBF24", "#DC2626", "#7C2D12"], top: 0.34, left: 0.1, size: 58, spinDuration: 8000, spinDelay: 200, bobDuration: 3200, rotateDirection: -1 },
  { label: "POKÉMON", colors: ["#A855F7", "#7C3AED", "#4C1D95"], top: 0.4, left: 0.78, size: 50, spinDuration: 6600, spinDelay: 1200, bobDuration: 2600, rotateDirection: 1 },
  { label: "ONE PIECE", colors: ["#F43F5E", "#DB2777", "#831843"], top: 0.16, left: 0.28, size: 44, spinDuration: 5000, spinDelay: 600, bobDuration: 1800, rotateDirection: -1 },
];

function MiniHoloCard({ spec }: { spec: CardSpec }) {
  const rotation = useSharedValue(0);
  const bob = useSharedValue(0);

  useEffect(() => {
    rotation.value = withDelay(spec.spinDelay, withRepeat(withTiming(360 * spec.rotateDirection, { duration: spec.spinDuration, easing: Easing.linear }), -1, false));
    bob.value = withRepeat(
      withSequence(withTiming(-8, { duration: spec.bobDuration, easing: Easing.inOut(Easing.sin) }), withTiming(8, { duration: spec.bobDuration, easing: Easing.inOut(Easing.sin) })),
      -1,
      true,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 700 }, { translateY: bob.value }, { rotateY: `${rotation.value}deg` }],
  }));

  const cardHeight = spec.size * 1.4;

  return (
    <Animated.View
      style={[
        styles.cardPosition,
        { top: height * spec.top, left: width * spec.left, width: spec.size, height: cardHeight },
        animatedStyle,
      ]}
    >
      <LinearGradient colors={spec.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.card, { width: spec.size, height: cardHeight, borderRadius: spec.size * 0.12 }]}>
        <View style={styles.cardInner}>
          <Text style={[styles.cardLabel, { fontSize: spec.size * 0.13 }]} numberOfLines={2}>
            {spec.label}
          </Text>
        </View>
      </LinearGradient>
    </Animated.View>
  );
}

/** Decorative, non-interactive background layer: several small holographic
 * trading-card graphics slowly spinning/bobbing at fixed positions, in a
 * mix of colors, each labeled with a franchise name — pure texture behind
 * the real screen content, never blocking taps (pointerEvents="none" all
 * the way down) and rendered first in the tree so real content stacks on
 * top of it. */
export function FloatingHoloCards() {
  const specs = useMemo(() => CARD_SPECS, []);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {specs.map((spec, i) => (
        <MiniHoloCard key={i} spec={spec} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  cardPosition: { position: "absolute" },
  card: { flex: 1, overflow: "hidden", opacity: 0.5, borderWidth: 1, borderColor: "rgba(255,255,255,0.35)" },
  cardInner: { flex: 1, alignItems: "center", justifyContent: "center", padding: 4 },
  cardLabel: { color: "rgba(255,255,255,0.95)", fontWeight: "800", textAlign: "center", letterSpacing: 0.5 },
});
