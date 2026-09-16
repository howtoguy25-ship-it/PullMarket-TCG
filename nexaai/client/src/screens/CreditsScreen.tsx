import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import * as WebBrowser from "expo-web-browser";
import { GalaxyBackground } from "../components/GalaxyBackground";
import { radii, spacing, typography } from "../theme/colors";
import { useTheme } from "../lib/ThemeContext";
import type { Palette } from "../theme/palettes";
import { api, ApiError } from "../lib/api";
import { Alert } from "../lib/alert";
import { WEB_BASE_URL } from "../lib/webLinks";
import { useAuth } from "../lib/AuthContext";

const RECHARGE_PACKS = ["$35", "$80", "$115", "$175"] as const;
const THRESHOLD_OPTIONS_CENTS = [100, 200, 500, 1000];
const CUSTOM_AMOUNT_MIN_CENTS = 500; // must match checkoutSchema's real min in server/src/routes/credits.ts

// Real auto-reload: the balance can change from a source this screen never
// touched directly — an auto-recharge firing in the background off a Chat
// spend (lib/autoRecharge.ts), or a Paddle webhook landing a few seconds
// after a checkout tab closes — so it's worth polling while this screen is
// actually on-screen rather than only trusting the one-shot reloads below.
const LIVE_REFRESH_MS = 10000;

interface CreditPack {
  label: string;
  priceCents: number;
  bonusCents: number;
}

export function CreditsScreen() {
  const { palette } = useTheme();
  const { user, refreshUser } = useAuth();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [balanceCents, setBalanceCents] = useState<number | null>(null);
  const [packs, setPacks] = useState<CreditPack[]>([]);
  const [customAmount, setCustomAmount] = useState("");
  const parsedCustomAmount = parseFloat(customAmount);
  const customAmountCents = Number.isFinite(parsedCustomAmount) ? Math.round(parsedCustomAmount * 100) : 0;
  const isCustomAmountValid = customAmountCents >= CUSTOM_AMOUNT_MIN_CENTS;
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [autoRechargeSaving, setAutoRechargeSaving] = useState(false);

  const load = () => api<{ balanceCents: number; packs: CreditPack[] }>("/api/credits").then((r) => {
    setBalanceCents(r.balanceCents);
    setPacks(r.packs);
  });

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const tick = () => {
        api<{ balanceCents: number; packs: CreditPack[] }>("/api/credits").then((r) => {
          if (!cancelled) {
            setBalanceCents(r.balanceCents);
            setPacks(r.packs);
          }
        }).catch(() => {});
      };
      tick();
      const interval = setInterval(tick, LIVE_REFRESH_MS);
      return () => {
        cancelled = true;
        clearInterval(interval);
      };
    }, []),
  );

  const buy = async (packLabel?: string, customAmountCents?: number) => {
    setBusyLabel(packLabel ?? "custom");
    try {
      const { checkoutUrl } = await api<{ checkoutUrl: string }>("/api/credits/checkout", {
        method: "POST",
        body: JSON.stringify(packLabel ? { packLabel } : { customAmountCents }),
      });
      await WebBrowser.openBrowserAsync(checkoutUrl);
      await load();
    } catch (err) {
      const message =
        err instanceof ApiError && err.status === 503
          ? "Credit top-ups aren't live yet — the app owner needs to connect a Stripe account (see README)."
          : err instanceof ApiError && err.status === 400
            ? `Minimum top-up is $${(CUSTOM_AMOUNT_MIN_CENTS / 100).toFixed(2)}.`
            : "Couldn't start checkout. Try again.";
      Alert.alert("Add credits", message);
    } finally {
      setBusyLabel(null);
    }
  };

  const updateAutoRecharge = async (patch: { autoRechargeEnabled?: boolean; autoRechargeThresholdCents?: number; autoRechargePackLabel?: (typeof RECHARGE_PACKS)[number] }) => {
    setAutoRechargeSaving(true);
    try {
      await api("/api/auth/settings", { method: "PATCH", body: JSON.stringify(patch) });
      await refreshUser();
    } catch {
      Alert.alert("Auto-recharge", "Couldn't save that. Try again.");
    } finally {
      setAutoRechargeSaving(false);
    }
  };

  return (
    <GalaxyBackground>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Credits</Text>
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Balance</Text>
          <Text style={[styles.balanceValue, { color: palette.accentBright }]}>{balanceCents == null ? "…" : `$${(balanceCents / 100).toFixed(2)}`}</Text>
        </View>

        {user && (
          <View style={styles.autoRechargeCard}>
            <View style={styles.autoRechargeHeader}>
              <View style={styles.flex1}>
                <Text style={styles.webOnlyTitle}>Auto-recharge</Text>
                <Text style={styles.webOnlyText}>
                  {user.hasStripePaymentMethodOnFile
                    ? "Top up automatically when your balance runs low, charged to the same payment method you've already used."
                    : "Add credits once on the web first — auto-recharge reuses that same saved payment method automatically after that."}
                </Text>
              </View>
              {autoRechargeSaving ? (
                <ActivityIndicator color={palette.accentBright} />
              ) : (
                <Switch
                  testID="auto-recharge-switch"
                  value={user.autoRechargeEnabled}
                  onValueChange={(value) => updateAutoRecharge({ autoRechargeEnabled: value })}
                  disabled={!user.hasStripePaymentMethodOnFile}
                  trackColor={{ false: palette.toggleTrackOff, true: palette.accent }}
                  thumbColor="#fff"
                />
              )}
            </View>

            {user.autoRechargeEnabled && (
              <>
                <Text style={styles.sectionLabel}>Refill when balance drops below</Text>
                <View style={styles.chipRow}>
                  {THRESHOLD_OPTIONS_CENTS.map((cents) => (
                    <TouchableOpacity
                      key={cents}
                      style={[styles.chip, { borderColor: palette.border }, user.autoRechargeThresholdCents === cents && { backgroundColor: palette.accent, borderColor: palette.accent }]}
                      onPress={() => updateAutoRecharge({ autoRechargeThresholdCents: cents })}
                    >
                      <Text style={[styles.chipText, { color: user.autoRechargeThresholdCents === cents ? "#fff" : palette.textSecondary }]}>${(cents / 100).toFixed(2)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.sectionLabel}>Refill with</Text>
                <View style={styles.chipRow}>
                  {RECHARGE_PACKS.map((label) => (
                    <TouchableOpacity
                      key={label}
                      style={[styles.chip, { borderColor: palette.border }, user.autoRechargePackLabel === label && { backgroundColor: palette.accent, borderColor: palette.accent }]}
                      onPress={() => updateAutoRecharge({ autoRechargePackLabel: label })}
                    >
                      <Text style={[styles.chipText, { color: user.autoRechargePackLabel === label ? "#fff" : palette.textSecondary }]}>{label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}
          </View>
        )}

        {Platform.OS === "ios" ? (
          // Credit top-ups are add-on usage, not a subscription unlock — kept
          // to the website rather than an in-app StoreKit purchase. This is
          // purely informational text, not a tappable checkout link, so it
          // doesn't route around StoreKit for anything the app itself sells.
          <View style={styles.webOnlyCard}>
            <Text style={styles.webOnlyTitle}>Add credits on the web</Text>
            <Text style={styles.webOnlyText}>
              Credit top-ups (extra usage beyond your plan) are managed on NexaAi's website, not in this app. Visit{" "}
              <Text style={styles.webOnlyDomain}>{WEB_BASE_URL.replace(/^https?:\/\//, "")}</Text> from a browser, signed in
              with the same account, to add credits.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.packGrid}>
              {packs.map((pack) => (
                <TouchableOpacity key={pack.label} style={styles.packCard} onPress={() => buy(pack.label)} disabled={!!busyLabel}>
                  {busyLabel === pack.label ? (
                    <ActivityIndicator color={palette.accentBright} />
                  ) : (
                    <>
                      <Text style={styles.packLabel}>{pack.label}</Text>
                      {pack.bonusCents > 0 && <Text style={styles.packBonus}>+${(pack.bonusCents / 100).toFixed(2)} bonus</Text>}
                    </>
                  )}
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.sectionLabel}>Or enter a custom amount (${(CUSTOM_AMOUNT_MIN_CENTS / 100).toFixed(2)} minimum)</Text>
            <View style={styles.customRow}>
              <Text style={styles.dollarSign}>$</Text>
              <TextInput
                style={styles.customInput}
                keyboardType="decimal-pad"
                placeholder="50"
                placeholderTextColor={palette.textMuted}
                value={customAmount}
                onChangeText={setCustomAmount}
              />
              <TouchableOpacity
                style={[styles.customButton, { backgroundColor: palette.accent }, !isCustomAmountValid && styles.customButtonDisabled]}
                disabled={!isCustomAmountValid || !!busyLabel}
                onPress={() => buy(undefined, customAmountCents)}
              >
                <Text style={styles.customButtonText}>Add</Text>
              </TouchableOpacity>
            </View>
            {customAmount.length > 0 && !isCustomAmountValid && (
              <Text style={styles.customAmountHint}>Minimum top-up is ${(CUSTOM_AMOUNT_MIN_CENTS / 100).toFixed(2)}.</Text>
            )}
          </>
        )}
      </ScrollView>
    </GalaxyBackground>
  );
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    container: { padding: spacing.lg, gap: spacing.lg },
    title: { ...typography.h1, color: palette.textPrimary },
    balanceCard: { backgroundColor: palette.bgCard, borderRadius: radii.lg, padding: spacing.xl, alignItems: "center", borderWidth: 1, borderColor: palette.border },
    balanceLabel: { ...typography.caption, color: palette.textMuted },
    balanceValue: { ...typography.h1, marginTop: 4 },
    webOnlyCard: { backgroundColor: palette.bgCard, borderRadius: radii.lg, borderWidth: 1, borderColor: palette.border, padding: spacing.lg, gap: spacing.xs },
    webOnlyTitle: { ...typography.bodyBold, color: palette.textPrimary },
    webOnlyText: { ...typography.caption, color: palette.textSecondary, lineHeight: 18 },
    webOnlyDomain: { color: palette.accentBright, fontWeight: "700" },
    packGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
    packCard: { flexGrow: 1, minWidth: "45%", backgroundColor: palette.bgCard, borderRadius: radii.md, borderWidth: 1, borderColor: palette.border, padding: spacing.lg, alignItems: "center" },
    packLabel: { ...typography.h2, color: palette.textPrimary },
    packBonus: { ...typography.caption, color: palette.success, marginTop: 2 },
    sectionLabel: { ...typography.bodyBold, color: palette.textSecondary },
    customRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    dollarSign: { ...typography.h2, color: palette.textSecondary },
    customInput: { flex: 1, backgroundColor: palette.bgCard, borderRadius: radii.md, borderWidth: 1, borderColor: palette.border, padding: spacing.md, color: palette.textPrimary },
    customButton: { backgroundColor: palette.accent, borderRadius: radii.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
    customButtonDisabled: { opacity: 0.4 },
    customButtonText: { color: "#fff", fontWeight: "700" },
    customAmountHint: { ...typography.caption, color: palette.danger },
    autoRechargeCard: { backgroundColor: palette.bgCard, borderRadius: radii.lg, borderWidth: 1, borderColor: palette.border, padding: spacing.lg, gap: spacing.md },
    autoRechargeHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md },
    flex1: { flex: 1, gap: 2 },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
    chip: { borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
    chipText: { ...typography.caption, fontWeight: "700" },
  });
}
