import React from "react";
import { View, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

// A small set of original, non-infringing palette + "gear" combinations —
// evokes the adventurer/trainer energy of the genre without depicting any
// copyrighted character. Deterministically picked per-user so the same
// person always gets the same look.
const PALETTES: [string, string][] = [
  ["#F97316", "#EF4444"], // fire
  ["#22D3EE", "#2563EB"], // water
  ["#A3E635", "#16A34A"], // leaf
  ["#FACC15", "#F59E0B"], // spark
  ["#C084FC", "#7C3AED"], // mystic
  ["#F472B6", "#DB2777"], // bloom
];

type Gear = "cap" | "bandana" | "antenna";
const GEARS: Gear[] = ["cap", "bandana", "antenna"];

function hashSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h;
}

function GearShape({ gear, size, color }: { gear: Gear; size: number; color: string }) {
  if (gear === "cap") {
    return <View style={[gearStyles.cap, { width: size * 0.9, height: size * 0.35, backgroundColor: color, top: -size * 0.08 }]} />;
  }
  if (gear === "bandana") {
    return <View style={[gearStyles.bandana, { width: size * 0.95, height: size * 0.22, backgroundColor: color, top: size * 0.02 }]} />;
  }
  return (
    <View style={[gearStyles.antennaWrap, { top: -size * 0.22 }]}>
      <View style={[gearStyles.antennaStem, { backgroundColor: color, height: size * 0.22 }]} />
      <View style={[gearStyles.antennaBall, { backgroundColor: color, width: size * 0.16, height: size * 0.16, borderRadius: size * 0.08 }]} />
    </View>
  );
}

/** A small original mascot badge used as the default avatar wherever a
 * user hasn't set a real photo — an adventurer-styled blob with simple
 * eyes and one of a few "gear" accents, not any copyrighted character. */
export function MascotAvatar({ seed, size = 36 }: { seed: string; size?: number }) {
  const h = hashSeed(seed || "pullmarket");
  const [colorA, colorB] = PALETTES[h % PALETTES.length];
  const gear = GEARS[Math.floor(h / PALETTES.length) % GEARS.length];
  const eyeSize = size * 0.11;
  const eyeOffsetX = size * 0.16;

  return (
    <View style={{ width: size, height: size }}>
      <LinearGradient colors={[colorA, colorB]} style={[styles.blob, { width: size, height: size, borderRadius: size / 2 }]}>
        <View style={[styles.eyesRow, { top: size * 0.42 }]}>
          <View style={[styles.eye, { width: eyeSize, height: eyeSize, borderRadius: eyeSize / 2, marginRight: eyeOffsetX }]} />
          <View style={[styles.eye, { width: eyeSize, height: eyeSize, borderRadius: eyeSize / 2 }]} />
        </View>
      </LinearGradient>
      <View style={[styles.gearAnchor, { width: size }]}>
        <GearShape gear={gear} size={size} color="rgba(255,255,255,0.92)" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  blob: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
  eyesRow: { flexDirection: "row", position: "absolute" },
  eye: { backgroundColor: "rgba(11,7,22,0.85)" },
  gearAnchor: { position: "absolute", alignItems: "center" },
});

const gearStyles = StyleSheet.create({
  cap: { position: "absolute", borderTopLeftRadius: 999, borderTopRightRadius: 999 },
  bandana: { position: "absolute", borderRadius: 4 },
  antennaWrap: { position: "absolute", alignItems: "center" },
  antennaStem: { width: 2 },
  antennaBall: {},
});
