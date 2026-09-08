import React, { useState } from "react";
import { ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { GalaxyBackground } from "../components/GalaxyBackground";
import { colors, radii, spacing, typography } from "../theme/colors";
import { useTheme } from "../lib/ThemeContext";
import { useAuth } from "../lib/AuthContext";
import { api, ApiError } from "../lib/api";
import { VOICE_CHARACTERS, speak } from "../lib/voice";
import type { MapsApp } from "../lib/maps";

const MAPS_OPTIONS: { id: MapsApp; label: string }[] = [
  { id: "apple", label: "Apple Maps" },
  { id: "google", label: "Google Maps" },
  { id: "trackline", label: "TrackLine" },
];

export function SettingsScreen() {
  const { user, logout, refreshUser } = useAuth();
  const { palette } = useTheme();
  const navigation = useNavigation<any>();
  const [proactive, setProactive] = useState(user?.proactiveCheckInEnabled ?? true);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleting, setDeleting] = useState(false);

  const patch = async (body: Record<string, unknown>) => {
    await api("/api/auth/settings", { method: "PATCH", body: JSON.stringify(body) });
    await refreshUser();
  };

  const toggleProactive = async (value: boolean) => {
    setProactive(value);
    await patch({ proactiveCheckInEnabled: value });
  };

  const confirmLogout = () => {
    Alert.alert("Log out?", "You'll need to sign back in with your email and password to use NexaAi again.", [
      { text: "Cancel", style: "cancel" },
      { text: "Log out", style: "destructive", onPress: logout },
    ]);
  };

  const submitDeleteAccount = async () => {
    if (!deletePassword) return;
    setDeleting(true);
    try {
      await api("/api/auth/delete-account", { method: "POST", body: JSON.stringify({ password: deletePassword }) });
      setDeleteModalOpen(false);
      await logout();
    } catch (err) {
      Alert.alert("Couldn't delete account", err instanceof ApiError ? err.message : "Check your password and try again.");
    } finally {
      setDeleting(false);
    }
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
              {user.voiceCharacterId === c.id && <Text style={[styles.checkmark, { color: palette.accentBright }]}>✓</Text>}
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
              {user.preferredMapsApp === m.id && <Text style={[styles.checkmark, { color: palette.accentBright }]}>✓</Text>}
            </TouchableOpacity>
          ))}
        </Section>

        <Section title="Access & control">
          <TouchableOpacity style={styles.row} onPress={() => navigation.navigate("Appearance")}>
            <Text style={styles.rowLabel}>Appearance</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </TouchableOpacity>
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
            <Switch value={proactive} onValueChange={toggleProactive} trackColor={{ true: palette.accent }} />
          </View>
        </Section>

        <Section title="Developer">
          <Text style={styles.disclaimer}>
            API keys and third-party integration management need a browser — open your account website (Settings on the login
            page) to generate a key or manage Connectors from there.
          </Text>
        </Section>

        <TouchableOpacity style={styles.logoutButton} onPress={confirmLogout}>
          <Text style={styles.logoutText}>Log out</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.deleteButton} onPress={() => setDeleteModalOpen(true)}>
          <Text style={styles.deleteText}>Delete account</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={deleteModalOpen} transparent animationType="fade" onRequestClose={() => setDeleteModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Delete your account?</Text>
            <Text style={styles.modalSubtitle}>
              This permanently deletes your account and everything tied to it — every chat, project, credit transaction,
              connected platform, memory entry, and API key. This cannot be undone. Enter your password to confirm.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={colors.textMuted}
              value={deletePassword}
              onChangeText={setDeletePassword}
              secureTextEntry
              autoCapitalize="none"
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalCancelButton} onPress={() => setDeleteModalOpen(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalDeleteButton} onPress={submitDeleteAccount} disabled={deleting}>
                {deleting ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalDeleteText}>Delete forever</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  sectionCard: { backgroundColor: colors.bgCard, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, overflow: "hidden", padding: spacing.md },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  rowActive: { backgroundColor: colors.bgCardAlt },
  rowLabel: { ...typography.body, color: colors.textPrimary },
  rowValue: { ...typography.caption, color: colors.textMuted },
  checkmark: { fontWeight: "700" },
  disclaimer: { ...typography.caption, color: colors.textMuted },
  logoutButton: { alignItems: "center", padding: spacing.md },
  logoutText: { color: colors.danger, fontWeight: "700" },
  deleteButton: { alignItems: "center", padding: spacing.md },
  deleteText: { color: colors.danger, fontWeight: "700", opacity: 0.7 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  modalCard: { width: "100%", maxWidth: 380, backgroundColor: colors.bgCard, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.sm },
  modalTitle: { ...typography.h2, color: colors.textPrimary },
  modalSubtitle: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.sm },
  input: { backgroundColor: colors.bgCardAlt, borderRadius: radii.md, padding: spacing.md, color: colors.textPrimary },
  modalButtons: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  modalCancelButton: { flex: 1, backgroundColor: colors.bgCardAlt, borderRadius: radii.md, padding: spacing.md, alignItems: "center" },
  modalCancelText: { color: colors.textSecondary, fontWeight: "700" },
  modalDeleteButton: { flex: 1, backgroundColor: colors.danger, borderRadius: radii.md, padding: spacing.md, alignItems: "center" },
  modalDeleteText: { color: "#fff", fontWeight: "700" },
});
