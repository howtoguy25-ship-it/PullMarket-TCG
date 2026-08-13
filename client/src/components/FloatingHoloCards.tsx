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
// re-render — non-infringing holo-card graphics (a colored gradient panel +
// franchise label, same idea as RotatingHoloCard but small and numerous)
// scattered as pure background texture. Positions are percentages of the
// viewport so they scale across phones without needing per-screen-size
// tuning. Spread across the whole screen (not just the top) since the real
// content — search bar, franchise tabs, listing grid — sits in translucent
// panels above this layer, leaving plenty of open galaxy visible around and
// below them for more cards to show through.
const CARD_SPECS: CardSpec[] = [
  { label: "POKÉMON", colors: ["#38BDF8", "#2563EB", "#1E3A8A"], top: 0.06, left: 0.06, size: 64, spinDuration: 6000, spinDelay: 0, bobDuration: 2400, rotateDirection: 1 },
  { label: "ONE PIECE", colors: ["#F97316", "#DC2626", "#7C2D12"], top: 0.1, left: 0.72, size: 56, spinDuration: 7200, spinDelay: 400, bobDuration: 2800, rotateDirection: -1 },
  { label: "POKÉMON", colors: ["#FACC15", "#F59E0B", "#B45309"], top: 0.24, left: 0.4, size: 48, spinDuration: 5400, spinDelay: 900, bobDuration: 2000, rotateDirection: 1 },
  { label: "ONE PIECE", colors: ["#FBBF24", "#DC2626", "#7C2D12"], top: 0.34, left: 0.1, size: 58, spinDuration: 8000, spinDelay: 200, bobDuration: 3200, rotateDirection: -1 },
  { label: "POKÉMON", colors: ["#A855F7", "#7C3AED", "#4C1D95"], top: 0.4, left: 0.78, size: 50, spinDuration: 6600, spinDelay: 1200, bobDuration: 2600, rotateDirection: 1 },
  { label: "ONE PIECE", colors: ["#F43F5E", "#DB2777", "#831843"], top: 0.16, left: 0.28, size: 44, spinDuration: 5000, spinDelay: 600, bobDuration: 1800, rotateDirection: -1 },
  { label: "POKÉMON", colors: ["#34D399", "#059669", "#065F46"], top: 0.5, left: 0.14, size: 52, spinDuration: 7000, spinDelay: 1500, bobDuration: 2700, rotateDirection: -1 },
  { label: "ONE PIECE", colors: ["#FB923C", "#EA580C", "#7C2D12"], top: 0.55, left: 0.62, size: 60, spinDuration: 6200, spinDelay: 300, bobDuration: 3000, rotateDirection: 1 },
  { label: "POKÉMON", colors: ["#60A5FA", "#3B82F6", "#1E40AF"], top: 0.64, left: 0.32, size: 46, spinDuration: 5800, spinDelay: 1100, bobDuration: 2200, rotateDirection: 1 },
  { label: "ONE PIECE", colors: ["#F472B6", "#DB2777", "#831843"], top: 0.7, left: 0.8, size: 54, spinDuration: 6800, spinDelay: 700, bobDuration: 2900, rotateDirection: -1 },
  { label: "POKÉMON", colors: ["#FDE047", "#EAB308", "#854D0E"], top: 0.78, left: 0.06, size: 50, spinDuration: 5600, spinDelay: 1400, bobDuration: 2500, rotateDirection: -1 },
  { label: "ONE PIECE", colors: ["#C084FC", "#9333EA", "#581C87"], top: 0.84, left: 0.5, size: 58, spinDuration: 7400, spinDelay: 500, bobDuration: 3100, rotateDirection: 1 },
  { label: "POKÉMON", colors: ["#F87171", "#DC2626", "#7F1D1D"], top: 0.9, left: 0.75, size: 44, spinDuration: 5200, spinDelay: 1000, bobDuration: 2000, rotateDirection: 1 },
];

function MiniHoloCard({ spec }: { spec: CardSpec }) {
  const rotation = useSharedValue(0);
  const bob = useSharedValue(0);

  useEffect(() => {
    // A full 360° rotateY spin passes through ~90°-270° where a single-face
    // card (no back face rendered) shows its mirrored underside — the label
    // text reads backwards/garbled right when it's most visible. Oscillating
    // between a modest +/- angle instead keeps the face essentially always
    // forward-on, so the text stays legible throughout while still catching
    // the "light" like a hologram as it gently rocks.
    const maxAngle = 24 * spec.rotateDirection;
    rotation.value = withDelay(
      spec.spinDelay,
      withRepeat(withSequence(withTiming(maxAngle, { duration: spec.spinDuration / 2, easing: Easing.inOut(Easing.sin) }), withTiming(-maxAngle, { duration: spec.spinDuration / 2, easing: Easing.inOut(Easing.sin) })), -1, true),
    );
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
          {/* Single line, sized to always fit: at the smallest card sizes,
             "POKÉMON"/"ONE PIECE" wrapping mid-word left a lone orphaned
             "N" on its own line, which read as a spacing glitch rather
             than text wrap. A smaller size-scaled font with no
             letterSpacing measures narrower than the old one at every
             card size in this layout (44-64px), so it fits on one line
             without needing to wrap or truncate — adjustsFontSizeToFit is
             also set as a native-only safety net (react-native-web
             doesn't support it, hence sizing to fit outright instead of
             relying on it). */}
          <Text style={[styles.cardLabel, { fontSize: spec.size * 0.14 }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
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
  cardInner: { flex: 1, alignItems: "center", justifyContent: "center", padding: 2 },
  cardLabel: { color: "rgba(255,255,255,0.95)", fontWeight: "800", textAlign: "center" },
});
