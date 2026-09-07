import React, { useEffect, useState } from "react";
import { Dimensions, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { GalaxyBackground } from "../components/GalaxyBackground";
import { colors, radii, spacing, typography } from "../theme/colors";
import { api } from "../lib/api";
import { useAuth } from "../lib/AuthContext";

interface PlanDefinition {
  tier: "beginner" | "pro" | "max";
  displayName: string;
  tagline: string;
  priceCentsPerMonth: number | null;
  strengthMultiplier: number;
  weeklySessionSecondsCap: number;
  dailySessionCountCap: number;
  colors: { primary: string; secondary: string; glow: string };
}

const { width } = Dimensions.get("window");
const CARD_WIDTH = width - spacing.xl * 2;

export function PlansScreen() {
  const { user, refreshUser } = useAuth();
  const [plans, setPlans] = useState<PlanDefinition[]>([]);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    api<{ plans: PlanDefinition[] }>("/api/plans").then((r) => setPlans(r.plans));
  }, []);

  const switchTo = async (tier: PlanDefinition["tier"]) => {
    // NOTE: this demo endpoint switches the tier immediately. A real launch
    // must gate Pro/Max upgrades on an actual completed payment first — see
    // server/src/routes/plans.ts's TODO.
    await api("/api/plans/switch", { method: "POST", body: JSON.stringify({ tier }) });
    await refreshUser();
  };

  if (dismissed) return null;

  return (
    <GalaxyBackground>
      <View style={styles.header}>
        <Text style={styles.title}>Plans</Text>
        <TouchableOpacity onPress={() => setDismissed(true)} style={styles.closeButton}>
          <Ionicons name="close" size={20} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
      <ScrollView
        horizontal
        pagingEnabled
        snapToInterval={CARD_WIDTH + spacing.md}
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: spacing.xl, gap: spacing.md }}
      >
        {plans.map((plan) => {
          const isCurrent = user?.planTier === plan.tier;
          return (
            <View key={plan.tier} style={[styles.card, { width: CARD_WIDTH, borderColor: plan.colors.primary, shadowColor: plan.colors.glow }]}>
              <View style={[styles.badge, { backgroundColor: plan.colors.primary }]}>
                <Text style={styles.badgeText}>{plan.strengthMultiplier}x strength</Text>
              </View>
              <Text style={styles.planName}>{plan.displayName}</Text>
              <Text style={styles.tagline}>{plan.tagline}</Text>
              <Text style={[styles.price, { color: plan.colors.primary }]}>
                {plan.priceCentsPerMonth == null ? "Free trial + credits" : `$${(plan.priceCentsPerMonth / 100).toFixed(2)}/mo`}
              </Text>
              <View style={styles.specs}>
                <Text style={styles.specLine}>• Up to {Math.round(plan.weeklySessionSecondsCap / 60)} min of sessions/week</Text>
                <Text style={styles.specLine}>• {plan.dailySessionCountCap} sessions/day</Text>
              </View>
              <TouchableOpacity
                style={[styles.selectButton, { backgroundColor: isCurrent ? colors.bgCardAlt : plan.colors.primary }]}
                onPress={() => switchTo(plan.tier)}
                disabled={isCurrent}
              >
                <Text style={styles.selectButtonText}>{isCurrent ? "Current plan" : "Choose " + plan.displayName}</Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>
    </GalaxyBackground>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.lg },
  title: { ...typography.h1, color: colors.textPrimary },
  closeButton: { width: 32, height: 32, borderRadius: radii.pill, backgroundColor: colors.bgCard, alignItems: "center", justifyContent: "center" },
  card: {
    backgroundColor: colors.bgCard,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    padding: spacing.xl,
    gap: spacing.sm,
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 6,
  },
  badge: { alignSelf: "flex-start", borderRadius: radii.pill, paddingHorizontal: spacing.md, paddingVertical: 4 },
  badgeText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  planName: { ...typography.h1, color: colors.textPrimary, marginTop: spacing.sm },
  tagline: { ...typography.body, color: colors.textSecondary },
  price: { ...typography.h2, marginTop: spacing.sm },
  specs: { marginTop: spacing.md, gap: 4 },
  specLine: { ...typography.body, color: colors.textSecondary },
  selectButton: { borderRadius: radii.md, padding: spacing.md, alignItems: "center", marginTop: spacing.lg },
  selectButtonText: { color: "#fff", fontWeight: "700" },
});
