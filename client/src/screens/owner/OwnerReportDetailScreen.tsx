import React, { useState } from "react";
import { View, StyleSheet, Text, ScrollView, TextInput, Image, Platform, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useRoute, RouteProp } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Colors, Spacing, Typography, BorderRadius, Fonts } from "@/constants/theme";
import { Button, Badge } from "@/components/ui";
import { RootStackParamList } from "@/navigation/types";
import { apiJson, ApiError } from "@/lib/api";
import { resolveImageUrl } from "@/lib/media";
import { REPORT_REASON_LABELS } from "@shared/validation";

type Rt = RouteProp<RootStackParamList, "OwnerReportDetail">;

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

function confirmAsync(title: string, message: string, confirmLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (Platform.OS === "web") {
      resolve(window.confirm(`${title}\n${message}`));
    } else {
      Alert.alert(title, message, [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: confirmLabel, style: "destructive", onPress: () => resolve(true) },
      ]);
    }
  });
}

interface ReportUser {
  id: string;
  username: string;
  email: string | null;
  phoneNumber: string | null;
}

interface ThreadMessage {
  senderId: string;
  text: string | null;
  createdAt: string | null;
}

interface OwnerReportDetail {
  id: string;
  source: "user" | "ai_moderation" | "system";
  reason: string;
  description: string;
  aiReasoning: string | null;
  status: string;
  createdAt: string;
  reporter: ReportUser | null;
  reportedUser: ReportUser | null;
  listing: { title: string; images: string[] } | null;
  order: { id: string; status: string; totalCents: number; trackingNumber: string | null } | null;
  flaggedMessage: { text: string | null } | null;
  recentMessages: ThreadMessage[];
}

const SOURCE_LABELS: Record<string, string> = { ai_moderation: "AI-flagged", system: "Auto-flagged" };

const STATUS_COLORS: Record<string, string> = { pending: Colors.warning, reviewed: Colors.secondary, actioned: Colors.success, dismissed: Colors.textMuted };

export default function OwnerReportDetailScreen() {
  const route = useRoute<Rt>();
  const { reportId } = route.params;
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const queryClient = useQueryClient();
  const [reply, setReply] = useState("");

  const { data: report, isLoading } = useQuery<OwnerReportDetail>({ queryKey: [`/api/owner/reports/${reportId}`] });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/owner/reports/${reportId}`] });
    queryClient.invalidateQueries({ queryKey: ["/api/owner/reports"] });
  };

  const replyMutation = useMutation({
    mutationFn: () => apiJson("POST", `/api/owner/reports/${reportId}/reply`, { message: reply }),
    onSuccess: () => {
      showAlert("Sent", "Your reply was emailed to the customer.");
      setReply("");
      invalidate();
    },
    onError: (err) => showAlert("Couldn't send reply", err instanceof ApiError ? err.message : "Please try again."),
  });

  const approveMutation = useMutation({
    mutationFn: () => apiJson("POST", `/api/owner/reports/${reportId}/approve`),
    onSuccess: () => {
      showAlert(
        "Report approved",
        report?.listing ? "The listing has been removed." : report?.reportedUser ? "The user has been suspended." : "Marked as actioned.",
      );
      invalidate();
    },
    onError: (err) => showAlert("Couldn't approve report", err instanceof ApiError ? err.message : "Please try again."),
  });

  const declineMutation = useMutation({
    mutationFn: () => apiJson("POST", `/api/owner/reports/${reportId}/decline`),
    onSuccess: () => {
      showAlert("Report declined", "No action was taken.");
      invalidate();
    },
    onError: (err) => showAlert("Couldn't decline report", err instanceof ApiError ? err.message : "Please try again."),
  });

  const handleApprove = async () => {
    const consequence = report?.listing ? "This will remove the listing from the marketplace." : report?.reportedUser ? "This will suspend the reported user's account." : "This will mark the report as actioned.";
    if (await confirmAsync("Approve this report?", consequence, "Approve")) approveMutation.mutate();
  };

  const handleDecline = async () => {
    if (await confirmAsync("Decline this report?", "No action will be taken and the report will be closed.", "Decline")) declineMutation.mutate();
  };

  if (isLoading || !report) {
    return (
      <View style={[styles.container, { paddingTop: headerHeight }]}>
        <Text style={styles.loading}>Loading…</Text>
      </View>
    );
  }

  const isResolved = report.status === "actioned" || report.status === "dismissed";
  const isPending = approveMutation.isPending || declineMutation.isPending;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: Spacing.lg, paddingTop: headerHeight + Spacing.md, paddingBottom: insets.bottom + Spacing.xl }}>
      <View style={styles.headerRow}>
        <Text style={styles.header}>Incident Report</Text>
        <Badge label={report.status[0].toUpperCase() + report.status.slice(1)} color={STATUS_COLORS[report.status] ?? Colors.textMuted} />
      </View>
      <View style={styles.badgeRow}>
        <Badge label={REPORT_REASON_LABELS[report.reason] ?? report.reason} color={Colors.danger} />
        {SOURCE_LABELS[report.source] ? (
          <View style={styles.aiBadge}>
            <Feather name={report.source === "system" ? "clock" : "cpu"} size={12} color={Colors.white} />
            <Text style={styles.aiBadgeText}>{SOURCE_LABELS[report.source]}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.customerCard}>
        <Text style={styles.label}>{report.source === "ai_moderation" ? "Detected by" : report.source === "system" ? "Filed by" : "Reported by"}</Text>
        {report.reporter ? (
          <>
            <Text style={styles.value}>@{report.reporter.username}</Text>
            {report.reporter.email ? <Text style={styles.valueSecondary}>{report.reporter.email}</Text> : null}
            {report.reporter.phoneNumber ? <Text style={styles.valueSecondary}>{report.reporter.phoneNumber}</Text> : null}
          </>
        ) : (
          <Text style={styles.value}>{report.source === "system" ? "Shipping-deadline sweep" : "PullMarket AI Moderation"}</Text>
        )}
      </View>

      {report.reportedUser ? (
        <View style={styles.customerCard}>
          <Text style={styles.label}>Reported user</Text>
          <Text style={styles.value}>@{report.reportedUser.username}</Text>
        </View>
      ) : null}

      {report.order ? (
        <View style={styles.customerCard}>
          <Text style={styles.label}>Order</Text>
          <Text style={styles.value}>
            #{report.order.id.slice(0, 8)} · ${(report.order.totalCents / 100).toFixed(2)} · {report.order.status}
          </Text>
          {report.order.trackingNumber ? <Text style={styles.valueSecondary}>Tracking: {report.order.trackingNumber}</Text> : <Text style={styles.valueSecondary}>No tracking number entered</Text>}
        </View>
      ) : null}

      {report.listing ? (
        <View style={styles.customerCard}>
          <Text style={styles.label}>Reported listing</Text>
          <Text style={styles.value}>{report.listing.title}</Text>
          {report.listing.images.length ? (
            <ScrollView horizontal style={{ marginTop: Spacing.sm }}>
              {report.listing.images.map((img, i) => (
                <Image key={i} source={{ uri: resolveImageUrl(img) }} style={styles.listingImage} />
              ))}
            </ScrollView>
          ) : null}
        </View>
      ) : null}

      <Text style={styles.label}>Description</Text>
      <Text style={styles.description}>{report.description}</Text>

      {report.aiReasoning ? (
        <>
          <Text style={styles.label}>AI reasoning</Text>
          <Text style={styles.description}>{report.aiReasoning}</Text>
        </>
      ) : null}

      {report.recentMessages.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>Conversation context</Text>
          <View style={styles.threadCard}>
            {report.recentMessages.map((m, i) => (
              <Text key={i} style={styles.threadLine}>
                <Text style={styles.threadSender}>{m.senderId === report.reportedUser?.id ? "🚩 " : ""}</Text>
                {m.text || "(media)"}
              </Text>
            ))}
          </View>
        </>
      ) : null}

      {!isResolved ? (
        <View style={styles.actionRow}>
          <Button title="Decline" variant="outline" onPress={handleDecline} loading={declineMutation.isPending} disabled={isPending} style={{ flex: 1 }} />
          <Button title="Approve" onPress={handleApprove} loading={approveMutation.isPending} disabled={isPending} style={{ flex: 1 }} />
        </View>
      ) : (
        <View style={styles.resolvedBanner}>
          <Feather name={report.status === "actioned" ? "check-circle" : "x-circle"} size={16} color={STATUS_COLORS[report.status]} />
          <Text style={styles.resolvedText}>{report.status === "actioned" ? "Approved — action was taken." : "Declined — no action was taken."}</Text>
        </View>
      )}

      {report.reporter ? (
        <>
          <Text style={styles.sectionTitle}>Reply to customer</Text>
          <Text style={styles.helper}>Sent by email to the address on their account.</Text>
          <TextInput style={styles.textArea} placeholder="Type your reply…" placeholderTextColor={Colors.textMuted} value={reply} onChangeText={setReply} multiline numberOfLines={5} />
          <Button title="Send" onPress={() => replyMutation.mutate()} loading={replyMutation.isPending} disabled={reply.trim().length === 0} style={{ marginTop: Spacing.md }} />
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loading: { textAlign: "center", marginTop: Spacing.xl, color: Colors.textSecondary },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  header: { ...Typography.h3, color: Colors.text },
  badgeRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, marginTop: Spacing.sm },
  aiBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: Colors.secondary, borderRadius: BorderRadius.pill, paddingHorizontal: Spacing.sm, paddingVertical: 4 },
  aiBadgeText: { fontFamily: Fonts.bodyBold, fontSize: 11, color: Colors.white },
  customerCard: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginTop: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  label: { ...Typography.small, color: Colors.textSecondary, fontWeight: "700", marginTop: Spacing.md },
  value: { ...Typography.bodyBold, color: Colors.text },
  valueSecondary: { ...Typography.small, color: Colors.textSecondary },
  listingImage: { width: 70, height: 90, borderRadius: BorderRadius.sm, marginRight: Spacing.sm, backgroundColor: Colors.surfaceAlt },
  description: { ...Typography.body, color: Colors.text, marginTop: 4 },
  sectionTitle: { ...Typography.bodyBold, color: Colors.text, marginTop: Spacing.xl },
  helper: { ...Typography.small, color: Colors.textSecondary, marginBottom: Spacing.sm },
  textArea: { borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md, padding: Spacing.md, backgroundColor: Colors.surface, minHeight: 110, textAlignVertical: "top", color: Colors.text },
  threadCard: { backgroundColor: Colors.surfaceAlt, borderRadius: BorderRadius.md, padding: Spacing.md, marginTop: Spacing.sm, gap: 6 },
  threadLine: { ...Typography.small, color: Colors.text },
  threadSender: { color: Colors.danger },
  actionRow: { flexDirection: "row", gap: Spacing.sm, marginTop: Spacing.xl },
  resolvedBanner: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, marginTop: Spacing.xl, backgroundColor: Colors.surfaceAlt, borderRadius: BorderRadius.md, padding: Spacing.md },
  resolvedText: { ...Typography.small, color: Colors.textSecondary, fontWeight: "600" },
});
