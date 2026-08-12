import React, { useState } from "react";
import { View, StyleSheet, Text, FlatList, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Colors, Spacing, Typography, BorderRadius } from "@/constants/theme";
import { Badge, EmptyState } from "@/components/ui";
import { RootStackParamList } from "@/navigation/types";
import { REPORT_REASON_LABELS } from "@shared/validation";

type Nav = NativeStackNavigationProp<RootStackParamList, "OwnerPanel">;

const STATUS_TABS = ["pending", "reviewed", "actioned", "dismissed"];
const STATUS_COLORS: Record<string, string> = { pending: Colors.warning, reviewed: Colors.secondary, actioned: Colors.success, dismissed: Colors.textMuted };

interface OwnerReport {
  id: string;
  source: "user" | "ai_moderation";
  reason: string;
  description: string;
  status: string;
  createdAt: string;
  reporter: { username: string; email: string | null; phoneNumber: string | null } | null;
  reportedUser: { username: string } | null;
  listing: { title: string } | null;
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
                {item.source === "ai_moderation" ? (
                  <View style={styles.aiChip}>
                    <Feather name="cpu" size={10} color={Colors.white} />
                  </View>
                ) : null}
              </View>
              <Text style={styles.date}>{new Date(item.createdAt).toLocaleDateString()}</Text>
            </View>
            <Text style={styles.reporterName}>{item.reporter ? `From @${item.reporter.username}` : "Detected by AI Moderation"}</Text>
            {item.listing ? <Text style={styles.listingTitle}>Re: {item.listing.title}</Text> : null}
            {item.reportedUser ? <Text style={styles.listingTitle}>Re: @{item.reportedUser.username}</Text> : null}
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
