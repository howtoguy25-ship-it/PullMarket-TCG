import React, { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { GalaxyBackground } from "../components/GalaxyBackground";
import { colors, radii, spacing, typography } from "../theme/colors";
import { api } from "../lib/api";

type AgentKind = "instagram_dm" | "whatsapp_autoresponder" | "generic_webhook" | "custom";

interface Agent {
  id: string;
  name: string;
  kind: AgentKind;
  isActive: boolean;
  config: { instructions: string; autoSend: boolean };
}

const KIND_LABELS: Record<AgentKind, string> = {
  instagram_dm: "Instagram DM replies",
  whatsapp_autoresponder: "WhatsApp autoresponder",
  generic_webhook: "Generic webhook",
  custom: "Custom",
};

export function AgentBuilderScreen() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AgentKind>("instagram_dm");
  const [instructions, setInstructions] = useState("");
  const [creating, setCreating] = useState(false);
  const [testInput, setTestInput] = useState<Record<string, string>>({});
  const [testOutput, setTestOutput] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState<string | null>(null);

  const load = () => api<{ agents: Agent[] }>("/api/agents").then((r) => setAgents(r.agents));
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

  return (
    <GalaxyBackground>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Build an agent</Text>
        <Text style={styles.subtitle}>
          Describe an automation in your own words — e.g. "reply to Instagram DMs asking about pricing with our price list".
          You can safely test drafts here before connecting a real account.
        </Text>

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

        {agents.map((agent) => (
          <View key={agent.id} style={styles.agentCard}>
            <View style={styles.agentHeader}>
              <View>
                <Text style={styles.agentName}>{agent.name}</Text>
                <Text style={styles.agentKind}>{KIND_LABELS[agent.kind]}</Text>
              </View>
              <Switch value={agent.isActive} onValueChange={() => toggleActive(agent)} trackColor={{ true: colors.accent }} />
            </View>
            {agent.isActive && agent.kind !== "custom" && (
              <Text style={styles.notConnectedNote}>
                Not connected to a real {agent.kind === "instagram_dm" ? "Instagram" : "WhatsApp"} account yet — needs your own
                Meta Developer credentials (see server/src/lib/agents/agentRunner.ts).
              </Text>
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
        ))}
      </ScrollView>
    </GalaxyBackground>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.lg },
  title: { ...typography.h1, color: colors.textPrimary },
  subtitle: { ...typography.body, color: colors.textSecondary },
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
});
