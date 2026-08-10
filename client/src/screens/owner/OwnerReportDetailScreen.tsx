import React, { useState } from "react";
import { View, StyleSheet, Text, ScrollView, TextInput, Image, Platform, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useRoute, RouteProp } from "@react-navigation/native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Colors, Spacing, Typography, BorderRadius } from "@/constants/theme";
import { Button, Badge } from "@/components/ui";
import { RootStackParamList } from "@/navigation/types";
import { apiJson, ApiError } from "@/lib/api";
import { REPORT_REASON_LABELS } from "@shared/validation";

type Rt = RouteProp<RootStackParamList, "OwnerReportDetail">;

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

interface OwnerReportDetail {
  id: string;
  reason: string;
  description: string;
  status: string;
  createdAt: string;
  reporter: { username: string; email: string | null; phoneNumber: string | null };
  listing: { title: string; images: string[] } | null;
}

export default function OwnerReportDetailScreen() {
  const route = useRoute<Rt>();
  const { reportId } = route.params;
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const queryClient = useQueryClient();
  const [reply, setReply] = useState("");

  const { data: report, isLoading } = useQuery<OwnerReportDetail>({ queryKey: [`/api/owner/reports/${reportId}`] });

  const replyMutation = useMutation({
    mutationFn: () => apiJson("POST", `/api/owner/reports/${reportId}/reply`, { message: reply }),
    onSuccess: () => {
      showAlert("Sent", "Your reply was emailed to the customer.");
      setReply("");
      queryClient.invalidateQueries({ queryKey: [`/api/owner/reports/${reportId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/owner/reports"] });
    },
    onError: (err) => showAlert("Couldn't send reply", err instanceof ApiError ? err.message : "Please try again."),
  });

  if (isLoading || !report) {
    return (
      <View style={[styles.container, { paddingTop: headerHeight }]}>
        <Text style={styles.loading}>Loading…</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: Spacing.lg, paddingTop: headerHeight + Spacing.md, paddingBottom: insets.bottom + Spacing.xl }}>
      <Text style={styles.header}>Incident Report</Text>
      <Badge label={REPORT_REASON_LABELS[report.reason] ?? report.reason} color={Colors.danger} />

      <View style={styles.customerCard}>
        <Text style={styles.label}>Customer</Text>
        <Text style={styles.value}>@{report.reporter.username}</Text>
        {report.reporter.email ? <Text style={styles.valueSecondary}>{report.reporter.email}</Text> : null}
        {report.reporter.phoneNumber ? <Text style={styles.valueSecondary}>{report.reporter.phoneNumber}</Text> : null}
      </View>

      {report.listing ? (
        <View style={styles.customerCard}>
          <Text style={styles.label}>Reported listing</Text>
          <Text style={styles.value}>{report.listing.title}</Text>
          {report.listing.images.length ? (
            <ScrollView horizontal style={{ marginTop: Spacing.sm }}>
              {report.listing.images.map((img, i) => (
                <Image key={i} source={{ uri: img }} style={styles.listingImage} />
              ))}
            </ScrollView>
          ) : null}
        </View>
      ) : null}

      <Text style={styles.label}>Description</Text>
      <Text style={styles.description}>{report.description}</Text>

      <Text style={styles.sectionTitle}>Reply to customer</Text>
      <Text style={styles.helper}>Sent by email to the address on their account.</Text>
      <TextInput style={styles.textArea} placeholder="Type your reply…" placeholderTextColor={Colors.textMuted} value={reply} onChangeText={setReply} multiline numberOfLines={5} />
      <Button title="Send" onPress={() => replyMutation.mutate()} loading={replyMutation.isPending} disabled={reply.trim().length === 0} style={{ marginTop: Spacing.md }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loading: { textAlign: "center", marginTop: Spacing.xl, color: Colors.textSecondary },
  header: { ...Typography.h3, color: Colors.text, marginBottom: Spacing.sm },
  customerCard: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginTop: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  label: { ...Typography.small, color: Colors.textSecondary, fontWeight: "700", marginTop: Spacing.md },
  value: { ...Typography.bodyBold, color: Colors.text },
  valueSecondary: { ...Typography.small, color: Colors.textSecondary },
  listingImage: { width: 70, height: 90, borderRadius: BorderRadius.sm, marginRight: Spacing.sm, backgroundColor: Colors.surfaceAlt },
  description: { ...Typography.body, color: Colors.text, marginTop: 4 },
  sectionTitle: { ...Typography.bodyBold, color: Colors.text, marginTop: Spacing.xl },
  helper: { ...Typography.small, color: Colors.textSecondary, marginBottom: Spacing.sm },
  textArea: { borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md, padding: Spacing.md, backgroundColor: Colors.surface, minHeight: 110, textAlignVertical: "top", color: Colors.text },
});
