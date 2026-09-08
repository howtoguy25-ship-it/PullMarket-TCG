import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { GalaxyBackground } from "../components/GalaxyBackground";
import { FadeInUp } from "../components/FadeInUp";
import { colors, radii, spacing, typography } from "../theme/colors";
import { api, ApiError } from "../lib/api";

type AgentKind = "instagram_dm" | "whatsapp_autoresponder" | "generic_webhook" | "custom";

interface Agent {
  id: string;
  name: string;
  kind: AgentKind;
  isActive: boolean;
  config: { instructions: string; autoSend: boolean };
}

interface PendingDraft {
  id: string;
  agentId: string;
  platform: "instagram" | "whatsapp";
  externalConversationId: string;
  incomingMessage: string;
  draftReply: string;
  createdAt: string;
}

const KIND_LABELS: Record<AgentKind, string> = {
  instagram_dm: "Instagram DM replies",
  whatsapp_autoresponder: "WhatsApp autoresponder",
  generic_webhook: "Generic webhook",
  custom: "Custom",
};

export function AgentBuilderScreen() {
  const navigation = useNavigation<any>();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [pendingDrafts, setPendingDrafts] = useState<PendingDraft[]>([]);
  const [resolvingDraft, setResolvingDraft] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AgentKind>("instagram_dm");
  const [instructions, setInstructions] = useState("");
  const [creating, setCreating] = useState(false);
  const [testInput, setTestInput] = useState<Record<string, string>>({});
  const [testOutput, setTestOutput] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState<string | null>(null);

  const load = () => {
    api<{ agents: Agent[] }>("/api/agents").then((r) => setAgents(r.agents));
    api<{ drafts: PendingDraft[] }>("/api/agents/pending-drafts").then((r) => setPendingDrafts(r.drafts));
  };
  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    if (!name.trim() || !instructions.trim()) return;
    setCreating(true);
    try {
      await api("/api/agents", { method: "POST", body: JSON.stringify({ name, kind, instructions, autoSend: false }) });
      setName("");
      setInstructions("");
      await load();
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (agent: Agent) => {
    await api(`/api/agents/${agent.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !agent.isActive }) });
    await load();
  };

  const dryRun = async (agent: Agent) => {
    setTesting(agent.id);
    try {
      const { draftReply } = await api<{ draftReply: string }>(`/api/agents/${agent.id}/dry-run`, {
        method: "POST",
        body: JSON.stringify({ incomingMessage: testInput[agent.id] ?? "" }),
      });
      setTestOutput((prev) => ({ ...prev, [agent.id]: draftReply }));
    } finally {
      setTesting(null);
    }
  };

  const resolveDraft = async (draft: PendingDraft, action: "approve" | "reject") => {
    setResolvingDraft(draft.id);
    try {
      await api(`/api/agents/pending-drafts/${draft.id}/${action}`, { method: "POST" });
      setPendingDrafts((prev) => prev.filter((d) => d.id !== draft.id));
    } catch (err) {
      Alert.alert("Error", err instanceof ApiError ? err.message : `Couldn't ${action} that draft.`);
    } finally {
      setResolvingDraft(null);
    }
  };

  return (
    <GalaxyBackground>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Build an agent</Text>
        <Text style={styles.subtitle}>
          Describe an automation in your own words — e.g. "reply to Instagram DMs asking about pricing with our price list".
          You can safely test drafts here before connecting a real account in Settings → Connectors.
        </Text>

        {pendingDrafts.length > 0 && (
          <View>
            <Text style={styles.sectionLabel}>Waiting for your approval</Text>
            {pendingDrafts.map((draft, i) => (
              <FadeInUp key={draft.id} delayMs={i * 60}>
                <View style={styles.draftCard}>
                  <Text style={styles.draftPlatform}>{draft.platform === "instagram" ? "Instagram DM" : "WhatsApp message"}</Text>
                  <Text style={styles.draftIncoming}>"{draft.incomingMessage}"</Text>
                  <Text style={styles.draftReplyLabel}>NexaAi's drafted reply:</Text>
                  <Text style={styles.draftReply}>{draft.draftReply}</Text>
                  <View style={styles.draftButtons}>
                    <TouchableOpacity style={styles.rejectButton} onPress={() => resolveDraft(draft, "reject")} disabled={resolvingDraft === draft.id}>
                      <Text style={styles.rejectButtonText}>Reject</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.approveButton} onPress={() => resolveDraft(draft, "approve")} disabled={resolvingDraft === draft.id}>
                      {resolvingDraft === draft.id ? <ActivityIndicator color="#fff" /> : <Text style={styles.approveButtonText}>Send it</Text>}
                    </TouchableOpacity>
                  </View>
                </View>
              </FadeInUp>
            ))}
          </View>
        )}

        <View style={styles.form}>
          <TextInput style={styles.input} placeholder="Agent name" placeholderTextColor={colors.textMuted} value={name} onChangeText={setName} />
          <View style={styles.kindRow}>
            {(Object.keys(KIND_LABELS) as AgentKind[]).map((k) => (
              <TouchableOpacity key={k} onPress={() => setKind(k)} style={[styles.kindPill, kind === k && styles.kindPillActive]}>
                <Text style={[styles.kindPillText, kind === k && styles.kindPillTextActive]}>{KIND_LABELS[k]}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={[styles.input, styles.multiline]}
            placeholder="What should this agent do?"
            placeholderTextColor={colors.textMuted}
            value={instructions}
            onChangeText={setInstructions}
            multiline
          />
          <TouchableOpacity style={styles.primaryButton} onPress={create} disabled={creating}>
            {creating ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Create agent</Text>}
          </TouchableOpacity>
        </View>

        {agents.map((agent, i) => (
          <FadeInUp key={agent.id} delayMs={i * 60}>
            <View style={styles.agentCard}>
              <View style={styles.agentHeader}>
                <View>
                  <Text style={styles.agentName}>{agent.name}</Text>
                  <Text style={styles.agentKind}>{KIND_LABELS[agent.kind]}</Text>
                </View>
                <Switch value={agent.isActive} onValueChange={() => toggleActive(agent)} trackColor={{ true: colors.accent }} />
              </View>
              {agent.isActive && (agent.kind === "instagram_dm" || agent.kind === "whatsapp_autoresponder") && (
                <TouchableOpacity onPress={() => navigation.navigate("Connectors")}>
                  <Text style={styles.notConnectedNote}>
                    Make sure {agent.kind === "instagram_dm" ? "Instagram" : "WhatsApp"} is connected in Settings → Connectors, or real
                    messages won't get a reply. {agent.config.autoSend ? "Auto-send is ON — replies go out immediately." : "Auto-send is off — replies wait above for your approval."}
                  </Text>
                </TouchableOpacity>
              )}
              <TextInput
                style={styles.input}
                placeholder="Try an incoming message…"
                placeholderTextColor={colors.textMuted}
                value={testInput[agent.id] ?? ""}
                onChangeText={(t) => setTestInput((prev) => ({ ...prev, [agent.id]: t }))}
              />
              <TouchableOpacity style={styles.secondaryButton} onPress={() => dryRun(agent)} disabled={testing === agent.id}>
                {testing === agent.id ? <ActivityIndicator color={colors.accentBright} /> : <Text style={styles.secondaryButtonText}>Preview draft reply</Text>}
              </TouchableOpacity>
              {testOutput[agent.id] && <Text style={styles.draftReply}>{testOutput[agent.id]}</Text>}
            </View>
          </FadeInUp>
        ))}
      </ScrollView>
    </GalaxyBackground>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.lg },
  title: { ...typography.h1, color: colors.textPrimary },
  subtitle: { ...typography.body, color: colors.textSecondary },
  sectionLabel: { ...typography.caption, color: colors.textMuted, textTransform: "uppercase", marginBottom: spacing.sm },
  form: { backgroundColor: colors.bgCard, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm, borderWidth: 1, borderColor: colors.border },
  input: { backgroundColor: colors.bgCardAlt, borderRadius: radii.md, padding: spacing.md, color: colors.textPrimary },
  multiline: { minHeight: 70, textAlignVertical: "top" },
  kindRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  kindPill: { borderRadius: radii.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, backgroundColor: colors.bgCardAlt },
  kindPillActive: { backgroundColor: colors.accent },
  kindPillText: { ...typography.caption, color: colors.textSecondary },
  kindPillTextActive: { color: "#fff" },
  primaryButton: { backgroundColor: colors.accent, borderRadius: radii.md, padding: spacing.md, alignItems: "center" },
  primaryButtonText: { color: "#fff", fontWeight: "700" },
  secondaryButton: { backgroundColor: colors.bgCardAlt, borderRadius: radii.md, padding: spacing.sm, alignItems: "center" },
  secondaryButtonText: { color: colors.accentBright, fontWeight: "600" },
  agentCard: { backgroundColor: colors.bgCard, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm, borderWidth: 1, borderColor: colors.border },
  agentHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  agentName: { ...typography.bodyBold, color: colors.textPrimary },
  agentKind: { ...typography.caption, color: colors.textMuted },
  notConnectedNote: { ...typography.caption, color: colors.warning, fontStyle: "italic" },
  draftReply: { ...typography.body, color: colors.textPrimary, backgroundColor: colors.bgCardAlt, borderRadius: radii.md, padding: spacing.md },
  draftCard: { backgroundColor: colors.bgCard, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm, borderWidth: 1, borderColor: colors.warning, marginBottom: spacing.sm },
  draftPlatform: { ...typography.bodyBold, color: colors.textPrimary },
  draftIncoming: { ...typography.body, color: colors.textSecondary, fontStyle: "italic" },
  draftReplyLabel: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },
  draftButtons: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  rejectButton: { flex: 1, backgroundColor: colors.bgCardAlt, borderRadius: radii.md, padding: spacing.md, alignItems: "center" },
  rejectButtonText: { color: colors.danger, fontWeight: "700" },
  approveButton: { flex: 1, backgroundColor: colors.success, borderRadius: radii.md, padding: spacing.md, alignItems: "center" },
  approveButtonText: { color: "#08130E", fontWeight: "700" },
});
