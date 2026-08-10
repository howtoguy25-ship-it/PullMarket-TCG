import React, { useEffect } from "react";
import { View, StyleSheet, Text } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, withSequence, Easing } from "react-native-reanimated";
import { Colors } from "@/constants/theme";

const CARD_WIDTH = 190;
const CARD_HEIGHT = CARD_WIDTH * 1.4;

function CardFace({ back }: { back?: boolean }) {
  return (
    <View style={[styles.face, back && styles.backFace]}>
      <LinearGradient
        colors={back ? ["#1C1040", "#3B1E6B", "#1C1040"] : ["#22D3EE", "#7C3AED", "#DB2777", "#F59E0B"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.faceGradient}
      >
        <View style={styles.innerBorder}>
          <View style={styles.innerPanel}>
            {back ? (
              <>
                <Feather name="hexagon" size={54} color={Colors.gold} />
                <Text style={styles.backText}>PULLMARKET</Text>
              </>
            ) : (
              <>
                <View style={styles.rarityDot} />
                <Feather name="star" size={56} color={Colors.gold} />
                <View style={styles.nameBar} />
                <View style={styles.nameBarShort} />
              </>
            )}
          </View>
        </View>
      </LinearGradient>
    </View>
  );
}

/** A generic, original holographic trading-card graphic (no copyrighted
 * characters) that continuously spins on its Y axis — a real, working
 * Reanimated animation, not a static image — for the Welcome screen hero. */
export function RotatingHoloCard() {
  const rotation = useSharedValue(0);
  const bob = useSharedValue(0);

  useEffect(() => {
    rotation.value = withRepeat(withTiming(360, { duration: 7000, easing: Easing.linear }), -1, false);
    bob.value = withRepeat(withSequence(withTiming(-10, { duration: 1800, easing: Easing.inOut(Easing.sin) }), withTiming(10, { duration: 1800, easing: Easing.inOut(Easing.sin) })), -1, true);
  }, []);

  const spinStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 900 }, { translateY: bob.value }, { rotateY: `${rotation.value}deg` }],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: 0.35 + Math.abs(Math.sin((rotation.value * Math.PI) / 180)) * 0.25,
  }));

  return (
    <View style={styles.container} pointerEvents="none">
      <Animated.View style={[styles.glow, glowStyle]} />
      <Animated.View style={[styles.cardWrap, spinStyle]}>
        <CardFace />
        <CardFace back />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "center", justifyContent: "center", height: CARD_HEIGHT + 60 },
  glow: {
    position: "absolute",
    width: CARD_WIDTH * 1.8,
    height: CARD_WIDTH * 1.8,
    borderRadius: (CARD_WIDTH * 1.8) / 2,
    backgroundColor: "#A855F7",
  },
  cardWrap: { width: CARD_WIDTH, height: CARD_HEIGHT },
  face: {
    position: "absolute",
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 16,
    backfaceVisibility: "hidden",
    overflow: "hidden",
  },
  backFace: { transform: [{ rotateY: "180deg" }] },
  faceGradient: { flex: 1, padding: 6 },
  innerBorder: { flex: 1, borderWidth: 2, borderColor: "rgba(255,255,255,0.85)", borderRadius: 12, padding: 8 },
  innerPanel: { flex: 1, backgroundColor: "rgba(11,7,22,0.55)", borderRadius: 8, alignItems: "center", justifyContent: "center", gap: 14 },
  rarityDot: { position: "absolute", top: 12, left: 12, width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.gold },
  nameBar: { width: "60%", height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.85)" },
  nameBarShort: { width: "38%", height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.5)" },
  backText: { color: "rgba(255,255,255,0.85)", fontWeight: "800", fontSize: 12, letterSpacing: 2 },
});
