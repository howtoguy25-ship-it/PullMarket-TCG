import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { GalaxyBackground } from "../components/GalaxyBackground";
import { radii, spacing, typography } from "../theme/colors";
import { useTheme } from "../lib/ThemeContext";
import type { Palette } from "../theme/palettes";
import { api } from "../lib/api";

interface SupportAgent {
  id: "billing" | "technical" | "account" | "general";
  label: string;
  description: string;
  icon: string;
}

interface SupportConversation {
  id: string;
  agentType: SupportAgent["id"];
  title: string;
  createdAt: string;
}

/**
 * Real multi-agent help & support — reachable from Settings, genuinely
 * distinct from the outward-facing "agents" the user builds in Agent
 * Builder (those message the user's own customers on Instagram/WhatsApp/
 * etc.; these are NexaAi's own support desk, each a specialized persona
 * with real knowledge of one part of the app — see
 * server/src/lib/supportPersonas.ts).
 */
export function HelpSupportScreen() {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const navigation = useNavigation<any>();
  const [agents, setAgents] = useState<SupportAgent[]>([]);
  const [conversations, setConversations] = useState<SupportConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [startingAgent, setStartingAgent] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([api<{ agents: SupportAgent[] }>("/api/support/agents"), api<{ conversations: SupportConversation[] }>("/api/support/conversations")])
      .then(([agentsRes, conversationsRes]) => {
        setAgents(agentsRes.agents);
        setConversations(conversationsRes.conversations);
      })
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(load);

  const startConversation = async (agentType: SupportAgent["id"]) => {
    setStartingAgent(agentType);
    try {
      const { conversation } = await api<{ conversation: SupportConversation }>("/api/support/conversations", {
        method: "POST",
        body: JSON.stringify({ agentType }),
      });
      navigation.navigate("SupportChat", { conversationId: conversation.id, title: conversation.title });
    } finally {
      setStartingAgent(null);
    }
  };

  return (
    <GalaxyBackground>
      <FlatList
        data={conversations}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <>
            <Text style={styles.sectionLabel}>Talk to a support agent</Text>
            <View style={styles.agentGrid}>
              {agents.map((agent) => (
                <TouchableOpacity
                  key={agent.id}
                  testID={`support-agent-${agent.id}`}
                  style={styles.agentCard}
                  onPress={() => startConversation(agent.id)}
                  disabled={startingAgent !== null}
                >
                  <View style={styles.agentIconCircle}>
                    {startingAgent === agent.id ? (
                      <ActivityIndicator size="small" color={palette.accentBright} />
                    ) : (
                      <Ionicons name={agent.icon as any} size={20} color={palette.accentBright} />
                    )}
                  </View>
                  <Text style={styles.agentLabel}>{agent.label}</Text>
                  <Text style={styles.agentDescription}>{agent.description}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {conversations.length > 0 && <Text style={styles.sectionLabel}>Past conversations</Text>}
          </>
        }
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Ionicons name="chatbubbles-outline" size={28} color={palette.textMuted} />
              <Text style={styles.emptyText}>No conversations yet — pick a support agent above to start one.</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const agent = agents.find((a) => a.id === item.agentType);
          return (
            <TouchableOpacity
              style={styles.conversationRow}
              onPress={() => navigation.navigate("SupportChat", { conversationId: item.id, title: item.title })}
            >
              <Ionicons name={(agent?.icon as any) ?? "chatbubble-outline"} size={18} color={palette.textSecondary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.conversationTitle}>{item.title}</Text>
                <Text style={styles.conversationDate}>{new Date(item.createdAt).toLocaleDateString()}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={palette.textMuted} />
            </TouchableOpacity>
          );
        }}
      />
    </GalaxyBackground>
  );
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    list: { padding: spacing.lg, gap: spacing.sm },
    sectionLabel: { ...typography.caption, color: palette.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: spacing.sm, marginTop: spacing.sm },
    agentGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
    agentCard: {
      width: "47%",
      backgroundColor: palette.bgCard,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      padding: spacing.md,
      gap: 4,
    },
    agentIconCircle: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: palette.bgCardAlt,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 4,
    },
    agentLabel: { ...typography.bodyBold, color: palette.textPrimary, fontSize: 14 },
    agentDescription: { ...typography.caption, color: palette.textMuted, fontSize: 11 },
    conversationRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: palette.bgCard,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.border,
      padding: spacing.md,
    },
    conversationTitle: { ...typography.body, color: palette.textPrimary },
    conversationDate: { ...typography.caption, color: palette.textMuted },
    empty: { alignItems: "center", gap: spacing.md, padding: spacing.xxl },
    emptyText: { ...typography.body, color: palette.textMuted, textAlign: "center" },
  });
}
