import React, { useState } from "react";
import { ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { GalaxyBackground } from "../components/GalaxyBackground";
import { colors, radii, spacing, typography } from "../theme/colors";
import { useAuth } from "../lib/AuthContext";
import { api } from "../lib/api";
import { VOICE_CHARACTERS, speak } from "../lib/voice";
import type { MapsApp } from "../lib/maps";

const MAPS_OPTIONS: { id: MapsApp; label: string }[] = [
  { id: "apple", label: "Apple Maps" },
  { id: "google", label: "Google Maps" },
  { id: "trackline", label: "TrackLine" },
];

export function SettingsScreen() {
  const { user, logout, refreshUser } = useAuth();
  const navigation = useNavigation<any>();
  const [proactive, setProactive] = useState(user?.proactiveCheckInEnabled ?? true);

  const patch = async (body: Record<string, unknown>) => {
    await api("/api/auth/settings", { method: "PATCH", body: JSON.stringify(body) });
    await refreshUser();
  };

  const toggleProactive = async (value: boolean) => {
    setProactive(value);
    await patch({ proactiveCheckInEnabled: value });
  };

  if (!user) return null;

  return (
    <GalaxyBackground>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Settings</Text>

        <Section title="Voice character">
          {VOICE_CHARACTERS.map((c) => (
            <TouchableOpacity
              key={c.id}
              style={[styles.row, user.voiceCharacterId === c.id && styles.rowActive]}
              onPress={() => {
                patch({ voiceCharacterId: c.id });
                speak(`Hi, I'm ${c.displayName}.`, c.id);
              }}
            >
              <Text style={styles.rowLabel}>
                {c.displayName} · {c.gender}, {c.tone}
              </Text>
              {user.voiceCharacterId === c.id && <Text style={styles.checkmark}>✓</Text>}
            </TouchableOpacity>
          ))}
        </Section>

        <Section title="Directions app">
          {MAPS_OPTIONS.map((m) => (
            <TouchableOpacity
              key={m.id}
              style={[styles.row, user.preferredMapsApp === m.id && styles.rowActive]}
              onPress={() => patch({ preferredMapsApp: m.id })}
            >
              <Text style={styles.rowLabel}>{m.label}</Text>
              {user.preferredMapsApp === m.id && <Text style={styles.checkmark}>✓</Text>}
            </TouchableOpacity>
          ))}
        </Section>

        <Section title="Access & control">
          <TouchableOpacity style={styles.row} onPress={() => navigation.navigate("Permissions")}>
            <Text style={styles.rowLabel}>Permissions</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.row} onPress={() => navigation.navigate("Capabilities")}>
            <Text style={styles.rowLabel}>Capabilities & memory</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.row} onPress={() => navigation.navigate("Connectors")}>
            <Text style={styles.rowLabel}>Connectors</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        </Section>

        <Section title="Proactive check-ins">
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Ask if I need help, even off the app</Text>
              <Text style={styles.disclaimer}>
                Off by default in spirit, on here for convenience — but read this: NexaAi cannot currently do real
                camera-based eye-tracking or emotion detection (that needs an on-device computer-vision model that
                isn't built yet — see README "What's stubbed"). Today this toggle only controls whether NexaAi may send
                you a push notification check-in; it does not watch you through the camera.
              </Text>
            </View>
            <Switch value={proactive} onValueChange={toggleProactive} trackColor={{ true: colors.accent }} />
          </View>
        </Section>

        <TouchableOpacity style={styles.logoutButton} onPress={logout}>
          <Text style={styles.logoutText}>Log out</Text>
        </TouchableOpacity>
      </ScrollView>
    </GalaxyBackground>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.lg },
  title: { ...typography.h1, color: colors.textPrimary },
  section: { gap: spacing.sm },
  sectionTitle: { ...typography.bodyBold, color: colors.textSecondary },
  sectionCard: { backgroundColor: colors.bgCard, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  rowActive: { backgroundColor: colors.bgCardAlt },
  rowLabel: { ...typography.body, color: colors.textPrimary },
  rowValue: { ...typography.caption, color: colors.textMuted },
  checkmark: { color: colors.accentBright, fontWeight: "700" },
  disclaimer: { ...typography.caption, color: colors.textMuted, marginTop: 4, maxWidth: 260 },
  logoutButton: { alignItems: "center", padding: spacing.md },
  logoutText: { color: colors.danger, fontWeight: "700" },
});
