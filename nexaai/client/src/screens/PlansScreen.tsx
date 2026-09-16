import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import * as WebBrowser from "expo-web-browser";
import { Ionicons } from "@expo/vector-icons";
import { spacing, typography } from "../theme/colors";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { useApplePurchase } from "../lib/applePurchase";
import { Alert } from "../lib/alert";
import { webUrl } from "../lib/webLinks";

// How often to re-poll usage/plan while this screen is on-screen — real
// server state can change out from under it (a webhook finishing a Paddle
// checkout, a rolling usage window resetting) with no push channel to tell
// the client, so a lightweight poll is the honest way to stay live.
const LIVE_REFRESH_MS = 10000;

type PlanTier = "beginner" | "pro" | "max";

interface PlanDefinition {
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
  defaultThinkingBudgetTokens: number | null;
  messagesPerWindow: number;
}

interface FocusModeDefinition {
  mode: "quick" | "build" | "auto" | "gorilla";
  label: string;
  tagline: string;
  minPlanTier: PlanTier;
  creditMultiplier: number;
}

interface UsageStatus {
  messagesUsedInWindow: number;
  messagesPerWindow: number;
  resetAt: string | null;
}

const TIER_RANK: Record<PlanTier, number> = { beginner: 0, pro: 1, max: 2 };

// A deliberately light, fixed palette for this one screen — matches the
// real Claude "Get more Claude" upgrade sheet's own look exactly, which
// stays light regardless of the surrounding app's theme (visible in the
// reference: the dark chat screen bleeds through behind a white sheet).
const LIGHT = {
  page: "#efeeea",
  card: "#ffffff",
  border: "#e6e4e0",
  borderStrong: "#111111",
  textPrimary: "#141414",
  textSecondary: "#4a4a48",
  textMuted: "#8d8b86",
  accent: "#1f6fed",
  accentTint: "#eaf1fe",
  black: "#111111",
  success: "#1f8a4c",
};

/** "in 2h 14m" / "in 38m" from a reset instant — same shape as the server's own countdown wording. */
function formatCountdown(resetAtIso: string): string {
  const ms = Math.max(0, new Date(resetAtIso).getTime() - Date.now());
  const totalMinutes = Math.ceil(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}m`;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

const EMBER_MARKETING_STRENGTH = 3; // beginner's own marketingStrength — the baseline every ratio below is computed against

/** Compares this tier against the entry tier, in plain outcome terms — never names which underlying model/provider powers it. */
function modelComparisonLine(plan: PlanDefinition): string {
  if (plan.tier === "beginner") return "The everyday starting point — every plan builds up from here";
  return `${plan.marketingStrength / EMBER_MARKETING_STRENGTH}x more capable than Ember`;
}

/** Real, data-driven differences between two tiers — never a fabricated marketing bullet. */
function buildChecklist(target: PlanDefinition, baseline: PlanDefinition, focusModes: FocusModeDefinition[]): string[] {
  const lines: string[] = [`${target.marketingStrength / EMBER_MARKETING_STRENGTH}x strength — ${target.pitch}`];
  if (target.messagesPerWindow > baseline.messagesPerWindow) {
    lines.push(`${target.messagesPerWindow} messages every 5 hours (up from ${baseline.messagesPerWindow})`);
  }
  if (target.maxOutputTokens > baseline.maxOutputTokens) {
    lines.push(`Up to ${target.maxOutputTokens.toLocaleString()} tokens per reply`);
  }
  const targetBudget = target.defaultThinkingBudgetTokens ?? 0;
  const baselineBudget = baseline.defaultThinkingBudgetTokens ?? 0;
  if (targetBudget > 0 && baselineBudget === 0) {
    lines.push("Extended thinking enabled, for deeper reasoning on hard questions");
  } else if (targetBudget > baselineBudget) {
    lines.push("A bigger extended-thinking budget, for even deeper reasoning on hard questions");
  }
  for (const mode of focusModes) {
    if (TIER_RANK[mode.minPlanTier] === TIER_RANK[target.tier] && TIER_RANK[target.tier] > TIER_RANK[baseline.tier]) {
      lines.push(`Unlock ${mode.label} focus mode — ${mode.tagline}`);
    }
  }
  return lines;
}

export function PlansScreen() {
  const { user, refreshUser } = useAuth();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(), []);
  const [plans, setPlans] = useState<PlanDefinition[]>([]);
  const [focusModes, setFocusModes] = useState<FocusModeDefinition[]>([]);
  const [usage, setUsage] = useState<UsageStatus | null>(null);
  const [appleProductIds, setAppleProductIds] = useState<{ pro: string | null; max: string | null }>({ pro: null, max: null });
  const [selectedTier, setSelectedTier] = useState<PlanTier | null>(null);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    // Static, rarely-changing catalog data — fetched once, not on every
    // focus/poll tick like the live usage/plan state below.
    api<{ plans: PlanDefinition[] }>("/api/plans").then((r) => setPlans(r.plans));
    api<{ focusModes: FocusModeDefinition[] }>("/api/plans/focus-modes").then((r) => setFocusModes(r.focusModes));
    if (Platform.OS === "ios") {
      api<{ pro: string | null; max: string | null }>("/api/plans/apple/product-ids").then(setAppleProductIds);
    }
  }, []);

  const refreshAfterPlanChange = async () => {
    await refreshUser();
    setUsage(await api<UsageStatus>("/api/plans/usage"));
  };

  // Real auto-reload: refetch the instant this screen gains focus (catches
  // a plan/usage change made elsewhere — e.g. Chat burning through the
  // rolling window), then keep polling every LIVE_REFRESH_MS while it stays
  // focused (catches an async Paddle webhook landing seconds after a
  // checkout browser tab closes). Both stop the moment the screen blurs.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const tick = () => {
        api<UsageStatus>("/api/plans/usage").then((r) => {
          if (!cancelled) setUsage(r);
        }).catch(() => {});
        refreshUser().catch(() => {});
      };
      tick();
      const interval = setInterval(tick, LIVE_REFRESH_MS);
      return () => {
        cancelled = true;
        clearInterval(interval);
      };
    }, [refreshUser]),
  );

  // Real Apple StoreKit subscription purchase — every plan is sold via
  // StoreKit on iOS (Guideline 3.1.1); credit top-ups are a website-only
  // add-on, deliberately kept out of this app (see CreditsScreen.tsx).
  const proPurchase = useApplePurchase({ productId: appleProductIds.pro, type: "subs", verifyEndpoint: "/api/plans/apple/verify" });
  const maxPurchase = useApplePurchase({ productId: appleProductIds.max, type: "subs", verifyEndpoint: "/api/plans/apple/verify" });
  const applePurchaseByTier: Partial<Record<PlanTier, ReturnType<typeof useApplePurchase>>> = { pro: proPurchase, max: maxPurchase };

  const currentTier = (user?.planTier ?? "beginner") as PlanTier;
  const currentPlan = plans.find((p) => p.tier === currentTier);
  const upgradeTargets = plans.filter((p) => TIER_RANK[p.tier] > TIER_RANK[currentTier]);
  const activeSelection = plans.find((p) => p.tier === selectedTier) ?? upgradeTargets[0];

  const purchasePlan = async (plan: PlanDefinition) => {
    if (Platform.OS === "ios") {
      const purchaseHook = applePurchaseByTier[plan.tier]!;
      if (!purchaseHook.available) {
        Alert.alert("Not available yet", "This plan hasn't been set up for purchase yet — check back soon.");
        return;
      }
      try {
        await purchaseHook.purchase();
        await refreshAfterPlanChange();
      } catch (err) {
        Alert.alert("Purchase failed", err instanceof Error ? err.message : "Something went wrong.");
      }
      return;
    }

    // Web/Android: real Paddle hosted checkout for the recurring subscription.
    try {
      const checkout = await api<{ checkoutUrl: string }>("/api/plans/checkout", { method: "POST", body: JSON.stringify({ tier: plan.tier }) });
      if (Platform.OS === "web") {
        window.location.href = checkout.checkoutUrl;
      } else {
        // Real in-app browser (not Linking.openURL, which hands off to an
        // external browser app with no way to know when it's done) — awaiting
        // its close lets this screen reload the real plan/usage state the
        // instant the checkout finishes, instead of waiting for the next poll.
        await WebBrowser.openBrowserAsync(checkout.checkoutUrl);
        await refreshAfterPlanChange();
      }
    } catch (err) {
      if (err instanceof ApiError && err.body?.error === "payment_provider_not_configured") {
        Alert.alert("Checkout not set up yet", err.body.message ?? "Paddle isn't configured on this server yet.");
      } else {
        Alert.alert("Checkout failed", err instanceof Error ? err.message : "Something went wrong.");
      }
    }
  };

  const downgradeToBeginner = async () => {
    setSwitching(true);
    try {
      await api("/api/plans/switch", { method: "POST", body: JSON.stringify({ tier: "beginner" }) });
      await refreshAfterPlanChange();
    } catch (err) {
      Alert.alert("Couldn't switch plans", err instanceof ApiError ? err.body?.message ?? err.message : "Something went wrong.");
    } finally {
      setSwitching(false);
    }
  };

  const purchasing = activeSelection && Platform.OS === "ios" && applePurchaseByTier[activeSelection.tier]?.purchasing;
  const restoring = proPurchase.restoring || maxPurchase.restoring;

  // Real "I already own this, just reconnect it" — required by App Review
  // for any app selling auto-renewable subscriptions (Guideline 3.1.1),
  // and genuinely useful after a reinstall or a new device. Tries every
  // real subscription product this app sells and keeps whichever one
  // Apple actually confirms the account owns; `restore()` itself already
  // re-verifies the transaction server-side before it counts for anything.
  const restorePurchases = async () => {
    try {
      const results = await Promise.all([proPurchase.restore(), maxPurchase.restore()]);
      if (results.some(Boolean)) {
        await refreshAfterPlanChange();
        Alert.alert("Restored", "Your subscription has been restored.");
      } else {
        Alert.alert("Nothing to restore", "We couldn't find a previous NexaAi subscription on this Apple ID.");
      }
    } catch (err) {
      Alert.alert("Couldn't restore", err instanceof Error ? err.message : "Something went wrong. Try again.");
    }
  };

  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xxl }]}>
        <TouchableOpacity style={styles.closeButton} onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="close" size={20} color={LIGHT.black} />
        </TouchableOpacity>

        <Text style={styles.title}>Get more NexaAi</Text>
        <Text style={styles.subtitle}>Choose the plan that's right for you</Text>

        {!currentPlan ? null : upgradeTargets.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.topPlanTitle}>You're on our top plan</Text>
            <Text style={styles.topPlanBody}>Nexa Zenith is NexaAi's strongest, most capable tier — there's nothing higher to unlock.</Text>
          </View>
        ) : !activeSelection ? null : (
          <View style={styles.card}>
            <Text style={styles.cardEyebrow}>{activeSelection.displayName.replace("Nexa ", "")}</Text>
            <Text style={styles.cardHeadline}>{modelComparisonLine(activeSelection)}</Text>

            <View style={styles.optionRow}>
              {upgradeTargets.map((plan) => {
                const selected = plan.tier === activeSelection.tier;
                return (
                  <TouchableOpacity
                    key={plan.tier}
                    style={[styles.optionBox, selected && styles.optionBoxSelected, upgradeTargets.length === 1 && styles.optionBoxFull]}
                    onPress={() => setSelectedTier(plan.tier)}
                    activeOpacity={0.8}
                  >
                    <View style={[styles.radioOuter, selected && styles.radioOuterSelected]}>{selected && <View style={styles.radioInner} />}</View>
                    <Text style={styles.optionPrice}>${(plan.priceCentsPerMonth! / 100).toFixed(2)}</Text>
                    <Text style={styles.optionSub}>{modelComparisonLine(plan)}</Text>
                    <Text style={styles.optionBilled}>Billed monthly</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TouchableOpacity
              style={[styles.ctaButton, purchasing && { opacity: 0.6 }]}
              onPress={() => purchasePlan(activeSelection)}
              disabled={!!purchasing}
            >
              <Text style={styles.ctaButtonText}>{purchasing ? "Purchasing…" : `Get ${activeSelection.displayName}`}</Text>
            </TouchableOpacity>

            <View style={styles.divider} />

            <Text style={styles.checklistHeader}>Everything in {currentPlan.displayName}, plus:</Text>
            {buildChecklist(activeSelection, currentPlan, focusModes).map((line, i) => (
              <View key={i} style={styles.checklistRow}>
                <Ionicons name="checkmark" size={18} color={LIGHT.textSecondary} />
                <Text style={styles.checklistText}>{line}</Text>
              </View>
            ))}
            <Text style={styles.limitsNote}>Message limits refill on a rolling window, not a fixed daily reset.</Text>
          </View>
        )}

        {Platform.OS === "ios" && (
          <Text style={styles.autoRenewNote}>
            Pro and Max are auto-renewing monthly subscriptions billed to your Apple ID. Your subscription renews
            automatically unless you cancel at least 24 hours before the current period ends — manage or cancel
            anytime in iOS Settings → your name → Subscriptions.
          </Text>
        )}

        <View style={styles.footerLinks}>
          <TouchableOpacity onPress={() => Linking.openURL(webUrl("terms.html"))}>
            <Text style={styles.footerLink}>Terms</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => Linking.openURL(webUrl("privacy.html"))}>
            <Text style={styles.footerLink}>Privacy Policy</Text>
          </TouchableOpacity>
          {Platform.OS === "ios" && (
            <>
              <TouchableOpacity onPress={restorePurchases} disabled={restoring} testID="restore-purchases-button">
                <Text style={styles.footerLink}>{restoring ? "Restoring…" : "Restore purchases"}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => Linking.openURL("https://apps.apple.com/account/subscriptions")} testID="manage-subscription-button">
                <Text style={styles.footerLink}>Manage subscription</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* Current plan & usage — real functionality the promo card above deliberately doesn't compete with visually. */}
        {currentPlan && (
          <View style={styles.currentBlock}>
            <View style={styles.currentRow}>
              <Text style={styles.currentLabel}>Current plan</Text>
              <Text style={styles.currentValue}>{currentPlan.displayName}</Text>
            </View>
            {usage && currentTier !== "beginner" ? (
              <>
                <View style={styles.usageBarTrack}>
                  <View style={[styles.usageBarFill, { width: `${Math.min(1, usage.messagesUsedInWindow / usage.messagesPerWindow) * 100}%` }]} />
                </View>
                <Text style={styles.currentUsageText}>
                  {usage.messagesUsedInWindow} of {usage.messagesPerWindow} messages used
                  {usage.resetAt ? ` · more in ${formatCountdown(usage.resetAt)}` : ""}
                </Text>
              </>
            ) : null}
            {/* Real, always-visible link into the Credits screen (fixed packs + custom
                amount, both fulfilled through a real Stripe web checkout — see
                CreditsScreen.tsx) right where a user is actually looking at their
                usage, not buried a menu away in Settings. */}
            <TouchableOpacity onPress={() => navigation.navigate("Credits")} style={styles.addCreditsLink}>
              <Text style={styles.addCreditsLinkText}>Add credits</Text>
            </TouchableOpacity>
            {currentTier !== "beginner" && (
              <TouchableOpacity onPress={downgradeToBeginner} disabled={switching} style={styles.downgradeLink}>
                <Text style={styles.downgradeLinkText}>{switching ? "Switching…" : "Switch to Nexa Ember (free)"}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function makeStyles() {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: LIGHT.page },
    scrollContent: { padding: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.xxl, gap: spacing.md },

    closeButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: "#ffffff",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: spacing.sm,
    },

    title: { ...typography.h1, fontSize: 34, color: LIGHT.textPrimary },
    subtitle: { ...typography.body, color: LIGHT.textPrimary, marginBottom: spacing.md },

    card: {
      backgroundColor: LIGHT.card,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: LIGHT.border,
      padding: spacing.lg,
      gap: 2,
    },
    cardEyebrow: { ...typography.h1, fontSize: 26, color: LIGHT.textPrimary },
    cardHeadline: { ...typography.body, color: LIGHT.textPrimary, marginBottom: spacing.md },

    optionRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
    optionBox: {
      flex: 1,
      borderWidth: 1,
      borderColor: LIGHT.border,
      borderRadius: 14,
      padding: spacing.md,
      gap: 6,
    },
    optionBoxFull: { flex: 1 },
    optionBoxSelected: { borderColor: LIGHT.accent, backgroundColor: LIGHT.accentTint },
    radioOuter: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 2,
      borderColor: LIGHT.border,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 4,
    },
    radioOuterSelected: { borderColor: LIGHT.accent },
    radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: LIGHT.accent },
    optionPrice: { ...typography.h1, fontSize: 24, color: LIGHT.textPrimary, fontFamily: "Inter_500Medium" },
    optionSub: { ...typography.caption, color: LIGHT.textSecondary },
    optionBilled: { ...typography.caption, color: LIGHT.textMuted, marginTop: 4 },

    ctaButton: {
      backgroundColor: LIGHT.black,
      borderRadius: 999,
      paddingVertical: spacing.md,
      alignItems: "center",
      justifyContent: "center",
      marginTop: spacing.lg,
    },
    ctaButtonText: { ...typography.bodyBold, color: "#ffffff", fontSize: 16 },

    divider: { height: 1, backgroundColor: LIGHT.border, marginVertical: spacing.lg },

    checklistHeader: { ...typography.bodyBold, color: LIGHT.textPrimary, marginBottom: spacing.sm },
    checklistRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, marginBottom: spacing.sm },
    checklistText: { ...typography.body, color: LIGHT.textSecondary, flex: 1 },
    limitsNote: { ...typography.caption, color: LIGHT.textMuted, marginTop: 4 },

    topPlanTitle: { ...typography.h2, color: LIGHT.textPrimary },
    topPlanBody: { ...typography.body, color: LIGHT.textSecondary, marginTop: spacing.xs },

    footerLinks: { flexDirection: "row", justifyContent: "center", flexWrap: "wrap", gap: spacing.lg, marginTop: spacing.md },
    footerLink: { ...typography.caption, color: LIGHT.textSecondary, textDecorationLine: "underline" },
    autoRenewNote: {
      ...typography.caption,
      color: LIGHT.textMuted,
      textAlign: "center",
      marginTop: spacing.lg,
      marginHorizontal: spacing.lg,
      lineHeight: 16,
    },

    currentBlock: {
      backgroundColor: LIGHT.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: LIGHT.border,
      padding: spacing.md,
      gap: 6,
      marginTop: spacing.sm,
    },
    currentRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    currentLabel: { ...typography.caption, color: LIGHT.textMuted, textTransform: "uppercase" },
    currentValue: { ...typography.bodyBold, color: LIGHT.textPrimary },
    usageBarTrack: { height: 6, borderRadius: 3, backgroundColor: LIGHT.border, overflow: "hidden" },
    usageBarFill: { height: 6, borderRadius: 3, backgroundColor: LIGHT.accent },
    currentUsageText: { ...typography.caption, color: LIGHT.textMuted },
    downgradeLink: { marginTop: 4 },
    downgradeLinkText: { ...typography.caption, color: LIGHT.accent, textDecorationLine: "underline" },
    addCreditsLink: { marginTop: 10 },
    addCreditsLinkText: { ...typography.bodyBold, color: LIGHT.accent },
  });
}
