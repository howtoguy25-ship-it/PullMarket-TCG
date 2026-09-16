import React, { useMemo, useState } from "react";
import { ActivityIndicator, Linking, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { GalaxyBackground } from "../components/GalaxyBackground";
import { ToggleSwitch } from "../components/ToggleSwitch";
import { radii, spacing, typography } from "../theme/colors";
import { useTheme } from "../lib/ThemeContext";
import type { Palette } from "../theme/palettes";
import { useAuth } from "../lib/AuthContext";
import { api, ApiError } from "../lib/api";
import { Alert } from "../lib/alert";
import { VOICE_CHARACTERS, speak } from "../lib/voice";
import type { MapsApp } from "../lib/maps";
import { openOnWeb, webUrl } from "../lib/webLinks";

const MAPS_OPTIONS: { id: MapsApp; label: string }[] = [
  { id: "apple", label: "Apple Maps" },
  { id: "google", label: "Google Maps" },
  { id: "trackline", label: "TrackLine" },
];

export function SettingsScreen() {
  const { user, logout, refreshUser } = useAuth();
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
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
              onPress={() => patch({ voiceCharacterId: c.id })}
            >
              <Text style={styles.rowLabel}>
                {c.displayName} · {c.gender}, {c.tone}
              </Text>
              <View style={styles.rowActions}>
                <TouchableOpacity
                  style={[styles.playButton, { borderColor: palette.link }]}
                  onPress={(e) => {
                    e.stopPropagation();
                    speak(`Hi, I'm ${c.displayName}.`, c.id);
                  }}
                >
                  <Ionicons name="play" size={12} color={palette.link} />
                </TouchableOpacity>
                {user.voiceCharacterId === c.id && <Text style={[styles.checkmark, { color: palette.accentBright }]}>✓</Text>}
              </View>
            </TouchableOpacity>
          ))}
        </Section>

        <Section
          title="Directions app"
          subtitle="When NexaAi finds a real place for you — a nearby business, an address it looked up — its reply includes a Get directions link for that place. Tapping it opens the app below with directions already loaded, no separate searching."
        >
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
            <Ionicons name="chevron-forward" size={16} color={palette.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.row} onPress={() => navigation.navigate("Permissions")}>
            <Text style={styles.rowLabel}>Permissions</Text>
            <Ionicons name="chevron-forward" size={16} color={palette.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.row} onPress={() => navigation.navigate("Capabilities")}>
            <Text style={styles.rowLabel}>Capabilities & memory</Text>
            <Ionicons name="chevron-forward" size={16} color={palette.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity testID="settings-connectors-row" style={styles.row} onPress={() => navigation.navigate("Connectors")}>
            <Text style={styles.rowLabel}>Connectors</Text>
            <Ionicons name="chevron-forward" size={16} color={palette.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity testID="settings-help-support-row" style={styles.row} onPress={() => navigation.navigate("HelpSupport")}>
            <Text style={styles.rowLabel}>Help & Support</Text>
            <Ionicons name="chevron-forward" size={16} color={palette.textMuted} />
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
            <ToggleSwitch value={proactive} onValueChange={toggleProactive} />
          </View>
        </Section>

        <Section title="Continue on web">
          <Text style={styles.disclaimer}>
            A few things are genuinely richer in a browser — same idea as Claude's own web vs. mobile split. Tapping any of
            these opens NexaAi's account website, already signed in as you.
          </Text>
          <TouchableOpacity testID="settings-web-apikeys" style={styles.row} onPress={() => openOnWeb("apikeys.html")}>
            <Text style={styles.rowLabel}>Developer & API keys</Text>
            <Ionicons name="open-outline" size={16} color={palette.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity testID="settings-web-mcp" style={styles.row} onPress={() => openOnWeb("mcp.html")}>
            <Text style={styles.rowLabel}>Full MCP tool schemas</Text>
            <Ionicons name="open-outline" size={16} color={palette.textMuted} />
          </TouchableOpacity>
          {user.isOwner && (
            <TouchableOpacity testID="settings-web-owner" style={styles.row} onPress={() => openOnWeb("owner.html")}>
              <Text style={styles.rowLabel}>Owner panel</Text>
              <Ionicons name="open-outline" size={16} color={palette.textMuted} />
            </TouchableOpacity>
          )}
        </Section>

        <Section title="Legal">
          <TouchableOpacity testID="settings-privacy-row" style={styles.row} onPress={() => Linking.openURL(webUrl("privacy.html"))}>
            <Text style={styles.rowLabel}>Privacy Policy</Text>
            <Ionicons name="open-outline" size={16} color={palette.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity testID="settings-terms-row" style={styles.row} onPress={() => Linking.openURL(webUrl("terms.html"))}>
            <Text style={styles.rowLabel}>Terms of Service</Text>
            <Ionicons name="open-outline" size={16} color={palette.textMuted} />
          </TouchableOpacity>
        </Section>

        <Section title="Session">
          <View style={styles.actionRow}>
            <View style={styles.actionTextCol}>
              <Text style={styles.actionTitle}>Log out</Text>
              <Text style={styles.actionDescription}>
                Signs you out of NexaAi on this device only. Nothing is deleted — every chat, project, credit
                balance, connected platform, and memory entry is exactly as you left it. Sign back in anytime with
                your email and password.
              </Text>
            </View>
            <TouchableOpacity testID="settings-logout-button" style={styles.logoutButton} onPress={confirmLogout}>
              <Ionicons name="log-out-outline" size={16} color={palette.textSecondary} />
              <Text style={styles.logoutButtonText}>Log out</Text>
            </TouchableOpacity>
          </View>
        </Section>

        <View style={styles.dangerZone}>
          <View style={styles.dangerHeaderRow}>
            <Ionicons name="warning-outline" size={16} color={palette.danger} />
            <Text style={styles.dangerZoneTitle}>Danger zone</Text>
          </View>
          <View style={styles.actionRow}>
            <View style={styles.actionTextCol}>
              <Text style={styles.actionTitle}>Delete account</Text>
              <Text style={styles.actionDescription}>
                Permanently and irreversibly deletes your account and everything tied to it — every chat, project,
                credit transaction, connected platform, agent, and memory entry. There is no recovery window and no
                way to undo this once confirmed; it requires re-entering your password.
              </Text>
            </View>
            <TouchableOpacity testID="settings-delete-account-button" style={styles.deleteButton} onPress={() => setDeleteModalOpen(true)}>
              <Ionicons name="trash-outline" size={16} color={palette.danger} />
              <Text style={styles.deleteButtonText}>Delete account</Text>
            </TouchableOpacity>
          </View>
        </View>
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
              testID="delete-account-password-input"
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={palette.textMuted}
              value={deletePassword}
              onChangeText={setDeletePassword}
              secureTextEntry
              autoCapitalize="none"
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalCancelButton} onPress={() => setDeleteModalOpen(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="delete-account-confirm-button" style={styles.modalDeleteButton} onPress={submitDeleteAccount} disabled={deleting}>
                {deleting ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalDeleteText}>Delete forever</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </GalaxyBackground>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  // Real dividers drawn BETWEEN rows (not owned by each row itself) so the
  // last row in a card never carries a stray line flush against the card's
  // own rounded bottom corner — a visible misalignment the old
  // borderBottomWidth-on-every-row approach always produced.
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle && <Text style={styles.sectionSubtitle}>{subtitle}</Text>}
      <View style={styles.sectionCard}>
        {items.map((child, i) => (
          <React.Fragment key={i}>
            {child}
            {i < items.length - 1 && <View style={styles.divider} />}
          </React.Fragment>
        ))}
      </View>
    </View>
  );
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.lg },
  title: { ...typography.h1, color: palette.textPrimary },
  section: { gap: spacing.sm },
  sectionTitle: { ...typography.bodyBold, color: palette.textSecondary },
  sectionSubtitle: { ...typography.caption, color: palette.textMuted },
  sectionCard: { backgroundColor: palette.bgCard, borderRadius: radii.lg, borderWidth: 1, borderColor: palette.border, overflow: "hidden", padding: spacing.md },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.md },
  rowActive: { backgroundColor: palette.bgCardAlt },
  divider: { height: 1, backgroundColor: palette.border },
  rowLabel: { ...typography.body, color: palette.textPrimary },
  rowValue: { ...typography.caption, color: palette.textMuted },
  checkmark: { fontWeight: "700" },
  rowActions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  playButton: { width: 26, height: 26, borderRadius: 13, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  disclaimer: { ...typography.caption, color: palette.textMuted },

  actionRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, padding: spacing.md },
  actionTextCol: { flex: 1, gap: 4 },
  actionTitle: { ...typography.bodyBold, color: palette.textPrimary },
  actionDescription: { ...typography.caption, color: palette.textMuted, lineHeight: 17 },

  logoutButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  logoutButtonText: { ...typography.bodyBold, color: palette.textSecondary },

  dangerZone: {
    borderWidth: 1,
    borderColor: palette.danger,
    borderRadius: radii.lg,
    backgroundColor: palette.bgCard,
    overflow: "hidden",
  },
  dangerHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  dangerZoneTitle: { ...typography.sectionLabel, color: palette.danger, textTransform: "uppercase" },
  deleteButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: palette.danger,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  deleteButtonText: { ...typography.bodyBold, color: palette.danger },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  modalCard: { width: "100%", maxWidth: 380, backgroundColor: palette.bgCard, borderRadius: radii.lg, borderWidth: 1, borderColor: palette.border, padding: spacing.lg, gap: spacing.sm },
  modalTitle: { ...typography.h2, color: palette.textPrimary },
  modalSubtitle: { ...typography.caption, color: palette.textMuted, marginBottom: spacing.sm },
  input: { backgroundColor: palette.bgCardAlt, borderRadius: radii.md, padding: spacing.md, color: palette.textPrimary },
  modalButtons: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  modalCancelButton: { flex: 1, backgroundColor: palette.bgCardAlt, borderRadius: radii.md, padding: spacing.md, alignItems: "center" },
  modalCancelText: { color: palette.textSecondary, fontWeight: "700" },
  modalDeleteButton: { flex: 1, backgroundColor: palette.danger, borderRadius: radii.md, padding: spacing.md, alignItems: "center" },
  modalDeleteText: { color: "#fff", fontWeight: "700" },
  });
}
