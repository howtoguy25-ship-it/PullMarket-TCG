import React, { useState } from "react";
import { ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { GalaxyBackground } from "../components/GalaxyBackground";
import { colors, radii, spacing, typography } from "../theme/colors";
import { useTheme } from "../lib/ThemeContext";
import { api } from "../lib/api";
import { useAuth, type NexaCapabilities } from "../lib/AuthContext";

const CAPABILITY_ROWS: { key: keyof NexaCapabilities; label: string; description: string }[] = [
  { key: "cameraAsk", label: "Camera ask", description: "Snap a photo and ask NexaAi about it." },
  { key: "webLookup", label: "Find nearest assistance", description: "Look up the closest matching business for a real-world problem." },
  { key: "whoIsLookup", label: "“Who is…” lookups", description: "Real live web search for public figures — bio, sources, and confirmed accounts. Refuses private individuals." },
  { key: "agentBuilder", label: "Agent builder", description: "Build and test custom auto-reply agents." },
  { key: "voiceChat", label: "Voice chat", description: "Talk to NexaAi out loud with real transcription and spoken replies." },
  { key: "autoSpeak", label: "Auto-speak replies", description: "Read NexaAi's answers out loud automatically." },
  { key: "liveTyping", label: "Live typing", description: "Stream answers token-by-token instead of all at once." },
];

export function CapabilitiesScreen() {
  const { user, refreshUser } = useAuth();
  const { palette } = useTheme();
  const navigation = useNavigation<any>();
  const [pending, setPending] = useState<string | null>(null);

  if (!user) return null;

  const toggleCapability = async (key: keyof NexaCapabilities) => {
    setPending(key);
    try {
      await api("/api/auth/capabilities", { method: "PATCH", body: JSON.stringify({ [key]: !user.capabilities[key] }) });
      await refreshUser();
    } finally {
      setPending(null);
    }
  };

  const toggleMemorySetting = async (key: "memoryEnabled" | "referenceChatsEnabled" | "includeSensitiveInMemory") => {
    setPending(key);
    try {
      await api("/api/auth/settings", { method: "PATCH", body: JSON.stringify({ [key]: !user[key] }) });
      await refreshUser();
    } finally {
      setPending(null);
    }
  };

  return (
    <GalaxyBackground>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Capabilities</Text>
        <Text style={styles.subtitle}>What NexaAi can actually do for you — each toggle here really turns that feature off, server-side, not just in the UI.</Text>

        <Text style={styles.sectionLabel}>Features</Text>
        <View style={styles.card}>
          {CAPABILITY_ROWS.map((row, i) => (
            <View key={row.key} style={[styles.row, i < CAPABILITY_ROWS.length - 1 && styles.rowBorder]}>
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>{row.label}</Text>
                <Text style={styles.rowDescription}>{row.description}</Text>
              </View>
              <Switch
                value={user.capabilities[row.key]}
                disabled={pending === row.key}
                onValueChange={() => toggleCapability(row.key)}
                trackColor={{ true: palette.accent }}
              />
            </View>
          ))}
        </View>

        <Text style={styles.sectionLabel}>Memory</Text>
        <View style={styles.card}>
          <View style={[styles.row, styles.rowBorder]}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>Generate memory from chats</Text>
              <Text style={styles.rowDescription}>Let NexaAi save durable facts (preferences, ongoing projects) from your conversations.</Text>
            </View>
            <Switch value={user.memoryEnabled} disabled={pending === "memoryEnabled"} onValueChange={() => toggleMemorySetting("memoryEnabled")} trackColor={{ true: palette.accent }} />
          </View>
          <View style={[styles.row, styles.rowBorder]}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>Reference past chats</Text>
              <Text style={styles.rowDescription}>Let saved memory be read back into future conversations.</Text>
            </View>
            <Switch
              value={user.referenceChatsEnabled}
              disabled={pending === "referenceChatsEnabled"}
              onValueChange={() => toggleMemorySetting("referenceChatsEnabled")}
              trackColor={{ true: palette.accent }}
            />
          </View>
          <View style={[styles.row, styles.rowBorder]}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>Include sensitive topics</Text>
              <Text style={styles.rowDescription}>Allow health, religion, or similarly sensitive facts to be remembered. Off by default.</Text>
            </View>
            <Switch
              value={user.includeSensitiveInMemory}
              disabled={pending === "includeSensitiveInMemory"}
              onValueChange={() => toggleMemorySetting("includeSensitiveInMemory")}
              trackColor={{ true: palette.accent }}
            />
          </View>
          <TouchableOpacity style={styles.row} onPress={() => navigation.navigate("MemoryFiles")}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>Memory files</Text>
              <Text style={styles.rowDescription}>View and delete what NexaAi remembers about you.</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </GalaxyBackground>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md },
  title: { ...typography.h1, color: colors.textPrimary },
  subtitle: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.sm },
  sectionLabel: { ...typography.caption, color: colors.textMuted, textTransform: "uppercase", marginTop: spacing.sm },
  card: { backgroundColor: colors.bgCard, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { ...typography.bodyBold, color: colors.textPrimary },
  rowDescription: { ...typography.caption, color: colors.textMuted },
});
