import React, { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { GalaxyBackground } from "../components/GalaxyBackground";
import { BotAvatar } from "../components/BotAvatar";
import { colors, radii, spacing, typography } from "../theme/colors";
import { api } from "../lib/api";
import { useAuth } from "../lib/AuthContext";

interface Step {
  title: string;
  body: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const STEPS: Step[] = [
  {
    title: "Hey, I'm NexaAi.",
    body: "Ask me anything — fix a car, bake a cake, research a stock, or just talk. I'll break it down into real steps.",
    icon: "sparkles",
  },
  {
    title: "Snap a photo, ask me about it.",
    body: "Point your camera at anything and ask a question — the Camera tab sends the photo straight to me.",
    icon: "camera",
  },
  {
    title: "I remember what matters.",
    body: "Turn on Memory in Capabilities and I'll recall real preferences and ongoing projects across chats — you can review or erase it any time.",
    icon: "bulb",
  },
  {
    title: "You're in control of limits.",
    body: "Every plan has real credit and session limits so I get real rest too — check Plans and Credits any time to see where you stand.",
    icon: "speedometer",
  },
];

/** Reveals `text` character-by-character — a real typewriter effect, not a static label. */
function TypewriterText({ text, style }: { text: string; style: any }) {
  const [shown, setShown] = useState("");
  useEffect(() => {
    setShown("");
    let i = 0;
    const interval = setInterval(() => {
      i += 2;
      setShown(text.slice(0, i));
      if (i >= text.length) clearInterval(interval);
    }, 18);
    return () => clearInterval(interval);
  }, [text]);
  return <Text style={style}>{shown}</Text>;
}

export function OnboardingScreen() {
  const { refreshUser } = useAuth();
  const [stepIndex, setStepIndex] = useState(0);
  const fade = useRef(new Animated.Value(1)).current;
  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;

  const animateTo = (next: number) => {
    Animated.sequence([
      Animated.timing(fade, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
    setTimeout(() => setStepIndex(next), 150);
  };

  const finish = async () => {
    await api("/api/auth/onboarding-complete", { method: "POST" });
    await refreshUser();
  };

  return (
    <GalaxyBackground>
      <View style={styles.container}>
        <TouchableOpacity style={styles.skip} onPress={finish}>
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>

        <Animated.View style={[styles.content, { opacity: fade }]}>
          <BotAvatar size={120} mood="talking" />
          <View style={styles.bubble}>
            <Ionicons name={step.icon} size={22} color={colors.accentBright} style={{ marginBottom: spacing.sm }} />
            <Text style={styles.stepTitle}>{step.title}</Text>
            <TypewriterText text={step.body} style={styles.stepBody} />
          </View>
        </Animated.View>

        <View style={styles.dots}>
          {STEPS.map((_, i) => (
            <View key={i} style={[styles.dot, i === stepIndex && styles.dotActive]} />
          ))}
        </View>

        <View style={styles.footer}>
          {stepIndex > 0 ? (
            <TouchableOpacity style={styles.secondaryButton} onPress={() => animateTo(stepIndex - 1)}>
              <Text style={styles.secondaryButtonText}>Back</Text>
            </TouchableOpacity>
          ) : (
            <View style={{ flex: 1 }} />
          )}
          <TouchableOpacity style={styles.primaryButton} onPress={() => (isLast ? finish() : animateTo(stepIndex + 1))}>
            <Text style={styles.primaryButtonText}>{isLast ? "Let's go" : "Next"}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </GalaxyBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg, justifyContent: "space-between" },
  skip: { alignSelf: "flex-end" },
  skipText: { ...typography.body, color: colors.textMuted },
  content: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.xl },
  bubble: { backgroundColor: colors.bgCard, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.xl, maxWidth: 320 },
  stepTitle: { ...typography.h2, color: colors.textPrimary, marginBottom: spacing.sm },
  stepBody: { ...typography.body, color: colors.textSecondary, minHeight: 66 },
  dots: { flexDirection: "row", justifyContent: "center", gap: spacing.sm, marginBottom: spacing.lg },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.bgCardAlt },
  dotActive: { backgroundColor: colors.accentBright, width: 22 },
  footer: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  primaryButton: { flex: 1, backgroundColor: colors.accent, borderRadius: radii.md, padding: spacing.md, alignItems: "center" },
  primaryButtonText: { color: "#fff", fontWeight: "700" },
  secondaryButton: { flex: 1, backgroundColor: colors.bgCard, borderRadius: radii.md, padding: spacing.md, alignItems: "center", borderWidth: 1, borderColor: colors.border },
  secondaryButtonText: { color: colors.textSecondary, fontWeight: "700" },
});
