import React, { useState } from "react";
import { View, StyleSheet, Text, FlatList, Pressable, Switch, Platform, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Colors, Spacing, Typography, BorderRadius, Shadow } from "@/constants/theme";
import { Badge, EmptyState } from "@/components/ui";
import { apiJson, describeApiError } from "@/lib/api";
import { RootStackParamList } from "@/navigation/types";
import { REPORT_REASON_LABELS } from "@shared/validation";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

type Nav = NativeStackNavigationProp<RootStackParamList, "OwnerPanel">;

const STATUS_TABS = ["pending", "reviewed", "actioned", "dismissed"];
const STATUS_COLORS: Record<string, string> = { pending: Colors.warning, reviewed: Colors.secondary, actioned: Colors.success, dismissed: Colors.textMuted };

interface OwnerReport {
  id: string;
  source: "user" | "ai_moderation" | "system";
  reason: string;
  description: string;
  status: string;
  createdAt: string;
  reporter: { username: string; email: string | null; phoneNumber: string | null } | null;
  reportedUser: { username: string } | null;
  listing: { title: string } | null;
  order: { id: string; totalCents: number } | null;
}

const SOURCE_META: Record<string, { label: string; icon: React.ComponentProps<typeof Feather>["name"]; color: string }> = {
  ai_moderation: { label: "AI", icon: "cpu", color: Colors.secondary },
  system: { label: "Auto", icon: "clock", color: Colors.warning },
};

interface OwnerSettings {
  reviewBypassEnabled: boolean;
}

function ReviewBypassToggle() {
  const queryClient = useQueryClient();
  const { data: settings } = useQuery<OwnerSettings>({ queryKey: ["/api/owner/settings"] });

  const toggleMutation = useMutation({
    mutationFn: (enabled: boolean) => apiJson<OwnerSettings>("POST", "/api/owner/settings/review-bypass", { enabled }),
    onSuccess: (data) => queryClient.setQueryData(["/api/owner/settings"], data),
    onError: (err) => showAlert("Couldn't update setting", describeApiError(err)),
  });

  const enabled = settings?.reviewBypassEnabled ?? true;

  return (
    <View style={[styles.toggleCard, Shadow.card]}>
      <View style={styles.toggleIcon}>
        <Feather name="key" size={16} color={enabled ? Colors.success : Colors.textMuted} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.toggleTitle}>App Review sign-in bypass</Text>
        <Text style={styles.toggleSubtitle}>
          {enabled
            ? "On — the fixed test phone number (+1 555 555 0199) can sign in. Turn off once Apple's review is done."
            : "Off — that test number no longer works for anyone."}
        </Text>
      </View>
      <Switch
        value={enabled}
        onValueChange={(v) => toggleMutation.mutate(v)}
        disabled={toggleMutation.isPending || settings === undefined}
        trackColor={{ false: Colors.border, true: Colors.success }}
        thumbColor={Colors.white}
        testID="review-bypass-toggle"
      />
    </View>
  );
}

export default function OwnerPanelScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const [status, setStatus] = useState("pending");

  const { data: reports, isLoading } = useQuery<OwnerReport[]>({ queryKey: [`/api/owner/reports?status=${status}`] });

  return (
    <View style={[styles.container, { paddingTop: headerHeight }]}>
      <Pressable style={styles.usersLink} onPress={() => navigation.navigate("OwnerUsers")}>
        <Feather name="users" size={16} color={Colors.primary} />
        <Text style={styles.usersLinkText}>View all users</Text>
        <Feather name="chevron-right" size={16} color={Colors.textMuted} />
      </Pressable>

      <Pressable style={styles.usersLink} onPress={() => navigation.navigate("OwnerHunt")}>
        <Feather name="compass" size={16} color={Colors.gold} />
        <Text style={styles.usersLinkText}>Card Hunt control</Text>
        <Feather name="chevron-right" size={16} color={Colors.textMuted} />
      </Pressable>

      <ReviewBypassToggle />

      <View style={styles.tabs}>
        {STATUS_TABS.map((tab) => (
          <Pressable key={tab} onPress={() => setStatus(tab)} style={[styles.tab, status === tab && { backgroundColor: Colors.primary, borderColor: Colors.primary }]}>
            <Text style={[styles.tabText, status === tab && { color: Colors.white }]}>{tab[0].toUpperCase() + tab.slice(1)}</Text>
          </Pressable>
        ))}
      </View>

      <FlatList
        data={reports ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: Spacing.lg, paddingBottom: insets.bottom + Spacing.xl }}
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => navigation.navigate("OwnerReportDetail", { reportId: item.id })}>
            <View style={styles.cardHeader}>
              <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                <Badge label={REPORT_REASON_LABELS[item.reason] ?? item.reason} color={STATUS_COLORS[item.status]} />
                {SOURCE_META[item.source] ? (
                  <View style={[styles.aiChip, { backgroundColor: SOURCE_META[item.source].color }]}>
                    <Feather name={SOURCE_META[item.source].icon} size={10} color={Colors.white} />
                  </View>
                ) : null}
              </View>
              <Text style={styles.date}>{new Date(item.createdAt).toLocaleDateString()}</Text>
            </View>
            <Text style={styles.reporterName}>
              {item.reporter ? `From @${item.reporter.username}` : item.source === "system" ? "Auto-filed by the shipping-deadline sweep" : "Detected by AI Moderation"}
            </Text>
            {item.listing ? <Text style={styles.listingTitle}>Re: {item.listing.title}</Text> : null}
            {item.reportedUser ? <Text style={styles.listingTitle}>Re: @{item.reportedUser.username}</Text> : null}
            {item.order ? <Text style={styles.listingTitle}>Order #{item.order.id.slice(0, 8)} · ${(item.order.totalCents / 100).toFixed(2)}</Text> : null}
            <Text style={styles.description} numberOfLines={2}>
              {item.description}
            </Text>
          </Pressable>
        )}
        ListEmptyComponent={!isLoading ? <EmptyState icon={<Feather name="check-circle" size={40} color={Colors.textMuted} />} title={`No ${status} reports`} /> : null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  usersLink: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, padding: Spacing.md, marginHorizontal: Spacing.lg, marginTop: Spacing.sm, backgroundColor: Colors.surface, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border },
  usersLinkText: { flex: 1, ...Typography.bodyBold, color: Colors.text, fontSize: 14 },
  toggleCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.md,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  toggleIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: Colors.success + "1F", alignItems: "center", justifyContent: "center" },
  toggleTitle: { ...Typography.bodyBold, color: Colors.text, fontSize: 14 },
  toggleSubtitle: { ...Typography.small, color: Colors.textSecondary, marginTop: 2 },
  tabs: { flexDirection: "row", gap: Spacing.xs, paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, flexWrap: "wrap" },
  tab: { paddingHorizontal: Spacing.sm, paddingVertical: 6, borderRadius: BorderRadius.pill, borderWidth: 1, borderColor: Colors.border },
  tabText: { ...Typography.small, color: Colors.text, fontWeight: "600" },
  card: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm, borderWidth: 1, borderColor: Colors.border },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  date: { ...Typography.small, color: Colors.textMuted },
  aiChip: { backgroundColor: Colors.secondary, borderRadius: BorderRadius.pill, padding: 4 },
  reporterName: { ...Typography.bodyBold, color: Colors.text, marginTop: Spacing.sm, fontSize: 14 },
  listingTitle: { ...Typography.small, color: Colors.textSecondary },
  description: { ...Typography.small, color: Colors.textSecondary, marginTop: 4 },
});
