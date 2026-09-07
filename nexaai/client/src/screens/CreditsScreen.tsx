import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { GalaxyBackground } from "../components/GalaxyBackground";
import { colors, radii, spacing, typography } from "../theme/colors";
import { useTheme } from "../lib/ThemeContext";
import { api, ApiError } from "../lib/api";

interface CreditPack {
  label: string;
  priceCents: number;
  bonusCents: number;
}

export function CreditsScreen() {
  const { palette } = useTheme();
  const [balanceCents, setBalanceCents] = useState<number | null>(null);
  const [packs, setPacks] = useState<CreditPack[]>([]);
  const [customAmount, setCustomAmount] = useState("");
  const [busyLabel, setBusyLabel] = useState<string | null>(null);

  const load = () => api<{ balanceCents: number; packs: CreditPack[] }>("/api/credits").then((r) => {
    setBalanceCents(r.balanceCents);
    setPacks(r.packs);
  });

  useEffect(() => {
    load();
  }, []);

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
          ? "Credit top-ups aren't live yet — the app owner needs to connect a Paddle account (see README)."
          : "Couldn't start checkout. Try again.";
      Alert.alert("Add credits", message);
    } finally {
      setBusyLabel(null);
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

        {Platform.OS === "ios" && (
          <Text style={styles.iosNote}>
            Buying credits opens NexaAi's website to complete payment (Apple requires digital in-app purchases to either use
            StoreKit or, for external links like this, the App Store's External Purchase Link entitlement — see the README).
          </Text>
        )}

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

        <Text style={styles.sectionLabel}>Or enter a custom amount</Text>
        <View style={styles.customRow}>
          <Text style={styles.dollarSign}>$</Text>
          <TextInput
            style={styles.customInput}
            keyboardType="decimal-pad"
            placeholder="50"
            placeholderTextColor={colors.textMuted}
            value={customAmount}
            onChangeText={setCustomAmount}
          />
          <TouchableOpacity
            style={[styles.customButton, { backgroundColor: palette.accent }]}
            disabled={!customAmount || !!busyLabel}
            onPress={() => buy(undefined, Math.round(parseFloat(customAmount) * 100))}
          >
            <Text style={styles.customButtonText}>Add</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </GalaxyBackground>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.lg },
  title: { ...typography.h1, color: colors.textPrimary },
  balanceCard: { backgroundColor: colors.bgCard, borderRadius: radii.lg, padding: spacing.xl, alignItems: "center", borderWidth: 1, borderColor: colors.border },
  balanceLabel: { ...typography.caption, color: colors.textMuted },
  balanceValue: { ...typography.h1, marginTop: 4 },
  iosNote: { ...typography.caption, color: colors.textMuted, fontStyle: "italic" },
  packGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  packCard: { flexGrow: 1, minWidth: "45%", backgroundColor: colors.bgCard, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, alignItems: "center" },
  packLabel: { ...typography.h2, color: colors.textPrimary },
  packBonus: { ...typography.caption, color: colors.success, marginTop: 2 },
  sectionLabel: { ...typography.bodyBold, color: colors.textSecondary },
  customRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  dollarSign: { ...typography.h2, color: colors.textSecondary },
  customInput: { flex: 1, backgroundColor: colors.bgCard, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, color: colors.textPrimary },
  customButton: { backgroundColor: colors.accent, borderRadius: radii.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  customButtonText: { color: "#fff", fontWeight: "700" },
});
