import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import * as WebBrowser from "expo-web-browser";
import { Ionicons } from "@expo/vector-icons";
import { GalaxyBackground } from "../components/GalaxyBackground";
import { FadeInUp } from "../components/FadeInUp";
import { colors, radii, spacing, typography } from "../theme/colors";
import { api, ApiError } from "../lib/api";
import { openOnWeb } from "../lib/webLinks";
import { McpStatusAnimation, type McpConnectPhase } from "../components/McpStatusAnimation";

interface McpServerVM {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  status: "connected" | "error" | "unverified";
  lastError: string | null;
  toolCount: number;
}

const MCP_STATUS_LABEL: Record<McpServerVM["status"], string> = {
  connected: "Connected",
  error: "Connection error",
  unverified: "Not verified yet",
};

/**
 * Real, generic MCP connectors — the user pastes any real Model Context
 * Protocol server URL and NexaAi connects to it for real (server/src/lib/mcp/client.ts),
 * discovers its actual tools, and can call them live during chat. Same idea
 * as Claude's own "Add custom connector".
 */
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function McpConnectorsSection() {
  const [servers, setServers] = useState<McpServerVM[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [addPhase, setAddPhase] = useState<McpConnectPhase | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [phaseById, setPhaseById] = useState<Record<string, McpConnectPhase>>({});

  const load = useCallback(() => {
    api<{ servers: McpServerVM[] }>("/api/mcp").then((r) => {
      setServers(r.servers);
      setLoaded(true);
    });
  }, []);

  useFocusEffect(load);

  const submit = async () => {
    if (!name.trim() || !url.trim()) return;
    setSubmitting(true);
    setAddPhase("connecting");
    setAddError(null);
    try {
      const res = await api<{ server: McpServerVM }>("/api/mcp", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), url: url.trim(), bearerToken: token.trim() || undefined }),
      });
      if (res.server.status === "connected") {
        setAddPhase("success");
        load();
        await wait(900); // let the checkmark actually be seen before the modal closes
        setModalOpen(false);
        setName("");
        setUrl("");
        setToken("");
        setAddPhase(null);
      } else {
        setAddPhase("error");
        setAddError(res.server.lastError ?? "Couldn't verify that server — check the URL and try again.");
        load();
      }
    } catch (err) {
      setAddPhase("error");
      setAddError(err instanceof ApiError ? err.message : "Check the server URL and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const reconnect = async (server: McpServerVM) => {
    setPhaseById((p) => ({ ...p, [server.id]: "connecting" }));
    try {
      const res = await api<{ server: McpServerVM }>(`/api/mcp/${server.id}/reconnect`, { method: "POST" });
      setPhaseById((p) => ({ ...p, [server.id]: res.server.status === "connected" ? "success" : "error" }));
    } catch {
      setPhaseById((p) => ({ ...p, [server.id]: "error" }));
    } finally {
      load();
      await wait(1200); // let the result icon actually be seen before reverting to the normal badge
      setPhaseById((p) => {
        const next = { ...p };
        delete next[server.id];
        return next;
      });
    }
  };

  const remove = (server: McpServerVM) => {
    Alert.alert(`Remove ${server.name}?`, "NexaAi will stop being able to call its tools.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          await api(`/api/mcp/${server.id}`, { method: "DELETE" });
          load();
        },
      },
    ]);
  };

  if (!loaded) return null;

  return (
    <View style={styles.mcpSection}>
      <View style={styles.mcpHeaderRow}>
        <Text style={styles.mcpTitle}>MCP connectors</Text>
        <TouchableOpacity testID="mcp-add-button" style={styles.mcpAddButton} onPress={() => setModalOpen(true)}>
          <Ionicons name="add" size={16} color="#fff" />
          <Text style={styles.mcpAddButtonText}>Add custom</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.mcpSubtitle}>
        Paste any real MCP server's URL — NexaAi connects to it and can use its real tools during chat, the same way Claude's
        custom connectors work.
      </Text>

      {servers.map((server, index) => (
        <FadeInUp key={server.id} delayMs={index * 45}>
          <View style={styles.mcpRow}>
            <Ionicons name="hardware-chip-outline" size={20} color={colors.accentBright} />
            <View style={styles.mcpRowText}>
              <Text style={styles.rowLabel}>{server.name}</Text>
              <Text style={styles.rowDescription} numberOfLines={1}>
                {server.status === "error" && server.lastError ? server.lastError : server.url}
              </Text>
            </View>
            <View style={[styles.badge, server.status === "connected" && styles.badgeConnected, server.status === "error" && styles.badgeError]}>
              <Text style={[styles.badgeText, server.status === "connected" && styles.badgeTextConnected]}>
                {server.status === "connected" ? `${server.toolCount} tool${server.toolCount === 1 ? "" : "s"}` : MCP_STATUS_LABEL[server.status]}
              </Text>
            </View>
            {phaseById[server.id] ? (
              <McpStatusAnimation phase={phaseById[server.id]} size={18} />
            ) : (
              <TouchableOpacity onPress={() => reconnect(server)} style={styles.mcpIconButton}>
                <Ionicons name="refresh" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => remove(server)} style={styles.mcpIconButton}>
              <Ionicons name="trash-outline" size={16} color={colors.danger} />
            </TouchableOpacity>
          </View>
        </FadeInUp>
      ))}

      <TouchableOpacity onPress={() => openOnWeb("mcp.html")}>
        <Text style={styles.mcpWebLink}>View full tool schemas & advanced options on web →</Text>
      </TouchableOpacity>

      <Modal visible={modalOpen} transparent animationType="fade" onRequestClose={() => setModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add a custom MCP connector</Text>
            <Text style={styles.modalSubtitle}>Any real Model Context Protocol server — your own tools, or a public one.</Text>
            <TextInput testID="mcp-name-input" style={styles.input} placeholder="Name" placeholderTextColor={colors.textMuted} value={name} onChangeText={setName} />
            <TextInput
              testID="mcp-url-input"
              style={styles.input}
              placeholder="https://example.com/mcp"
              placeholderTextColor={colors.textMuted}
              value={url}
              onChangeText={setUrl}
              autoCapitalize="none"
              keyboardType="url"
            />
            <TextInput
              testID="mcp-token-input"
              style={styles.input}
              placeholder="Bearer token (optional)"
              placeholderTextColor={colors.textMuted}
              value={token}
              onChangeText={setToken}
              autoCapitalize="none"
              secureTextEntry
            />
            {addError && <Text style={styles.mcpModalError}>{addError}</Text>}
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => {
                  setModalOpen(false);
                  setAddPhase(null);
                  setAddError(null);
                }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="mcp-submit-button" style={styles.modalConnectButton} onPress={submit} disabled={submitting}>
                {addPhase ? <McpStatusAnimation phase={addPhase} size={20} /> : <Text style={styles.modalConnectText}>Connect</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

interface ConnectorVM {
  provider: string;
  label: string;
  description: string;
  connectMethod: "oauth" | "manual_entry";
  status: "connected" | "disconnected" | "not_configured";
  externalAccountLabel: string | null;
  notConfiguredHint: string | null;
}

// Real Ionicons brand glyph where one exists; everything else gets a
// brand-colored monogram badge below (BrandBadge) instead — this app has no
// way to source exact trademarked vector artwork for GitHub/Vercel/etc, so
// rather than fake a pixel copy, it shows the real name in the real brand
// color, which is honestly what it is.
const PROVIDER_ICON: Partial<Record<string, keyof typeof Ionicons.glyphMap>> = {
  google: "logo-google",
  notion: "document-text",
  slack: "logo-slack",
  instagram: "logo-instagram",
  whatsapp: "logo-whatsapp",
  github: "logo-github",
};

const BRAND_BADGE: Record<string, { letter: string; color: string }> = {
  sitespark: { letter: "S", color: "#7C5CFF" },
  vercel: { letter: "▲", color: "#000000" },
  netlify: { letter: "N", color: "#00C7B7" },
  stripe: { letter: "S", color: "#635BFF" },
  namecheap: { letter: "N", color: "#DE3723" },
};

function ConnectorIcon({ provider }: { provider: string }) {
  const ioniconName = PROVIDER_ICON[provider];
  if (ioniconName) return <Ionicons name={ioniconName} size={20} color={colors.accentBright} />;
  const brand = BRAND_BADGE[provider];
  if (brand) {
    return (
      <View style={[styles.brandBadge, { backgroundColor: brand.color }]}>
        <Text style={styles.brandBadgeText}>{brand.letter}</Text>
      </View>
    );
  }
  return <Ionicons name="link" size={20} color={colors.accentBright} />;
}

// Manual-entry connectors each need their own small set of fields — see
// server/src/lib/connectors/{meta,namecheap}.ts for what each verifies.
const MANUAL_ENTRY_FIELDS: Record<string, { key: string; placeholder: string; secure?: boolean }[]> = {
  whatsapp: [
    { key: "businessName", placeholder: "Business name" },
    { key: "phoneNumberId", placeholder: "Phone number ID" },
    { key: "accessToken", placeholder: "Permanent access token", secure: true },
  ],
  namecheap: [
    { key: "apiUser", placeholder: "Namecheap username" },
    { key: "apiKey", placeholder: "API key", secure: true },
    { key: "clientIp", placeholder: "Whitelisted IP address" },
  ],
};

const MANUAL_ENTRY_SUBTITLE: Record<string, string> = {
  whatsapp: "WhatsApp Cloud API doesn't use a login popup — copy these from Meta Business Suite / your WhatsApp Business Platform dashboard.",
  namecheap: "Namecheap's API doesn't use a login popup either — copy these from ap.www.namecheap.com/settings/tools/apiaccess (the IP must be whitelisted there).",
};

export function ConnectorsScreen() {
  const [connectors, setConnectors] = useState<ConnectorVM[]>([]);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [manualProvider, setManualProvider] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => {
    api<{ connectors: ConnectorVM[] }>("/api/connectors").then((r) => setConnectors(r.connectors));
  }, []);

  useFocusEffect(load);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return connectors;
    return connectors.filter((c) => c.label.toLowerCase().includes(q) || c.provider.toLowerCase().includes(q));
  }, [connectors, search]);

  const connect = async (connector: ConnectorVM) => {
    setBusy(connector.provider);
    try {
      const result = await api<{ authUrl?: string; manualEntry?: boolean }>(`/api/connectors/${connector.provider}/connect`, { method: "POST" });
      if (result.manualEntry) {
        setFields({});
        setManualProvider(connector.provider);
        return;
      }
      if (result.authUrl) {
        await WebBrowser.openBrowserAsync(result.authUrl);
        load(); // refresh once the user returns from the browser
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Couldn't start the connection.";
      Alert.alert(connector.label, message);
    } finally {
      setBusy(null);
    }
  };

  const submitManualEntry = async () => {
    if (!manualProvider) return;
    const requiredKeys = MANUAL_ENTRY_FIELDS[manualProvider].map((f) => f.key);
    if (requiredKeys.some((k) => !fields[k]?.trim())) return;
    setSubmitting(true);
    try {
      await api(`/api/connectors/${manualProvider}/manual`, { method: "POST", body: JSON.stringify(fields) });
      setManualProvider(null);
      setFields({});
      load();
    } catch (err) {
      Alert.alert("Couldn't connect", err instanceof ApiError ? err.message : "Check your details and try again.");
    } finally {
      setSubmitting(false);
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

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={16} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search connectors by name…"
          placeholderTextColor={colors.textMuted}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch("")}>
            <Ionicons name="close-circle" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(c) => c.provider}
        contentContainerStyle={styles.list}
        ListHeaderComponent={<McpConnectorsSection />}
        ListEmptyComponent={<Text style={styles.emptyText}>No connectors match "{search}".</Text>}
        renderItem={({ item, index }) => (
          <FadeInUp delayMs={index * 45}>
            <TouchableOpacity style={styles.row} onPress={() => onPressRow(item)} disabled={busy === item.provider}>
              <View style={styles.iconWrap}>{busy === item.provider ? <ActivityIndicator size="small" color={colors.accentBright} /> : <ConnectorIcon provider={item.provider} />}</View>
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
          </FadeInUp>
        )}
      />

      <Modal visible={!!manualProvider} transparent animationType="fade" onRequestClose={() => setManualProvider(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Connect {manualProvider && connectors.find((c) => c.provider === manualProvider)?.label}</Text>
            <Text style={styles.modalSubtitle}>{manualProvider ? MANUAL_ENTRY_SUBTITLE[manualProvider] : ""}</Text>
            {manualProvider &&
              MANUAL_ENTRY_FIELDS[manualProvider].map((f) => (
                <TextInput
                  key={f.key}
                  style={styles.input}
                  placeholder={f.placeholder}
                  placeholderTextColor={colors.textMuted}
                  value={fields[f.key] ?? ""}
                  onChangeText={(t) => setFields((prev) => ({ ...prev, [f.key]: t }))}
                  autoCapitalize="none"
                  secureTextEntry={f.secure}
                />
              ))}
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalCancelButton} onPress={() => setManualProvider(null)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConnectButton} onPress={submitManualEntry} disabled={submitting}>
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalConnectText}>Connect</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </GalaxyBackground>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  title: { ...typography.h1, color: colors.textPrimary },
  subtitle: { ...typography.body, color: colors.textSecondary, paddingHorizontal: spacing.lg, marginTop: spacing.sm },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    backgroundColor: colors.bgCardAlt,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  searchInput: { flex: 1, color: colors.textPrimary, ...typography.body },
  emptyText: { ...typography.body, color: colors.textMuted, textAlign: "center", marginTop: spacing.lg },
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
  brandBadge: { width: 26, height: 26, borderRadius: radii.sm, alignItems: "center", justifyContent: "center" },
  brandBadgeText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { ...typography.bodyBold, color: colors.textPrimary },
  rowDescription: { ...typography.caption, color: colors.textMuted },
  badge: { backgroundColor: colors.bgCardAlt, borderRadius: radii.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  badgeConnected: { backgroundColor: colors.success },
  badgeText: { ...typography.caption, color: colors.textSecondary, fontWeight: "700" },
  badgeTextConnected: { color: "#08130E" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  modalCard: { width: "100%", maxWidth: 380, backgroundColor: colors.bgCard, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.sm },
  modalTitle: { ...typography.h2, color: colors.textPrimary },
  modalSubtitle: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.sm },
  input: { backgroundColor: colors.bgCardAlt, borderRadius: radii.md, padding: spacing.md, color: colors.textPrimary },
  modalButtons: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  modalCancelButton: { flex: 1, backgroundColor: colors.bgCardAlt, borderRadius: radii.md, padding: spacing.md, alignItems: "center" },
  modalCancelText: { color: colors.textSecondary, fontWeight: "700" },
  modalConnectButton: { flex: 1, backgroundColor: colors.accent, borderRadius: radii.md, padding: spacing.md, alignItems: "center" },
  modalConnectText: { color: "#fff", fontWeight: "700" },
  mcpSection: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm },
  mcpHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  mcpTitle: { ...typography.h2, color: colors.textPrimary },
  mcpSubtitle: { ...typography.caption, color: colors.textMuted },
  mcpAddButton: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.accent, borderRadius: radii.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  mcpAddButtonText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  mcpRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.bgCard,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  mcpRowText: { flex: 1, gap: 2 },
  mcpIconButton: { padding: 6 },
  mcpWebLink: { ...typography.caption, color: colors.accentBright, textAlign: "center", marginTop: spacing.xs },
  mcpModalError: { ...typography.caption, color: colors.danger, marginTop: spacing.xs },
  badgeError: { backgroundColor: colors.danger },
});
