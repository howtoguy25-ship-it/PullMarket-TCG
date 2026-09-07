import React, { useCallback, useState } from "react";
import { Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import * as WebBrowser from "expo-web-browser";
import { Ionicons } from "@expo/vector-icons";
import { GalaxyBackground } from "../components/GalaxyBackground";
import { colors, radii, spacing, typography } from "../theme/colors";
import { api, ApiError } from "../lib/api";

interface ConnectorVM {
  provider: string;
  label: string;
  description: string;
  status: "connected" | "disconnected" | "not_configured";
  externalAccountLabel: string | null;
  notConfiguredHint: string | null;
}

const PROVIDER_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  google: "logo-google",
  notion: "document-text",
  slack: "logo-slack",
  instagram: "logo-instagram",
  whatsapp: "logo-whatsapp",
};

export function ConnectorsScreen() {
  const [connectors, setConnectors] = useState<ConnectorVM[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ connectors: ConnectorVM[] }>("/api/connectors").then((r) => setConnectors(r.connectors));
  }, []);

  useFocusEffect(load);

  const connect = async (connector: ConnectorVM) => {
    setBusy(connector.provider);
    try {
      const { authUrl } = await api<{ authUrl: string }>(`/api/connectors/${connector.provider}/connect`, { method: "POST" });
      await WebBrowser.openBrowserAsync(authUrl);
      load(); // refresh once the user returns from the browser
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Couldn't start the connection.";
      Alert.alert(connector.label, message);
    } finally {
      setBusy(null);
    }
  };

  const disconnect = (connector: ConnectorVM) => {
    Alert.alert(`Disconnect ${connector.label}?`, undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Disconnect",
        style: "destructive",
        onPress: async () => {
          await api(`/api/connectors/${connector.provider}`, { method: "DELETE" });
          load();
        },
      },
    ]);
  };

  const onPressRow = (connector: ConnectorVM) => {
    if (connector.status === "connected") return disconnect(connector);
    if (connector.status === "not_configured") {
      return Alert.alert(`${connector.label} isn't set up yet`, connector.notConfiguredHint ?? "The app owner needs to add credentials for this connector.");
    }
    connect(connector);
  };

  return (
    <GalaxyBackground>
      <View style={styles.header}>
        <Text style={styles.title}>Connectors</Text>
      </View>
      <Text style={styles.subtitle}>Link other platforms to NexaAi so it can use real data from them, or so an agent can act through them.</Text>

      <FlatList
        data={connectors}
        keyExtractor={(c) => c.provider}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => onPressRow(item)} disabled={busy === item.provider}>
            <View style={styles.iconWrap}>
              <Ionicons name={PROVIDER_ICON[item.provider] ?? "link"} size={20} color={colors.accentBright} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>{item.label}</Text>
              <Text style={styles.rowDescription}>
                {item.status === "connected" ? `Connected as ${item.externalAccountLabel}` : item.status === "not_configured" ? "Not set up yet" : item.description}
              </Text>
            </View>
            <View style={[styles.badge, item.status === "connected" && styles.badgeConnected]}>
              <Text style={[styles.badgeText, item.status === "connected" && styles.badgeTextConnected]}>
                {item.status === "connected" ? "Connected" : item.status === "not_configured" ? "Not set up" : "Connect"}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      />
    </GalaxyBackground>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  title: { ...typography.h1, color: colors.textPrimary },
  subtitle: { ...typography.body, color: colors.textSecondary, paddingHorizontal: spacing.lg, marginTop: spacing.sm },
  list: { padding: spacing.lg, gap: spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.bgCard,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  iconWrap: { width: 40, height: 40, borderRadius: radii.md, backgroundColor: colors.bgCardAlt, alignItems: "center", justifyContent: "center" },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { ...typography.bodyBold, color: colors.textPrimary },
  rowDescription: { ...typography.caption, color: colors.textMuted },
  badge: { backgroundColor: colors.bgCardAlt, borderRadius: radii.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  badgeConnected: { backgroundColor: colors.success },
  badgeText: { ...typography.caption, color: colors.textSecondary, fontWeight: "700" },
  badgeTextConnected: { color: "#08130E" },
});
