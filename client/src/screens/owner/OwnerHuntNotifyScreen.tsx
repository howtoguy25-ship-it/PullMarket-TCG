import React, { useMemo, useState } from "react";
import { View, StyleSheet, Text, TextInput, FlatList, Pressable, Platform, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Colors, Spacing, Typography, BorderRadius, Fonts } from "@/constants/theme";
import { Button, EmptyState } from "@/components/ui";
import { apiJson, ApiError } from "@/lib/api";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

interface Candidate {
  id: string;
  username: string;
  hasPaidBefore: boolean;
}

export default function OwnerHuntNotifyScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const { data: candidates, isLoading } = useQuery<Candidate[]>({ queryKey: [`/api/hunt/owner/notify-candidates?q=${encodeURIComponent(query)}`] });

  const allVisibleSelected = (candidates ?? []).length > 0 && (candidates ?? []).every((c) => selected.has(c.id));
  const toggleSelectAll = () => {
    setSelected((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        for (const c of candidates ?? []) next.delete(c.id);
        return next;
      }
      const next = new Set(prev);
      for (const c of candidates ?? []) next.add(c.id);
      return next;
    });
  };
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const sendMutation = useMutation({
    mutationFn: () => apiJson<{ sentTo: number }>("POST", "/api/hunt/owner/notify", { userIds: Array.from(selected), title, body }),
    onSuccess: (result) => {
      showAlert("Sent!", `Notified ${result.sentTo} selected user${result.sentTo === 1 ? "" : "s"}.`);
      setTitle("");
      setBody("");
      setSelected(new Set());
    },
    onError: (err) => showAlert("Couldn't send", err instanceof ApiError ? err.message : "Please try again."),
  });

  const selectedCount = selected.size;

  return (
    <View style={[styles.container, { paddingTop: headerHeight }]}>
      <View style={styles.searchRow}>
        <Feather name="search" size={16} color={Colors.textMuted} />
        <TextInput style={styles.searchInput} placeholder="Search usernames…" placeholderTextColor={Colors.textMuted} value={query} onChangeText={setQuery} />
      </View>

      <Pressable style={styles.selectAllRow} onPress={toggleSelectAll}>
        <Feather name={allVisibleSelected ? "check-square" : "square"} size={18} color={Colors.primary} />
        <Text style={styles.selectAllText}>{allVisibleSelected ? "Deselect all" : "Select all"}</Text>
        <Text style={styles.selectedCount}>{selectedCount} selected</Text>
      </Pressable>

      <FlatList
        data={candidates ?? []}
        keyExtractor={(item) => item.id}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md }}
        renderItem={({ item }) => {
          const isSelected = selected.has(item.id);
          return (
            <Pressable style={[styles.userRow, isSelected && styles.userRowSelected]} onPress={() => toggleOne(item.id)}>
              <Feather name={isSelected ? "check-square" : "square"} size={18} color={isSelected ? Colors.primary : Colors.textMuted} />
              <Text style={styles.username} numberOfLines={1}>
                @{item.username}
              </Text>
              {!item.hasPaidBefore ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>Hasn't paid for a tournament</Text>
                </View>
              ) : null}
            </Pressable>
          );
        }}
        ListEmptyComponent={!isLoading ? <EmptyState icon={<Feather name="users" size={36} color={Colors.textMuted} />} title="No users found" /> : null}
      />

      <View style={[styles.composer, { paddingBottom: insets.bottom + Spacing.md }]}>
        <Text style={styles.composerHeading}>Compose notification</Text>

        <View style={styles.fieldGroup}>
          <View style={styles.fieldLabelRow}>
            <Text style={styles.fieldLabel}>Notification title</Text>
            <Text style={styles.fieldCounter}>{title.length}/80</Text>
          </View>
          <TextInput style={styles.composeTitleInput} placeholder="e.g. You won Card Hunt!" placeholderTextColor={Colors.textMuted} value={title} onChangeText={setTitle} maxLength={80} />
        </View>

        <View style={styles.fieldGroup}>
          <View style={styles.fieldLabelRow}>
            <Text style={styles.fieldLabel}>Message</Text>
            <Text style={styles.fieldCounter}>{body.length}/300</Text>
          </View>
          <TextInput style={styles.composeBodyInput} placeholder="Write what you want these users to see…" placeholderTextColor={Colors.textMuted} value={body} onChangeText={setBody} multiline maxLength={300} />
        </View>

        <Button
          title={sendMutation.isPending ? "Sending…" : `Notify ${selectedCount || ""} selected`}
          onPress={() => sendMutation.mutate()}
          loading={sendMutation.isPending}
          disabled={selectedCount === 0 || !title.trim() || !body.trim()}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  searchRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, margin: Spacing.lg, marginBottom: Spacing.sm, backgroundColor: Colors.surfaceAlt, borderRadius: BorderRadius.pill, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: Spacing.md, paddingVertical: 10 },
  searchInput: { flex: 1, color: Colors.text, fontSize: 15 },
  selectAllRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm },
  selectAllText: { ...Typography.small, color: Colors.primary, fontWeight: "700", flex: 1 },
  selectedCount: { ...Typography.small, color: Colors.textMuted },
  userRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, paddingVertical: 12, paddingHorizontal: Spacing.md, backgroundColor: Colors.surface, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, marginBottom: Spacing.xs },
  userRowSelected: { borderColor: Colors.primary, backgroundColor: `${Colors.primary}0D` },
  username: { ...Typography.body, color: Colors.text, flexShrink: 1 },
  badge: { marginLeft: "auto", backgroundColor: "rgba(255,159,10,0.15)", borderRadius: BorderRadius.pill, paddingVertical: 3, paddingHorizontal: 8 },
  badgeText: { fontSize: 10, fontWeight: "700", color: "#B8630A" },
  composer: { borderTopWidth: 1, borderTopColor: Colors.border, padding: Spacing.lg, gap: Spacing.sm, backgroundColor: Colors.surface },
  composerHeading: { fontSize: 19, fontFamily: Fonts.displayBold, color: Colors.text, marginBottom: 2 },
  fieldGroup: { gap: 6 },
  fieldLabelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  fieldLabel: { fontSize: 14, fontFamily: Fonts.bodyBold, color: Colors.text },
  fieldCounter: { ...Typography.small, color: Colors.textMuted, fontSize: 11 },
  composeTitleInput: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: BorderRadius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: 14,
    color: Colors.text,
    fontSize: 18,
    fontFamily: Fonts.bodyBold,
  },
  composeBodyInput: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: BorderRadius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    color: Colors.text,
    fontSize: 16,
    fontFamily: Fonts.body,
    minHeight: 80,
    textAlignVertical: "top",
    lineHeight: 22,
  },
});
