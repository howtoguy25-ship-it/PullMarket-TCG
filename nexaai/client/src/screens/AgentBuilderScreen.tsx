import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Alert } from "../lib/alert";
import { useNavigation } from "@react-navigation/native";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle, Line } from "react-native-svg";
import { GalaxyBackground } from "../components/GalaxyBackground";
import { ToggleSwitch } from "../components/ToggleSwitch";
import { FadeInUp } from "../components/FadeInUp";
import { radii, spacing, typography } from "../theme/colors";
import { useTheme } from "../lib/ThemeContext";
import type { Palette } from "../theme/palettes";
import { api, ApiError, API_URL } from "../lib/api";

type AgentKind = "instagram_dm" | "whatsapp_autoresponder" | "facebook_messenger_dm" | "slack_dm" | "x_dm" | "generic_webhook" | "custom";
type SampleCategory = "welcome" | "faq";
interface SampleReply {
  text: string;
  category: SampleCategory;
}

interface Agent {
  id: string;
  name: string;
  kind: AgentKind;
  isActive: boolean;
  isPaused: boolean;
  config: { instructions: string; tone?: string; autoSend: boolean; sampleReplies?: SampleReply[]; webhookToken?: string };
}

interface PendingDraft {
  id: string;
  agentId: string;
  platform: "instagram" | "whatsapp" | "facebook_messenger" | "slack" | "x";
  externalConversationId: string;
  incomingMessage: string;
  draftReply: string;
  createdAt: string;
  humanTakeoverActive: boolean;
}

const KIND_ORDER: AgentKind[] = [
  "instagram_dm",
  "whatsapp_autoresponder",
  "facebook_messenger_dm",
  "slack_dm",
  "x_dm",
  "generic_webhook",
  "custom",
];

const KIND_META: Record<AgentKind, { label: string; color: string; icon: keyof typeof Ionicons.glyphMap }> = {
  instagram_dm: { label: "Instagram", color: "#C13584", icon: "logo-instagram" },
  whatsapp_autoresponder: { label: "WhatsApp", color: "#25D366", icon: "logo-whatsapp" },
  facebook_messenger_dm: { label: "Messenger", color: "#1877F2", icon: "logo-facebook" },
  slack_dm: { label: "Slack", color: "#611F69", icon: "logo-slack" },
  x_dm: { label: "X", color: "#000000", icon: "logo-x" },
  generic_webhook: { label: "Webhook", color: "#7C5CFF", icon: "link-outline" },
  custom: { label: "Custom", color: "#6B7280", icon: "construct-outline" },
};

const KIND_LABELS: Record<AgentKind, string> = {
  instagram_dm: "Instagram DM replies",
  whatsapp_autoresponder: "WhatsApp autoresponder",
  facebook_messenger_dm: "Facebook Messenger replies",
  slack_dm: "Slack DM replies",
  x_dm: "X (Twitter) DM replies",
  generic_webhook: "Generic webhook",
  custom: "Custom",
};

const PLATFORM_LABELS: Record<PendingDraft["platform"], string> = {
  instagram: "Instagram DM",
  whatsapp: "WhatsApp message",
  facebook_messenger: "Facebook Messenger message",
  slack: "Slack message",
  x: "X DM",
};

// Which real platform a live-send-capable agent kind needs connected —
// used both for the "make sure X is connected" nudge and its label.
const LIVE_PLATFORM_LABEL: Partial<Record<AgentKind, string>> = {
  instagram_dm: "Instagram",
  whatsapp_autoresponder: "WhatsApp",
  facebook_messenger_dm: "Facebook",
  slack_dm: "Slack",
  x_dm: "X (Twitter)",
};

type Rect = { x: number; y: number; width: number; height: number };
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedLine = Animated.createAnimatedComponent(Line);

/**
 * The "choose a platform" step, drawn as a real wiring diagram: every
 * platform tile has a faint dotted line to the Agent Core node; picking one
 * lights that line up in the platform's own brand color and sends an
 * animated pulse traveling along it on a loop — a real Animated-driven
 * connection, not a static illustration, using each element's actual
 * measured position (onLayout), so it holds up at any screen width.
 */
function PlatformWireDiagram({ selectedKind, onSelect, palette }: { selectedKind: AgentKind | null; onSelect: (k: AgentKind) => void; palette: Palette }) {
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [rowOffset, setRowOffset] = useState<{ x: number; y: number } | null>(null);
  const [tileRects, setTileRects] = useState<Partial<Record<AgentKind, Rect>>>({});
  const [coreRect, setCoreRect] = useState<Rect | null>(null);
  const draw = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!selectedKind) return;
    draw.setValue(0);
    Animated.timing(draw, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    pulse.setValue(0);
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1200, easing: Easing.linear, useNativeDriver: false }));
    loop.start();
    return () => loop.stop();
  }, [selectedKind, draw, pulse]);

  const tileCenter = (k: AgentKind) => {
    const t = tileRects[k];
    if (!t || !rowOffset) return null;
    return { x: rowOffset.x + t.x + t.width / 2, y: rowOffset.y + t.y + t.height / 2 };
  };
  const coreCenter = coreRect ? { x: coreRect.x + coreRect.width / 2, y: coreRect.y + coreRect.height / 2 } : null;
  const activeFrom = selectedKind ? tileCenter(selectedKind) : null;

  return (
    <View style={styles.wireDiagram}>
      <View style={styles.wireTilesRow} onLayout={(e) => setRowOffset({ x: e.nativeEvent.layout.x, y: e.nativeEvent.layout.y })}>
        {KIND_ORDER.map((k) => {
          const meta = KIND_META[k];
          const active = selectedKind === k;
          return (
            <TouchableOpacity
              key={k}
              activeOpacity={0.75}
              style={styles.wireTile}
              onLayout={(e) => setTileRects((prev) => ({ ...prev, [k]: e.nativeEvent.layout }))}
              onPress={() => onSelect(k)}
            >
              <View style={[styles.wireTileIcon, { backgroundColor: meta.color }, active && styles.wireTileIconActive]}>
                <Ionicons name={meta.icon} size={19} color="#fff" />
              </View>
              <Text style={[styles.wireTileLabel, active && { color: meta.color, fontWeight: "800" }]} numberOfLines={1}>
                {meta.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
        {coreCenter &&
          KIND_ORDER.map((k) => {
            if (k === selectedKind) return null;
            const from = tileCenter(k);
            if (!from) return null;
            return (
              <Line
                key={k}
                x1={from.x}
                y1={from.y}
                x2={coreCenter.x}
                y2={coreCenter.y}
                stroke={palette.border}
                strokeWidth={1.5}
                strokeDasharray="4 5"
                opacity={0.6}
              />
            );
          })}
        {activeFrom && coreCenter && selectedKind && (
          <>
            <AnimatedLine
              x1={activeFrom.x}
              y1={activeFrom.y}
              x2={coreCenter.x}
              y2={coreCenter.y}
              stroke={KIND_META[selectedKind].color}
              strokeWidth={2.5}
              opacity={draw}
            />
            <AnimatedCircle
              r={4.5}
              fill={KIND_META[selectedKind].color}
              cx={pulse.interpolate({ inputRange: [0, 1], outputRange: [activeFrom.x, coreCenter.x] })}
              cy={pulse.interpolate({ inputRange: [0, 1], outputRange: [activeFrom.y, coreCenter.y] })}
              opacity={pulse.interpolate({ inputRange: [0, 0.08, 0.92, 1], outputRange: [0, 1, 1, 0] })}
            />
          </>
        )}
      </Svg>

      <View style={styles.coreNodeWrap} onLayout={(e) => setCoreRect(e.nativeEvent.layout)}>
        <LinearGradient colors={[palette.accent, palette.accentBright]} style={styles.coreNode}>
          <Ionicons name="hardware-chip-outline" size={20} color="#fff" />
        </LinearGradient>
        <Text style={styles.coreNodeLabel}>Agent Core</Text>
      </View>
    </View>
  );
}

export function AgentBuilderScreen() {
  const navigation = useNavigation<any>();
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [pendingDrafts, setPendingDrafts] = useState<PendingDraft[]>([]);
  const [resolvingDraft, setResolvingDraft] = useState<string | null>(null);

  // Step 1 — platform. Step 2 (name/instructions/samples) only exists once
  // this is set, per "make that a separate section once chosen".
  const [kind, setKind] = useState<AgentKind | null>(null);
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [tone, setTone] = useState("");
  const [autoSend, setAutoSend] = useState(false);
  const [creating, setCreating] = useState(false);

  // Sample replies — up to 5 real few-shot examples, each classified for real.
  const [sampleReplies, setSampleReplies] = useState<SampleReply[]>([]);
  const [replyDraft, setReplyDraft] = useState("");
  const [classifyingReply, setClassifyingReply] = useState(false);
  const [pendingReplyText, setPendingReplyText] = useState("");

  // The Agent Builder's own AI assistant.
  const [assistOpen, setAssistOpen] = useState(false);
  const [assistMessages, setAssistMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const assistScrollRef = useRef<ScrollView>(null);
  const [assistInput, setAssistInput] = useState("");
  const [assistBusy, setAssistBusy] = useState(false);
  const [assistSuggestion, setAssistSuggestion] = useState<{ instructions: string; sampleReplies: string[] } | null>(null);

  const [testInput, setTestInput] = useState<Record<string, string>>({});
  const [testOutput, setTestOutput] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [copiedAgentId, setCopiedAgentId] = useState<string | null>(null);

  const load = () => {
    api<{ agents: Agent[] }>("/api/agents").then((r) => setAgents(r.agents));
    api<{ drafts: PendingDraft[] }>("/api/agents/pending-drafts").then((r) => setPendingDrafts(r.drafts));
  };
  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (assistMessages.length) assistScrollRef.current?.scrollToEnd({ animated: true });
  }, [assistMessages]);

  const resetBuilder = () => {
    setKind(null);
    setName("");
    setInstructions("");
    setTone("");
    setAutoSend(false);
    setSampleReplies([]);
    setReplyDraft("");
    setAssistOpen(false);
    setAssistMessages([]);
    setAssistSuggestion(null);
  };

  const create = async () => {
    if (!kind || !name.trim() || !instructions.trim()) return;
    setCreating(true);
    try {
      await api("/api/agents", {
        method: "POST",
        body: JSON.stringify({ name, kind, instructions, tone: tone.trim() || undefined, autoSend, sampleReplies }),
      });
      resetBuilder();
      await load();
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (agent: Agent) => {
    await api(`/api/agents/${agent.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !agent.isActive }) });
    await load();
  };

  // The real "let me chat this myself" switch — see server's agents.isPaused.
  // Silences this agent everywhere immediately; no draft, no send, nothing
  // queued, until switched back off.
  const togglePaused = async (agent: Agent) => {
    await api(`/api/agents/${agent.id}`, { method: "PATCH", body: JSON.stringify({ isPaused: !agent.isPaused }) });
    await load();
  };

  // Manual per-conversation takeover — the deliberate counterpart to the
  // automatic Meta-echo detection server-side: works for every platform,
  // real 5 minutes of silence on that one conversation.
  const takeoverConversation = async (draft: PendingDraft) => {
    await api(`/api/agents/${draft.agentId}/conversations/${encodeURIComponent(draft.externalConversationId)}/takeover`, { method: "POST" });
    Alert.alert("You're live", "NexaAi will stay quiet on this one conversation for 5 minutes so you can reply yourself.");
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

  const copyWebhookUrl = async (agent: Agent) => {
    if (!agent.config.webhookToken) return;
    await Clipboard.setStringAsync(`${API_URL}/api/webhooks/agent/${agent.id}/${agent.config.webhookToken}`);
    setCopiedAgentId(agent.id);
    setTimeout(() => setCopiedAgentId((id) => (id === agent.id ? null : id)), 1800);
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

  const classifyOne = async (text: string): Promise<SampleReply> => {
    try {
      const { category } = await api<{ category: SampleCategory }>("/api/agents/classify-reply", {
        method: "POST",
        body: JSON.stringify({ text }),
      });
      return { text, category };
    } catch {
      return { text, category: "faq" };
    }
  };

  const addSampleReply = async () => {
    const text = replyDraft.trim();
    if (!text || sampleReplies.length >= 5 || classifyingReply) return;
    setReplyDraft("");
    setClassifyingReply(true);
    setPendingReplyText(text);
    const classified = await classifyOne(text);
    setSampleReplies((prev) => [...prev, classified].slice(0, 5));
    setClassifyingReply(false);
  };

  const removeSampleReply = (index: number) => setSampleReplies((prev) => prev.filter((_, i) => i !== index));

  const sendAssist = async () => {
    const text = assistInput.trim();
    if (!text || assistBusy) return;
    setAssistInput("");
    setAssistBusy(true);
    setAssistSuggestion(null);
    const historyForCall = assistMessages;
    setAssistMessages((prev) => [...prev, { role: "user", content: text }]);
    try {
      const result = await api<{ reply: string; suggestion: { instructions: string; sampleReplies: string[] } | null }>("/api/agents/assist", {
        method: "POST",
        body: JSON.stringify({ message: text, history: historyForCall }),
      });
      setAssistMessages((prev) => [...prev, { role: "assistant", content: result.reply }]);
      if (result.suggestion) setAssistSuggestion(result.suggestion);
    } catch (err) {
      setAssistMessages((prev) => [
        ...prev,
        { role: "assistant", content: err instanceof ApiError ? err.message : "Sorry, I couldn't reach NexaAi just now — try again." },
      ]);
    } finally {
      setAssistBusy(false);
    }
  };

  const applyAssistSuggestion = async () => {
    if (!assistSuggestion) return;
    setInstructions(assistSuggestion.instructions);
    const room = Math.max(0, 5 - sampleReplies.length);
    const toAdd = assistSuggestion.sampleReplies.slice(0, room);
    setAssistSuggestion(null);
    setAssistOpen(false);
    if (!toAdd.length) return;
    setClassifyingReply(true);
    setPendingReplyText(toAdd.length === 1 ? toAdd[0] : `${toAdd.length} suggested replies`);
    const classified = await Promise.all(toAdd.map(classifyOne));
    setSampleReplies((prev) => [...prev, ...classified].slice(0, 5));
    setClassifyingReply(false);
  };

  return (
    <GalaxyBackground>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Build an agent</Text>
        <Text style={styles.subtitle}>
          Pick a platform, describe what it should do, and train it with real example replies. You can safely test drafts here
          before connecting a real account in Settings → Connectors.
        </Text>

        {pendingDrafts.length > 0 && (
          <View>
            <Text style={styles.sectionLabel}>Waiting for your approval</Text>
            {pendingDrafts.map((draft, i) => (
              <FadeInUp key={draft.id} delayMs={i * 60}>
                <View style={styles.draftCard}>
                  <View style={styles.draftHeaderRow}>
                    <Text style={styles.draftPlatform}>{PLATFORM_LABELS[draft.platform]}</Text>
                    {draft.humanTakeoverActive ? (
                      <View style={styles.takeoverBadge}>
                        <Ionicons name="person" size={11} color={palette.accentBright} />
                        <Text style={styles.takeoverBadgeText}>You're live on this one</Text>
                      </View>
                    ) : (
                      <TouchableOpacity style={styles.takeoverButton} onPress={() => takeoverConversation(draft)}>
                        <Ionicons name="hand-left-outline" size={12} color={palette.textSecondary} />
                        <Text style={styles.takeoverButtonText}>I'll reply myself</Text>
                      </TouchableOpacity>
                    )}
                  </View>
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
          <Text style={styles.stepLabel}>Step 1 · Choose a platform</Text>
          <PlatformWireDiagram selectedKind={kind} onSelect={setKind} palette={palette} />

          {kind && (
            <FadeInUp style={styles.step2}>
              <View style={styles.step2Header}>
                <Text style={styles.stepLabel}>Step 2 · Describe &amp; train your agent</Text>
                <TouchableOpacity onPress={() => setKind(null)}>
                  <Text style={styles.changePlatformLink}>Change platform</Text>
                </TouchableOpacity>
              </View>

              <TextInput style={styles.input} placeholder="Agent name" placeholderTextColor={palette.textMuted} value={name} onChangeText={setName} />

              <View style={styles.assistSection}>
                <TouchableOpacity style={styles.assistToggle} onPress={() => setAssistOpen((v) => !v)}>
                  <Ionicons name="sparkles" size={14} color={palette.accentBright} />
                  <Text style={styles.assistToggleText}>{assistOpen ? "Hide AI assistant" : "Not sure what to write? Ask NexaAi"}</Text>
                  <Ionicons name={assistOpen ? "chevron-up" : "chevron-down"} size={14} color={palette.textMuted} />
                </TouchableOpacity>
                {assistOpen && (
                  <View style={styles.assistPanel}>
                    <ScrollView ref={assistScrollRef} style={styles.assistMessages} contentContainerStyle={styles.assistMessagesContent} nestedScrollEnabled>
                      {assistMessages.length === 0 && (
                        <Text style={styles.assistEmptyText}>
                          Tell me what this agent is for — e.g. "auto-reply to my bakery's Instagram DMs about hours and pricing" — and
                          I'll help you build real instructions and example replies.
                        </Text>
                      )}
                      {assistMessages.map((m, i) => (
                        <View key={i} style={[styles.assistBubble, m.role === "user" ? styles.assistBubbleUser : styles.assistBubbleAi]}>
                          <Text style={[styles.assistBubbleText, m.role === "user" && styles.assistBubbleTextUser]}>{m.content}</Text>
                        </View>
                      ))}
                      {assistBusy && <ActivityIndicator size="small" color={palette.accentBright} style={{ alignSelf: "flex-start" }} />}
                    </ScrollView>

                    {assistSuggestion && (
                      <View style={styles.suggestionCard}>
                        <View style={styles.suggestionHeader}>
                          <Ionicons name="sparkles" size={13} color={palette.accentBright} />
                          <Text style={styles.suggestionLabel}>NexaAi's suggestion</Text>
                        </View>
                        <Text style={styles.suggestionInstructions} numberOfLines={4}>
                          {assistSuggestion.instructions}
                        </Text>
                        <Text style={styles.suggestionReplyCount}>
                          {assistSuggestion.sampleReplies.length} example repl{assistSuggestion.sampleReplies.length === 1 ? "y" : "ies"} included
                        </Text>
                        <TouchableOpacity style={styles.suggestionApplyButton} onPress={applyAssistSuggestion}>
                          <Ionicons name="checkmark-circle" size={14} color="#fff" />
                          <Text style={styles.suggestionApplyText}>Use this</Text>
                        </TouchableOpacity>
                      </View>
                    )}

                    <View style={styles.assistInputRow}>
                      <TextInput
                        style={styles.assistInput}
                        placeholder="Describe what you need…"
                        placeholderTextColor={palette.textMuted}
                        value={assistInput}
                        onChangeText={setAssistInput}
                        onSubmitEditing={sendAssist}
                        editable={!assistBusy}
                      />
                      <TouchableOpacity style={styles.assistSendButton} onPress={sendAssist} disabled={assistBusy}>
                        <Ionicons name="arrow-up" size={16} color="#fff" />
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>

              <Text style={styles.fieldLabel}>What should it do &amp; say?</Text>
              <TextInput
                style={[styles.input, styles.multiline]}
                placeholder="e.g. Answer pricing questions with our price list, and hand off anything about refunds."
                placeholderTextColor={palette.textMuted}
                value={instructions}
                onChangeText={setInstructions}
                multiline
              />

              <Text style={styles.fieldLabel}>
                How should it talk? <Text style={styles.fieldLabelMuted}>(optional)</Text>
              </Text>
              <TextInput
                style={[styles.input, styles.multiline]}
                placeholder='e.g. Warm and casual, short sentences, the occasional emoji — like a real person, not a script.'
                placeholderTextColor={palette.textMuted}
                value={tone}
                onChangeText={setTone}
                multiline
              />

              <View style={styles.samplesSection}>
                <Text style={styles.fieldLabel}>
                  Example replies <Text style={styles.fieldLabelMuted}>(up to 5 — the agent actually uses these)</Text>
                </Text>
                <View style={styles.samplesBox}>
                  {sampleReplies.length === 0 && !classifyingReply && (
                    <Text style={styles.samplesEmpty}>None yet — try "Hi, how can we help you today?" below.</Text>
                  )}
                  {sampleReplies.map((s, i) => (
                    <View key={i} style={styles.sampleChip}>
                      <View style={[styles.sampleChipTag, s.category === "welcome" ? styles.sampleChipTagWelcome : styles.sampleChipTagFaq]}>
                        <Text style={styles.sampleChipTagText}>{s.category === "welcome" ? "Welcome" : "FAQ"}</Text>
                      </View>
                      <Text style={styles.sampleChipText}>{s.text}</Text>
                      <TouchableOpacity onPress={() => removeSampleReply(i)}>
                        <Ionicons name="close" size={14} color={palette.textMuted} />
                      </TouchableOpacity>
                    </View>
                  ))}
                  {classifyingReply && (
                    <View style={styles.sampleChip}>
                      <ActivityIndicator size="small" color={palette.accentBright} />
                      <Text style={styles.sampleChipText} numberOfLines={1}>
                        {pendingReplyText}
                      </Text>
                    </View>
                  )}
                </View>
                <TextInput
                  style={styles.input}
                  placeholder={sampleReplies.length >= 5 ? "Maximum of 5 reached" : 'e.g. "Hi, how can we help you today?"'}
                  placeholderTextColor={palette.textMuted}
                  value={replyDraft}
                  onChangeText={setReplyDraft}
                  onSubmitEditing={addSampleReply}
                  editable={sampleReplies.length < 5 && !classifyingReply}
                  returnKeyType="done"
                />
              </View>

              <View style={styles.autoSendRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Auto-send replies</Text>
                  <Text style={styles.fieldLabelMuted}>Off means every reply waits for your approval above.</Text>
                </View>
                <ToggleSwitch value={autoSend} onValueChange={setAutoSend} />
              </View>

              <TouchableOpacity style={styles.primaryButton} onPress={create} disabled={creating || !name.trim() || !instructions.trim()}>
                {creating ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Create agent</Text>}
              </TouchableOpacity>
            </FadeInUp>
          )}
        </View>

        {agents.map((agent, i) => (
          <FadeInUp key={agent.id} delayMs={i * 60}>
            <View style={styles.agentCard}>
              <View style={styles.agentHeader}>
                <View style={styles.agentHeaderLeft}>
                  <View style={[styles.agentKindIcon, { backgroundColor: KIND_META[agent.kind].color }]}>
                    <Ionicons name={KIND_META[agent.kind].icon} size={16} color="#fff" />
                  </View>
                  <View>
                    <Text style={styles.agentName}>{agent.name}</Text>
                    <Text style={styles.agentKind}>{KIND_LABELS[agent.kind]}</Text>
                  </View>
                </View>
                <ToggleSwitch value={agent.isActive} onValueChange={() => toggleActive(agent)} />
              </View>
              {agent.isActive && LIVE_PLATFORM_LABEL[agent.kind] && (
                <TouchableOpacity onPress={() => navigation.navigate("Connectors")}>
                  <Text style={styles.notConnectedNote}>
                    Make sure {LIVE_PLATFORM_LABEL[agent.kind]} is connected in Settings → Connectors, or real messages won't get a reply.{" "}
                    {agent.config.autoSend ? "Auto-send is ON — replies go out immediately." : "Auto-send is off — replies wait above for your approval."}
                  </Text>
                </TouchableOpacity>
              )}
              {agent.isActive && (
                <View style={styles.pauseRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pauseLabel}>Pause — chat without the bot interrupting</Text>
                    <Text style={styles.pauseHint}>
                      {agent.isPaused
                        ? "Paused — NexaAi is staying completely quiet on this one. Flip it back on when you're done."
                        : "On means NexaAi is really quiet — no drafts, no sends — while you're on it yourself."}
                    </Text>
                  </View>
                  <ToggleSwitch value={agent.isPaused} onValueChange={() => togglePaused(agent)} />
                </View>
              )}
              {agent.kind === "generic_webhook" && agent.config.webhookToken && (
                <View style={styles.webhookBox}>
                  <View style={styles.webhookHeader}>
                    <Ionicons name="link-outline" size={13} color={palette.accentBright} />
                    <Text style={styles.webhookLabel}>Real inbound webhook</Text>
                  </View>
                  <Text style={styles.webhookUrl} numberOfLines={1} selectable>
                    {API_URL}/api/webhooks/agent/{agent.id}/{agent.config.webhookToken}
                  </Text>
                  <Text style={styles.webhookHint}>
                    POST {"{ \"message\": \"...\" }"} to this URL from anywhere (Zapier, your own backend, a website widget) and get back a
                    real Claude-drafted reply as {"{ \"draftReply\": \"...\" }"} — no third-party review needed, it works the moment this
                    agent is active.
                  </Text>
                  <TouchableOpacity style={styles.copyButton} onPress={() => copyWebhookUrl(agent)}>
                    <Ionicons name={copiedAgentId === agent.id ? "checkmark" : "copy-outline"} size={14} color={palette.accentBright} />
                    <Text style={styles.copyButtonText}>{copiedAgentId === agent.id ? "Copied!" : "Copy webhook URL"}</Text>
                  </TouchableOpacity>
                </View>
              )}
              {agent.kind === "custom" && (
                <Text style={styles.notConnectedNote}>Testing/preview only — no live channel is connected to this agent kind.</Text>
              )}
              {!!agent.config.sampleReplies?.length && (
                <View style={styles.samplesBox}>
                  {agent.config.sampleReplies.map((s, si) => (
                    <View key={si} style={styles.sampleChip}>
                      <View style={[styles.sampleChipTag, s.category === "welcome" ? styles.sampleChipTagWelcome : styles.sampleChipTagFaq]}>
                        <Text style={styles.sampleChipTagText}>{s.category === "welcome" ? "Welcome" : "FAQ"}</Text>
                      </View>
                      <Text style={styles.sampleChipText}>{s.text}</Text>
                    </View>
                  ))}
                </View>
              )}
              <TextInput
                style={styles.input}
                placeholder="Try an incoming message…"
                placeholderTextColor={palette.textMuted}
                value={testInput[agent.id] ?? ""}
                onChangeText={(t) => setTestInput((prev) => ({ ...prev, [agent.id]: t }))}
              />
              <TouchableOpacity style={styles.secondaryButton} onPress={() => dryRun(agent)} disabled={testing === agent.id}>
                {testing === agent.id ? <ActivityIndicator color={palette.accentBright} /> : <Text style={styles.secondaryButtonText}>Preview draft reply</Text>}
              </TouchableOpacity>
              {testOutput[agent.id] && <Text style={styles.draftReply}>{testOutput[agent.id]}</Text>}
            </View>
          </FadeInUp>
        ))}
      </ScrollView>
    </GalaxyBackground>
  );
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    container: { padding: spacing.lg, gap: spacing.lg },
    title: { ...typography.h1, color: palette.textPrimary },
    subtitle: { ...typography.body, color: palette.textSecondary },
    sectionLabel: { ...typography.caption, color: palette.textMuted, textTransform: "uppercase", marginBottom: spacing.sm },
    stepLabel: { ...typography.sectionLabel, color: palette.textMuted, textTransform: "uppercase", letterSpacing: 0.6 },
    form: { backgroundColor: palette.bgCard, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.md, borderWidth: 1, borderColor: palette.border },
    input: { backgroundColor: palette.bgCardAlt, borderRadius: radii.md, padding: spacing.md, color: palette.textPrimary },
    multiline: { minHeight: 70, textAlignVertical: "top" },

    // Platform wire diagram
    wireDiagram: { gap: spacing.md, paddingVertical: spacing.sm },
    wireTilesRow: { flexDirection: "row", justifyContent: "space-between" },
    wireTile: { alignItems: "center", gap: 6, width: 60 },
    wireTileIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", opacity: 0.55 },
    wireTileIconActive: { opacity: 1, shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } },
    wireTileLabel: { ...typography.caption, color: palette.textMuted, fontSize: 11, textAlign: "center" },
    coreNodeWrap: { alignItems: "center", gap: 4, alignSelf: "center" },
    coreNode: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
    coreNodeLabel: { ...typography.caption, color: palette.textSecondary, fontWeight: "700", fontSize: 11 },

    step2: { gap: spacing.md, borderTopWidth: 1, borderTopColor: palette.border, paddingTop: spacing.md },
    step2Header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    changePlatformLink: { ...typography.caption, color: palette.accentBright, fontWeight: "700" },

    fieldLabel: { ...typography.caption, color: palette.textSecondary, fontWeight: "700" },
    fieldLabelMuted: { color: palette.textMuted, fontWeight: "400" },

    // AI assist panel
    assistSection: { gap: spacing.sm },
    assistToggle: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" },
    assistToggleText: { ...typography.caption, color: palette.accentBright, fontWeight: "700" },
    assistPanel: {
      backgroundColor: palette.bgCardAlt,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.border,
      padding: spacing.md,
      gap: spacing.sm,
    },
    assistMessages: { maxHeight: 220 },
    assistMessagesContent: { gap: 8, paddingBottom: 2 },
    assistEmptyText: { ...typography.caption, color: palette.textMuted, lineHeight: 18 },
    assistBubble: { borderRadius: radii.md, padding: spacing.sm, maxWidth: "88%" },
    assistBubbleUser: { backgroundColor: palette.accent, alignSelf: "flex-end" },
    assistBubbleAi: { backgroundColor: palette.bgCard, alignSelf: "flex-start", borderWidth: 1, borderColor: palette.border },
    assistBubbleText: { ...typography.caption, color: palette.textPrimary, lineHeight: 18 },
    assistBubbleTextUser: { color: "#fff" },
    assistInputRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
    assistInput: { flex: 1, backgroundColor: palette.bgCard, borderRadius: radii.pill, borderWidth: 1, borderColor: palette.border, paddingHorizontal: spacing.md, paddingVertical: 10, color: palette.textPrimary },
    assistSendButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: palette.accent, alignItems: "center", justifyContent: "center" },
    suggestionCard: { backgroundColor: palette.bgCard, borderRadius: radii.md, borderWidth: 1, borderColor: palette.accentBright, padding: spacing.sm, gap: 6 },
    suggestionHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
    suggestionLabel: { ...typography.caption, color: palette.accentBright, fontWeight: "700", textTransform: "uppercase", fontSize: 11 },
    suggestionInstructions: { ...typography.caption, color: palette.textSecondary, lineHeight: 17 },
    suggestionReplyCount: { ...typography.caption, color: palette.textMuted, fontSize: 11 },
    suggestionApplyButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: palette.accent, borderRadius: radii.md, paddingVertical: 8, marginTop: 2 },
    suggestionApplyText: { ...typography.caption, color: "#fff", fontWeight: "700" },

    // Sample replies
    samplesSection: { gap: spacing.sm },
    samplesBox: { backgroundColor: "transparent", borderRadius: radii.md, borderWidth: 1, borderColor: palette.border, borderStyle: "dashed", padding: spacing.sm, gap: 6, minHeight: 44 },
    samplesEmpty: { ...typography.caption, color: palette.textMuted, fontStyle: "italic" },
    sampleChip: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: palette.bgCardAlt, borderRadius: radii.pill, paddingVertical: 6, paddingHorizontal: 10 },
    sampleChipTag: { borderRadius: radii.sm, paddingHorizontal: 6, paddingVertical: 2 },
    sampleChipTagWelcome: { backgroundColor: palette.success },
    sampleChipTagFaq: { backgroundColor: palette.accent },
    sampleChipTagText: { fontSize: 10, fontWeight: "800", color: "#fff" },
    sampleChipText: { ...typography.caption, color: palette.textPrimary, flex: 1 },

    autoSendRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },

    primaryButton: { backgroundColor: palette.accent, borderRadius: radii.md, padding: spacing.md, alignItems: "center" },
    primaryButtonText: { color: "#fff", fontWeight: "700" },
    secondaryButton: { backgroundColor: palette.bgCardAlt, borderRadius: radii.md, padding: spacing.sm, alignItems: "center" },
    secondaryButtonText: { color: palette.accentBright, fontWeight: "600" },
    agentCard: { backgroundColor: palette.bgCard, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm, borderWidth: 1, borderColor: palette.border },
    agentHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    agentHeaderLeft: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    agentKindIcon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
    agentName: { ...typography.bodyBold, color: palette.textPrimary },
    agentKind: { ...typography.caption, color: palette.textMuted },
    notConnectedNote: { ...typography.caption, color: palette.warning, fontStyle: "italic" },
    pauseRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      backgroundColor: palette.bgCardAlt,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.border,
      padding: spacing.sm,
    },
    pauseLabel: { ...typography.bodyBold, color: palette.textPrimary, fontSize: 13 },
    pauseHint: { ...typography.caption, color: palette.textMuted },
    takeoverBadge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      alignSelf: "flex-start",
      backgroundColor: palette.accentGlow,
      borderRadius: radii.pill,
      paddingVertical: 3,
      paddingHorizontal: spacing.sm,
    },
    takeoverBadgeText: { ...typography.caption, color: palette.accentBright, fontWeight: "700" },
    takeoverButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: palette.bgCardAlt,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: palette.border,
      paddingVertical: 6,
      paddingHorizontal: spacing.sm,
    },
    takeoverButtonText: { ...typography.caption, color: palette.textSecondary, fontWeight: "600" },
    webhookBox: { backgroundColor: palette.bgCardAlt, borderRadius: radii.md, borderWidth: 1, borderColor: palette.border, padding: spacing.md, gap: 6 },
    webhookHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
    webhookLabel: { ...typography.caption, color: palette.textMuted, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 },
    webhookUrl: { ...typography.caption, color: palette.accentBright, fontFamily: "monospace" as const },
    webhookHint: { ...typography.caption, color: palette.textSecondary, lineHeight: 17 },
    copyButton: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", marginTop: 2 },
    copyButtonText: { ...typography.caption, color: palette.accentBright, fontWeight: "700" },
    draftReply: { ...typography.body, color: palette.textPrimary, backgroundColor: palette.bgCardAlt, borderRadius: radii.md, padding: spacing.md },
    draftCard: { backgroundColor: palette.bgCard, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.sm, borderWidth: 1, borderColor: palette.warning, marginBottom: spacing.sm },
    draftHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    draftPlatform: { ...typography.bodyBold, color: palette.textPrimary },
    draftIncoming: { ...typography.body, color: palette.textSecondary, fontStyle: "italic" },
    draftReplyLabel: { ...typography.caption, color: palette.textMuted, marginTop: spacing.xs },
    draftButtons: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
    rejectButton: { flex: 1, backgroundColor: palette.bgCardAlt, borderRadius: radii.md, padding: spacing.md, alignItems: "center" },
    rejectButtonText: { color: palette.danger, fontWeight: "700" },
    approveButton: { flex: 1, backgroundColor: palette.success, borderRadius: radii.md, padding: spacing.md, alignItems: "center" },
    approveButtonText: { color: "#08130E", fontWeight: "700" },
  });
}
