import React, { useState } from "react";
import { View, StyleSheet, Text, TextInput, Pressable, Platform, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRoute, RouteProp, useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMutation } from "@tanstack/react-query";
import { Colors, Spacing, Typography, BorderRadius } from "@/constants/theme";
import { Button } from "@/components/ui";
import { RootStackParamList } from "@/navigation/types";
import { apiJson, ApiError } from "@/lib/api";
import { REPORT_REASON_LABELS, CHAT_REPORT_REASONS, LISTING_REPORT_REASONS } from "@shared/validation";

type Nav = NativeStackNavigationProp<RootStackParamList, "Report">;
type Rt = RouteProp<RootStackParamList, "Report">;

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

export default function ReportScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const { listingId, orderId, conversationId, reportedUserId, reportedUsername } = route.params ?? {};
  const isChatReport = !!conversationId || !!reportedUserId;
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState("scam");
  const [description, setDescription] = useState("");

  const reasons = (isChatReport ? CHAT_REPORT_REASONS : LISTING_REPORT_REASONS).map((key) => [key, REPORT_REASON_LABELS[key]] as const);

  const submitMutation = useMutation({
    mutationFn: () => apiJson("POST", "/api/reports", { listingId, orderId, conversationId, reportedUserId, reason, description }),
    onSuccess: () => {
      showAlert("Report submitted", "Thanks — our team will review this and follow up if needed.");
      navigation.goBack();
    },
    onError: (err) => showAlert("Couldn't submit report", err instanceof ApiError ? err.message : "Please try again."),
  });

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + Spacing.xl }]}>
      {isChatReport ? (
        <>
          <Text style={styles.header}>{`Report ${reportedUsername ? `@${reportedUsername}` : "this user"}`}</Text>
          <Text style={styles.subtitle}>Our team will review this conversation and decide whether action is needed.</Text>
        </>
      ) : null}
      <Text style={styles.title}>{isChatReport ? "Reason" : "What's wrong?"}</Text>
      <View style={styles.reasonRow}>
        {reasons.map(([key, label]) => (
          <Pressable key={key} onPress={() => setReason(key)} style={[styles.reasonChip, reason === key && styles.reasonChipActive]}>
            <Text style={[styles.reasonChipText, reason === key && { color: Colors.white }]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.title}>Details</Text>
      <TextInput
        style={styles.textArea}
        placeholder="Tell us what happened…"
        placeholderTextColor={Colors.textMuted}
        value={description}
        onChangeText={setDescription}
        multiline
        numberOfLines={6}
      />

      <Button title="Submit report" onPress={() => submitMutation.mutate()} loading={submitMutation.isPending} disabled={description.trim().length < 5} style={{ marginTop: Spacing.lg }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, padding: Spacing.lg },
  header: { ...Typography.h3, color: Colors.text, marginTop: Spacing.sm },
  subtitle: { ...Typography.small, color: Colors.textSecondary, marginTop: 4, marginBottom: Spacing.sm },
  title: { ...Typography.bodyBold, color: Colors.text, marginBottom: Spacing.sm, marginTop: Spacing.md },
  reasonRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  reasonChip: { paddingHorizontal: Spacing.md, paddingVertical: 8, borderRadius: BorderRadius.pill, borderWidth: 1, borderColor: Colors.border },
  reasonChipActive: { backgroundColor: Colors.danger, borderColor: Colors.danger },
  reasonChipText: { ...Typography.small, color: Colors.text, fontWeight: "600" },
  textArea: { borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md, padding: Spacing.md, backgroundColor: Colors.surface, minHeight: 120, textAlignVertical: "top", color: Colors.text },
});
