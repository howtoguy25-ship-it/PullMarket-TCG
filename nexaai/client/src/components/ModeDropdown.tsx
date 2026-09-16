import React, { useEffect, useMemo, useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Alert } from "../lib/alert";
import { radii, spacing, typography } from "../theme/colors";
import { useTheme } from "../lib/ThemeContext";
import type { Palette } from "../theme/palettes";
import { api } from "../lib/api";

export type AnswerMode = "strong" | "extra" | "normal";
export type FocusMode = "quick" | "build" | "auto" | "gorilla";
export type PlanTier = "beginner" | "pro" | "max";

interface AnswerModeDefinition {
  mode: AnswerMode;
  answerCount: number;
  label: string;
  description: string;
}

interface FocusModeDefinition {
  mode: FocusMode;
  label: string;
  tagline: string;
  minPlanTier: PlanTier;
  creditMultiplier: number;
}

// Same shape server/src/lib/plans.ts's PLAN_DEFINITIONS returns from
// GET /api/plans — this is the real, live source of truth for what each
// model actually is; nothing here is a hardcoded marketing label.
interface PlanModelDefinition {
  tier: PlanTier;
  displayName: string;
  planLabel: string;
  tagline: string;
  priceCentsPerMonth: number | null;
  strengthMultiplier: number;
  marketingStrength: number;
  pitch: string;
  provider: "self_hosted" | "anthropic";
  model: string;
  maxOutputTokens: number;
  extendedThinking: boolean;
  messagesPerWindow: number;
}

const TIER_RANK: Record<PlanTier, number> = { beginner: 0, pro: 1, max: 2 };
const TIER_LABEL: Record<PlanTier, string> = { beginner: "Beginner", pro: "Pro", max: "Max" };
const MODEL_SHORT_NAME: Record<PlanTier, string> = { beginner: "Ember", pro: "Nova", max: "Zenith" };
const EMBER_MARKETING_STRENGTH = 3; // beginner's own marketingStrength — the baseline every ratio below is computed against
const MAX_STRENGTH = 51; // Zenith's marketingStrength — the power bar's full scale

/** Compares this tier against the entry tier, in plain outcome terms — never names which underlying model/provider powers it. */
function modelComparisonLine(plan: PlanModelDefinition): string {
  if (plan.tier === "beginner") return "The everyday starting point — every plan builds up from here";
  const ratio = plan.marketingStrength / EMBER_MARKETING_STRENGTH;
  return `${ratio}x more capable than Ember — sharper, more thorough answers`;
}

/** Real speed tradeoff derived from the plan's own extendedThinking flag — Gorilla-style deep thinking is genuinely slower, not a cosmetic label. */
function modelSpeed(plan: PlanModelDefinition): string {
  return plan.extendedThinking ? "Deeper, slower thinking" : plan.tier === "beginner" ? "Fastest, lightest" : "Fast, standard speed";
}

interface ModeDropdownProps {
  answerMode: AnswerMode;
  onAnswerModeChange: (mode: AnswerMode) => void;
  focusMode: FocusMode;
  onFocusModeChange: (mode: FocusMode) => void;
  planTier: PlanTier;
  onNavigateToPlans?: () => void;
}

/**
 * One combined Claude-style model/mode picker — a single button that opens
 * a dropdown listing every real option (answer count AND focus/power mode)
 * with its own real description, instead of two separate always-visible
 * pill rows. Both settings stay independently selectable; this only
 * changes how they're presented.
 */
export function ModeDropdown({ answerMode, onAnswerModeChange, focusMode, onFocusModeChange, planTier, onNavigateToPlans }: ModeDropdownProps) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [answerModes, setAnswerModes] = useState<AnswerModeDefinition[]>([]);
  const [focusModes, setFocusModes] = useState<FocusModeDefinition[]>([]);
  const [models, setModels] = useState<PlanModelDefinition[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api<{ plans: PlanModelDefinition[] }>("/api/plans").then((r) => setModels(r.plans));
    api<{ answerModes: AnswerModeDefinition[] }>("/api/plans/answer-modes").then((r) => setAnswerModes(r.answerModes));
    api<{ focusModes: FocusModeDefinition[] }>("/api/plans/focus-modes").then((r) => setFocusModes(r.focusModes));
  }, []);

  const activeFocus = focusModes.find((m) => m.mode === focusMode);
  const activeAnswer = answerModes.find((m) => m.mode === answerMode);

  const isAllowed = (mode: FocusModeDefinition) => TIER_RANK[planTier] >= TIER_RANK[mode.minPlanTier];
  const ownsModel = (model: PlanModelDefinition) => TIER_RANK[planTier] >= TIER_RANK[model.tier];

  const pressModel = (model: PlanModelDefinition) => {
    setOpen(false);
    if (model.tier === planTier) return; // already the active model — nothing to do
    if (ownsModel(model)) {
      // A lower tier than the current plan — downgrading a model isn't a
      // per-message toggle, it's a real plan change with real payment
      // consequences (see routes/plans.ts's /switch). Send them to Plans
      // rather than silently no-op or fake-switch here.
      Alert.alert("Switch models", `${model.displayName} is included in a lower plan. Manage your plan on the Plans screen.`, [
        { text: "Not now", style: "cancel" },
        { text: "Go to Plans", onPress: onNavigateToPlans },
      ]);
      return;
    }
    Alert.alert(
      `${model.displayName} needs ${TIER_LABEL[model.tier]}`,
      `${model.tagline}${model.priceCentsPerMonth ? ` — $${(model.priceCentsPerMonth / 100).toFixed(2)}/mo` : ""}. Upgrade your plan to unlock it.`,
      [
        { text: "Not now", style: "cancel" },
        { text: "See plans", onPress: onNavigateToPlans },
      ],
    );
  };

  const pressFocus = (mode: FocusModeDefinition) => {
    if (isAllowed(mode)) {
      onFocusModeChange(mode.mode);
      setOpen(false);
      return;
    }
    setOpen(false);
    Alert.alert(
      `${mode.label} needs ${TIER_LABEL[mode.minPlanTier]}`,
      `${mode.tagline}. Upgrade your plan to unlock it — it costs ${mode.creditMultiplier}x the usual credits per message.`,
      [
        { text: "Not now", style: "cancel" },
        { text: "See plans", onPress: onNavigateToPlans },
      ],
    );
  };

  return (
    <>
      <TouchableOpacity style={styles.trigger} onPress={() => setOpen(true)} activeOpacity={0.8}>
        <Text style={styles.triggerText} numberOfLines={1}>
          {MODEL_SHORT_NAME[planTier]} · {activeFocus?.label ?? "Quick"} · {activeAnswer?.label.split(" ")[0] ?? "Normal"}
        </Text>
        <Ionicons name="chevron-down" size={14} color={palette.textSecondary} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setOpen(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.panel} onPress={() => {}}>
            <ScrollView>
              <Text style={styles.sectionLabel}>Model</Text>
              <View style={styles.modelList}>
                {models.map((model) => {
                  const active = model.tier === planTier;
                  const owned = ownsModel(model);
                  const locked = !owned; // strictly higher tier than the current plan
                  const priceLabel =
                    active || model.priceCentsPerMonth == null
                      ? null
                      : locked
                        ? `$${(model.priceCentsPerMonth / 100).toFixed(2)}/mo to unlock`
                        : `$${(model.priceCentsPerMonth / 100).toFixed(2)}/mo`;
                  return (
                    <TouchableOpacity
                      key={model.tier}
                      style={[styles.modelCard, active && styles.modelCardActive, locked && styles.modelCardLocked]}
                      onPress={() => pressModel(model)}
                      activeOpacity={0.75}
                    >
                      <View style={styles.modelCardHeader}>
                        <View style={styles.modelTitleCol}>
                          <View style={styles.rowTitleLine}>
                            <Text style={[styles.rowLabel, active && { color: palette.accentBright }, locked && { color: palette.textMuted }]}>
                              {model.displayName}
                            </Text>
                            <View style={[styles.modelPlanBadge, active && { borderColor: palette.accentBright }]}>
                              <Text style={[styles.modelPlanBadgeText, active && { color: palette.accentBright }]}>{model.planLabel}</Text>
                            </View>
                          </View>
                          <Text style={styles.rowDescription}>{model.tagline}</Text>
                        </View>
                        {active ? (
                          <View style={styles.currentBadge}>
                            <Ionicons name="checkmark" size={13} color={palette.accentBright} />
                            <Text style={styles.currentBadgeText}>Current</Text>
                          </View>
                        ) : locked ? (
                          <Ionicons name="lock-closed" size={14} color={palette.textMuted} />
                        ) : null}
                      </View>

                      <View style={styles.powerBlock}>
                        <View style={styles.powerLabelRow}>
                          <Text style={styles.powerLabel}>POWER</Text>
                          <Text style={[styles.powerValue, locked && { color: palette.textMuted }]}>{model.marketingStrength}x</Text>
                        </View>
                        <View style={styles.powerTrack}>
                          <View
                            style={[
                              styles.powerFill,
                              {
                                width: `${(model.marketingStrength / MAX_STRENGTH) * 100}%`,
                                backgroundColor: locked ? palette.textMuted : palette.accentBright,
                              },
                            ]}
                          />
                        </View>
                      </View>

                      <Text style={styles.modelCompareLine}>{modelComparisonLine(model)}</Text>
                      <Text style={styles.modelSpecsLine}>{modelSpeed(model)}</Text>
                      <View style={styles.pitchDivider} />
                      <Text style={styles.modelPitchLine}>{model.pitch}</Text>

                      {priceLabel && <Text style={[styles.modelPriceLine, locked && { color: palette.textSecondary }]}>{priceLabel}</Text>}
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={styles.divider} />

              <Text style={styles.sectionLabel}>Answer style</Text>
              {answerModes.map((mode) => {
                const active = mode.mode === answerMode;
                return (
                  <TouchableOpacity
                    key={mode.mode}
                    style={styles.row}
                    onPress={() => {
                      onAnswerModeChange(mode.mode);
                      setOpen(false);
                    }}
                  >
                    <View style={styles.rowText}>
                      <Text style={[styles.rowLabel, active && { color: palette.accentBright }]}>{mode.label}</Text>
                      <Text style={styles.rowDescription}>{mode.description}</Text>
                    </View>
                    {active && <Ionicons name="checkmark" size={18} color={palette.accentBright} />}
                  </TouchableOpacity>
                );
              })}

              <View style={styles.divider} />

              <Text style={styles.sectionLabel}>Focus mode</Text>
              {focusModes.map((mode) => {
                const active = mode.mode === focusMode;
                const allowed = isAllowed(mode);
                return (
                  <TouchableOpacity key={mode.mode} style={styles.row} onPress={() => pressFocus(mode)}>
                    <View style={styles.rowText}>
                      <View style={styles.rowTitleLine}>
                        <Text style={[styles.rowLabel, active && allowed && { color: palette.accentBright }, !allowed && { color: palette.textMuted }]}>
                          {mode.label}
                        </Text>
                        {!allowed && <Ionicons name="lock-closed" size={11} color={palette.textMuted} style={{ marginLeft: 6 }} />}
                      </View>
                      <Text style={styles.rowDescription}>
                        {mode.tagline} · {mode.creditMultiplier}x credits
                      </Text>
                    </View>
                    {active && allowed && <Ionicons name="checkmark" size={18} color={palette.accentBright} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    trigger: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: palette.bgCardAlt,
      borderRadius: radii.pill,
      paddingVertical: 6,
      paddingHorizontal: spacing.md,
      alignSelf: "flex-start",
      flexShrink: 1,
      minWidth: 0,
    },
    // Real fix for a narrow-screen overflow: this label ("Ember · Quick ·
    // Normal") can be longer than the space left after the composer's
    // fixed-size icon buttons, which used to push the rightmost icon
    // (send/mic) clean off the screen. Letting it truncate instead keeps
    // every button on-screen and tappable.
    triggerText: { ...typography.caption, color: palette.textSecondary, flexShrink: 1 },
    backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", paddingTop: 96, paddingHorizontal: spacing.md },
    panel: {
      backgroundColor: palette.bgElevated,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      maxHeight: 600,
      paddingVertical: spacing.sm,
    },
    sectionLabel: {
      ...typography.sectionLabel,
      color: palette.textMuted,
      textTransform: "uppercase",
      letterSpacing: 0.6,
      paddingHorizontal: spacing.lg,
      marginTop: spacing.sm,
      marginBottom: spacing.sm,
    },
    // The visible rule between sections ("Model" / "Answer style" / "Focus
    // mode") — deliberately higher-contrast than a plain hairline so the
    // three groups read as clearly separate choices, not one long list.
    divider: {
      height: 2,
      backgroundColor: palette.border,
      opacity: 0.9,
      marginHorizontal: spacing.lg,
      marginVertical: spacing.md,
      borderRadius: 1,
    },
    row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
    rowText: { flex: 1, gap: 2 },
    rowTitleLine: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
    rowLabel: { ...typography.bodyBold, color: palette.textPrimary },
    rowDescription: { ...typography.caption, color: palette.textMuted, flexShrink: 1 },

    // Each model gets its own bordered card, not a bare list row — real
    // separation the user can see, not just implied by padding.
    modelList: { paddingHorizontal: spacing.lg, gap: spacing.sm },
    modelCard: {
      backgroundColor: palette.bgCardAlt,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.md,
      padding: spacing.md,
      gap: 6,
    },
    modelCardActive: { borderColor: palette.accentBright, borderWidth: 1.5 },
    modelCardLocked: { opacity: 0.85 },
    modelCardHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.sm },
    modelTitleCol: { flex: 1, gap: 3 },
    modelPlanBadge: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.pill,
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    modelPlanBadgeText: { ...typography.caption, color: palette.textMuted, textTransform: "uppercase", fontSize: 10, letterSpacing: 0.4 },
    currentBadge: { flexDirection: "row", alignItems: "center", gap: 3, flexShrink: 0 },
    currentBadgeText: { ...typography.caption, color: palette.accentBright, fontWeight: "700" },

    // The power bar — a real filled track scaled to MAX_STRENGTH, not just
    // discrete pips, so the visual gap between 1x/3x/5x reads clearly.
    powerBlock: { gap: 4, marginTop: 2 },
    powerLabelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    powerLabel: { ...typography.caption, color: palette.textMuted, fontSize: 10, letterSpacing: 0.6, textTransform: "uppercase" },
    powerValue: { ...typography.caption, color: palette.accentBright, fontWeight: "700" },
    powerTrack: { height: 6, borderRadius: 3, backgroundColor: palette.border, overflow: "hidden" },
    powerFill: { height: 6, borderRadius: 3 },

    modelCompareLine: { ...typography.caption, color: palette.textSecondary, marginTop: 2 },
    modelSpecsLine: { ...typography.caption, color: palette.textMuted },
    // A thin separator inside the card itself, between the quick specs above
    // and the longer purchase-encouraging pitch below — keeps the two from
    // visually running together now that the pitch line is real body copy.
    pitchDivider: { height: 1, backgroundColor: palette.border, opacity: 0.6, marginVertical: 4 },
    modelPitchLine: { ...typography.caption, color: palette.textSecondary, lineHeight: 17 },
    modelPriceLine: { ...typography.caption, color: palette.accentBright, fontWeight: "700", marginTop: 2 },
  });
}
