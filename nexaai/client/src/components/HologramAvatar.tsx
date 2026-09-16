import React, { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, Ellipse, LinearGradient, Line, Polygon, RadialGradient, Stop } from "react-native-svg";
import { BotAvatar, type BotAvatarProps } from "./BotAvatar";

const AnimatedEllipse = Animated.createAnimatedComponent(Ellipse);
const AnimatedPolygon = Animated.createAnimatedComponent(Polygon);
const AnimatedLine = Animated.createAnimatedComponent(Line);

interface HologramAvatarProps {
  size?: number;
  mood: BotAvatarProps["mood"];
  /** Real 0-1 speaking amplitude — see CallScreen's playReplyWeb (Web Audio analyser on the actual TTS reply waveform). */
  liveMouthLevel?: Animated.Value;
  /** Real 0-1 mic amplitude — the same dBFS metering CallScreen's VAD logic already reads off the actual microphone. */
  liveMicLevel?: Animated.Value;
}

const HOLO_CYAN = "#4DE8FF";
const HOLO_BRIGHT = "#CFFBFF";

/**
 * NexaAi presented as a real sci-fi holographic projection — a genuine 3D
 * perspective transform (perspective + a bounded rotateY turn for the
 * core, rotateX + a full rotateZ spin for a tilted "orbit ring" — the
 * same matrix math a CSS/native 3D engine uses for a turning card or a
 * tilted spinning disc), not a 2D crossfade pretending to be 3D. It lives
 * inside a bracketed "hologram box" frame —
 * double-stroked brackets for a soft bloom look — with a projector beam,
 * rising light motes, and a pedestal, laid out so the beam sits cleanly
 * below the character instead of cutting across its face.
 *
 * Every reactive element is driven by REAL audio data already computed
 * upstream (CallScreen's liveMouthLevel/liveMicLevel, themselves read off
 * an actual playing/recording waveform): the beam brightens and widens,
 * the brackets glow harder, a sonar-style ring pulses from the pedestal,
 * and the core's own scale ticks up with the real amplitude. The idle
 * motion (slow spin, orbit ring, gentle levitating bob, drifting scan-
 * lines, rising motes, an occasional flicker) keeps it alive even at rest.
 */
export function HologramAvatar({ size = 156, mood, liveMouthLevel, liveMicLevel }: HologramAvatarProps) {
  const spin = useRef(new Animated.Value(0)).current;
  const orbitSpin = useRef(new Animated.Value(0)).current;
  const orbitSpin2 = useRef(new Animated.Value(0)).current;
  const bob = useRef(new Animated.Value(0)).current;
  const scanOffset = useRef(new Animated.Value(0)).current;
  const flicker = useRef(new Animated.Value(1)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const particles = useRef([0, 1, 2, 3].map(() => new Animated.Value(0))).current;
  const zeroLevel = useRef(new Animated.Value(0)).current;
  const mouthLevel = liveMouthLevel ?? zeroLevel;
  const micLevel = liveMicLevel ?? zeroLevel;

  // A slow, bounded turntable turn — real perspective/rotateY transform
  // math, oscillating rather than spinning a full 360°. A full spin looks
  // right on an actual 3D mesh, but this core is a flat billboard (the same
  // face BotAvatar draws), so a full rotation would hit 90°/270° edge-on
  // and visibly vanish twice a cycle — verified live, and it read as
  // broken, not "hologram." A bounded turn (-30°..30°) keeps the face
  // recognizable through the whole motion while still showing genuine
  // perspective foreshortening as it turns.
  useEffect(() => {
    spin.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(spin, { toValue: 1, duration: 2400, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
        Animated.timing(spin, { toValue: -1, duration: 4800, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
        Animated.timing(spin, { toValue: 0, duration: 2400, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);

  // Two tilted "orbit rings" spinning at different rates, opposite
  // directions — a real, independent rotateX+rotateZ transform per ring,
  // giving genuine parallax depth (like nested HUD rings), not one flat decal.
  useEffect(() => {
    orbitSpin.setValue(0);
    const loop = Animated.loop(Animated.timing(orbitSpin, { toValue: 1, duration: 5200, easing: Easing.linear, useNativeDriver: false }));
    loop.start();
    return () => loop.stop();
  }, [orbitSpin]);

  useEffect(() => {
    orbitSpin2.setValue(0);
    const loop = Animated.loop(Animated.timing(orbitSpin2, { toValue: 1, duration: 3400, easing: Easing.linear, useNativeDriver: false }));
    loop.start();
    return () => loop.stop();
  }, [orbitSpin2]);

  // Gentle levitating float — a smooth sine-like bob, the one thing that
  // most sells "this is weightless light, not a sprite" at rest.
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
        Animated.timing(bob, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [bob]);

  // Scan-lines drifting upward through the beam — a hologram-authenticity
  // detail, looping independently of the real audio signal below.
  useEffect(() => {
    scanOffset.setValue(0);
    const loop = Animated.loop(Animated.timing(scanOffset, { toValue: 1, duration: 1300, easing: Easing.linear, useNativeDriver: false }));
    loop.start();
    return () => loop.stop();
  }, [scanOffset]);

  // Light motes rising from the pedestal through the beam, staggered so
  // they never all move in lockstep.
  useEffect(() => {
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    const loops = particles.map((val, i) => {
      val.setValue(0);
      const loop = Animated.loop(Animated.timing(val, { toValue: 1, duration: 2400 + i * 260, easing: Easing.linear, useNativeDriver: false }));
      timeouts.push(setTimeout(() => loop.start(), i * 480));
      return loop;
    });
    return () => {
      timeouts.forEach(clearTimeout);
      loops.forEach((l) => l.stop());
    };
  }, [particles]);

  // A small, irregular flicker — real holograms aren't perfectly stable —
  // on its own random cadence, independent of the audio-driven elements.
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const scheduleFlicker = () => {
      timeout = setTimeout(() => {
        Animated.sequence([
          Animated.timing(flicker, { toValue: 0.55, duration: 45, useNativeDriver: false }),
          Animated.timing(flicker, { toValue: 1, duration: 90, useNativeDriver: false }),
        ]).start(scheduleFlicker);
      }, 1800 + Math.random() * 2600);
    };
    scheduleFlicker();
    return () => clearTimeout(timeout);
  }, [flicker]);

  // A sonar-style ring pinging outward from the pedestal on a slow loop —
  // purely ambient, layered under the real audio-driven ring below.
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 2000, easing: Easing.out(Easing.quad), useNativeDriver: false }));
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const rotateY = spin.interpolate({ inputRange: [-1, 1], outputRange: ["-30deg", "30deg"] });
  const orbitRotateZ = orbitSpin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const orbitRotateZ2 = orbitSpin2.interpolate({ inputRange: [0, 1], outputRange: ["360deg", "0deg"] });
  const bobTranslateY = bob.interpolate({ inputRange: [0, 1], outputRange: [-size * 0.02, size * 0.02] });
  // A specular highlight that sweeps across the face as the core turns —
  // tied directly to the real rotation value, not a separate decorative
  // loop, so it reads as light catching a curved surface rather than a
  // flat sprite with a glow slapped on top.
  const highlightTranslateX = spin.interpolate({ inputRange: [-1, 0, 1], outputRange: [-size * 0.16, 0, size * 0.16] });
  const highlightOpacity = spin.interpolate({ inputRange: [-1, -0.3, 0, 0.3, 1], outputRange: [0.08, 0.32, 0.48, 0.32, 0.08] });

  // Real audio energy — whichever of speaking/listening is actually live —
  // drives the beam, brackets, ring, and core scale below. Nothing here
  // moves without a real signal behind it.
  const energy = Animated.add(mouthLevel, micLevel);
  const beamOpacity = energy.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.9], extrapolate: "clamp" });
  const beamWidthScale = energy.interpolate({ inputRange: [0, 1], outputRange: [1, 1.22], extrapolate: "clamp" });
  const coreScale = energy.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08], extrapolate: "clamp" });
  const ringScale = energy.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35], extrapolate: "clamp" });
  const ringOpacity = energy.interpolate({ inputRange: [0, 1], outputRange: [0, 0.55], extrapolate: "clamp" });
  const bracketOpacity = energy.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1], extrapolate: "clamp" });
  const bracketGlowWidth = energy.interpolate({ inputRange: [0, 1], outputRange: [4, 7], extrapolate: "clamp" });
  const scanTranslateY = scanOffset.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.3] });
  const pedestalPulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1.6] });
  const pedestalPulseOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] });

  // Explicit stacked geometry (in terms of `size`) so the beam always sits
  // cleanly below the character instead of guessing at overlapping percentages.
  const coreSize = size * 0.6;
  const coreTopPad = size * 0.04;
  const gapBelowCore = size * 0.02;
  const beamHeight = size * 0.58;
  const pedestalHeight = size * 0.16;
  const beamTop = coreTopPad + coreSize + gapBelowCore;
  const boxH = beamTop + beamHeight + pedestalHeight * 0.5;
  const boxW = size;
  const pedestalCenterY = boxH - pedestalHeight * 0.5;

  const particleOffsets = useMemo(() => [-size * 0.09, -size * 0.03, size * 0.03, size * 0.09], [size]);

  return (
    <View style={{ width: boxW, height: boxH, alignItems: "center" }}>
      {/* Hologram-box corner brackets — double-stroked (a soft wide halo behind a crisp bright line) for a bloom look, brightening with real audio energy. */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Svg width={boxW} height={boxH}>
          {(
            [
              [4, 4, 20, 4, 4, 20],
              [boxW - 4, 4, boxW - 20, 4, boxW - 4, 20],
              [4, boxH - 4, 20, boxH - 4, 4, boxH - 20],
              [boxW - 4, boxH - 4, boxW - 20, boxH - 4, boxW - 4, boxH - 20],
            ] as const
          ).map(([x, y, x1, y1, x2, y2], i) => (
            <React.Fragment key={i}>
              <AnimatedLine x1={x} y1={y} x2={x1} y2={y1} stroke={HOLO_CYAN} strokeWidth={bracketGlowWidth as unknown as number} strokeOpacity={0.18} strokeLinecap="round" />
              <AnimatedLine x1={x} y1={y} x2={x2} y2={y2} stroke={HOLO_CYAN} strokeWidth={bracketGlowWidth as unknown as number} strokeOpacity={0.18} strokeLinecap="round" />
              <AnimatedLine x1={x} y1={y} x2={x1} y2={y1} stroke={HOLO_BRIGHT} strokeWidth={2} strokeOpacity={bracketOpacity as unknown as number} strokeLinecap="round" />
              <AnimatedLine x1={x} y1={y} x2={x2} y2={y2} stroke={HOLO_BRIGHT} strokeWidth={2} strokeOpacity={bracketOpacity as unknown as number} strokeLinecap="round" />
            </React.Fragment>
          ))}
        </Svg>
      </View>

      {/* Projector beam rising from the pedestal — real amplitude drives its glow/width. */}
      <Animated.View pointerEvents="none" style={[styles.beamWrap, { top: beamTop, opacity: beamOpacity, transform: [{ scaleX: beamWidthScale }] }]}>
        <Svg width={size * 0.9} height={beamHeight} viewBox={`0 0 ${size * 0.9} ${beamHeight}`}>
          <Defs>
            <LinearGradient id="beamFade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={HOLO_CYAN} stopOpacity={0.5} />
              <Stop offset="1" stopColor={HOLO_CYAN} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <AnimatedPolygon points={`${size * 0.45},0 ${size * 0.16},${beamHeight} ${size * 0.74},${beamHeight}`} fill="url(#beamFade)" />
        </Svg>
      </Animated.View>

      {/* Scan-lines drifting through the beam. */}
      <Animated.View pointerEvents="none" style={[styles.scanWrap, { top: beamTop, height: beamHeight, transform: [{ translateY: scanTranslateY }] }]}>
        {Array.from({ length: 6 }).map((_, i) => (
          <View key={i} style={[styles.scanLine, { top: i * beamHeight * 0.22 }]} />
        ))}
      </Animated.View>

      {/* Light motes rising from the pedestal, through the beam, toward the core. */}
      {particles.map((val, i) => {
        const translateY = val.interpolate({ inputRange: [0, 1], outputRange: [0, -beamHeight] });
        const opacity = val.interpolate({ inputRange: [0, 0.15, 0.8, 1], outputRange: [0, 1, 1, 0] });
        return (
          <Animated.View
            key={i}
            pointerEvents="none"
            style={[
              styles.mote,
              { top: beamTop + beamHeight, left: boxW / 2 + particleOffsets[i] - 2, opacity, transform: [{ translateY }] },
            ]}
          />
        );
      })}

      {/* Listening/speaking energy ring around the core — real amplitude, not decorative. */}
      <Animated.View
        pointerEvents="none"
        style={[styles.energyRing, { top: coreTopPad, width: coreSize * 1.4, height: coreSize * 1.4, opacity: ringOpacity, transform: [{ scale: ringScale }] }]}
      />

      {/* The real 3D-rotating hologram core, gently levitating. */}
      <Animated.View
        style={{
          marginTop: coreTopPad,
          opacity: flicker,
          transform: [{ perspective: 900 }, { translateY: bobTranslateY }, { rotateY }, { scale: coreScale }],
        }}
      >
        {/* Tilted orbit ring, viewed at an angle and spinning independently — a real rotateX + rotateZ transform, not a flat decal. */}
        <View pointerEvents="none" style={[styles.orbitRingWrap, { width: coreSize * 1.5, height: coreSize * 1.5, top: -coreSize * 0.25, left: -coreSize * 0.25 }]}>
          <Animated.View style={{ width: "100%", height: "100%", transform: [{ perspective: 700 }, { rotateX: "72deg" }, { rotateZ: orbitRotateZ }] }}>
            <Svg width={coreSize * 1.5} height={coreSize * 1.5}>
              <AnimatedEllipse
                cx={(coreSize * 1.5) / 2}
                cy={(coreSize * 1.5) / 2}
                rx={(coreSize * 1.5) / 2 - 3}
                ry={(coreSize * 1.5) / 2 - 3}
                stroke={HOLO_CYAN}
                strokeWidth={1.5}
                strokeDasharray="6,7"
                fill="none"
                opacity={bracketOpacity as unknown as number}
              />
            </Svg>
          </Animated.View>
        </View>

        {/* A second, smaller orbit ring spinning the opposite way at a different rate — real nested-HUD depth. */}
        <View pointerEvents="none" style={[styles.orbitRingWrap, { width: coreSize * 1.15, height: coreSize * 1.15, top: -coreSize * 0.075, left: -coreSize * 0.075 }]}>
          <Animated.View style={{ width: "100%", height: "100%", transform: [{ perspective: 700 }, { rotateX: "68deg" }, { rotateZ: orbitRotateZ2 }] }}>
            <Svg width={coreSize * 1.15} height={coreSize * 1.15}>
              <AnimatedEllipse
                cx={(coreSize * 1.15) / 2}
                cy={(coreSize * 1.15) / 2}
                rx={(coreSize * 1.15) / 2 - 2}
                ry={(coreSize * 1.15) / 2 - 2}
                stroke={HOLO_BRIGHT}
                strokeWidth={1}
                strokeDasharray="2,9"
                fill="none"
                opacity={bracketOpacity as unknown as number}
              />
            </Svg>
          </Animated.View>
        </View>

        <View style={styles.coreTint}>
          <BotAvatar size={coreSize} mood={mood} liveMouthLevel={mouthLevel} glowColor={HOLO_CYAN} />
        </View>
      </Animated.View>

      {/* Specular highlight sweeping across the face as it turns — driven by the same real rotation value, not a separate loop. */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.highlightWrap,
          { top: coreTopPad, width: coreSize, height: coreSize, opacity: highlightOpacity, transform: [{ translateX: highlightTranslateX }] },
        ]}
      >
        <Svg width={coreSize} height={coreSize}>
          <Defs>
            <RadialGradient id="specular" cx="38%" cy="34%" r="30%">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.9} />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Ellipse cx={coreSize * 0.38} cy={coreSize * 0.34} rx={coreSize * 0.22} ry={coreSize * 0.3} fill="url(#specular)" />
        </Svg>
      </Animated.View>

      {/* Pedestal the beam rises from, with a sonar-style ping outward and a holographic grid floor for real spatial depth. */}
      <View style={{ position: "absolute", top: pedestalCenterY - size * 0.08, alignItems: "center" }}>
        <Animated.View
          pointerEvents="none"
          style={[styles.pedestalPing, { opacity: pedestalPulseOpacity, transform: [{ scale: pedestalPulseScale }] }]}
        />
        <Svg width={size * 0.9} height={pedestalHeight + size * 0.1} style={{ position: "absolute", top: -size * 0.05 }}>
          {/* Concentric grid rings + radial spokes, flattened into an ellipse to read as a floor seen at an angle. */}
          {[0.42, 0.3, 0.18].map((r, i) => (
            <Ellipse
              key={i}
              cx={(size * 0.9) / 2}
              cy={(pedestalHeight + size * 0.1) / 2}
              rx={size * r}
              ry={(pedestalHeight + size * 0.1) * r * 0.55}
              stroke={HOLO_CYAN}
              strokeWidth={1}
              strokeOpacity={0.22 - i * 0.04}
              fill="none"
            />
          ))}
          {[0, 30, 60, 90, 120, 150].map((deg, i) => {
            const rad = (deg * Math.PI) / 180;
            const cx = (size * 0.9) / 2;
            const cy = (pedestalHeight + size * 0.1) / 2;
            const rx = size * 0.42;
            const ry = (pedestalHeight + size * 0.1) * 0.42 * 0.55;
            return (
              <Line
                key={i}
                x1={cx - rx * Math.cos(rad)}
                y1={cy - ry * Math.sin(rad)}
                x2={cx + rx * Math.cos(rad)}
                y2={cy + ry * Math.sin(rad)}
                stroke={HOLO_CYAN}
                strokeWidth={0.75}
                strokeOpacity={0.14}
              />
            );
          })}
        </Svg>
        <Svg width={size * 0.68} height={pedestalHeight}>
          <Defs>
            <RadialGradient id="pedestalGlow" cx="50%" cy="35%" r="65%">
              <Stop offset="0" stopColor={HOLO_CYAN} stopOpacity={0.85} />
              <Stop offset="1" stopColor="#0B1E2B" stopOpacity={0.95} />
            </RadialGradient>
          </Defs>
          <Ellipse cx={(size * 0.68) / 2} cy={pedestalHeight / 2} rx={size * 0.32} ry={pedestalHeight * 0.42} fill="url(#pedestalGlow)" />
          <Circle cx={(size * 0.68) / 2} cy={pedestalHeight / 2} r={size * 0.045} fill={HOLO_BRIGHT} />
        </Svg>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  beamWrap: { position: "absolute", alignItems: "center" },
  scanWrap: { position: "absolute", width: "100%", overflow: "hidden" },
  scanLine: { position: "absolute", left: "18%", right: "18%", height: 2, backgroundColor: "#8FF6FF", opacity: 0.35 },
  mote: { position: "absolute", width: 4, height: 4, borderRadius: 2, backgroundColor: HOLO_BRIGHT },
  energyRing: { position: "absolute", borderRadius: 999, borderWidth: 2, borderColor: HOLO_CYAN },
  orbitRingWrap: { position: "absolute" },
  highlightWrap: { position: "absolute" },
  coreTint: { opacity: 0.92 },
  pedestalPing: { position: "absolute", width: 46, height: 14, borderRadius: 23, borderWidth: 1.5, borderColor: HOLO_CYAN },
});
