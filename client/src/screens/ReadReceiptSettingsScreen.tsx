import React, { useEffect, useState } from "react";
import { View, StyleSheet, Text, Pressable, Switch, FlatList, Image } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { Colors, Spacing, Typography, BorderRadius } from "@/constants/theme";
import { Button, EmptyState } from "@/components/ui";
import { apiJson } from "@/lib/api";
import { resolveImageUrl } from "@/lib/media";

interface PublicUser {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

interface ReadReceiptSettings {
  enabled: boolean;
  excludedUsers: PublicUser[];
}

interface ConversationRow {
  id: string;
  otherUser: PublicUser | null;
}

export default function ReadReceiptSettingsScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const queryClient = useQueryClient();

  const { data: settings } = useQuery<ReadReceiptSettings>({ queryKey: ["/api/chat/read-receipts/settings"] });
  const { data: conversations } = useQuery<ConversationRow[]>({ queryKey: ["/api/chat/conversations"] });

  const [excludedIds, setExcludedIds] = useState<string[]>([]);

  useEffect(() => {
    if (settings) setExcludedIds(settings.excludedUsers.map((u) => u.id));
  }, [settings]);

  const toggleEnabled = useMutation({
    mutationFn: (enabled: boolean) => apiJson<{ enabled: boolean }>("PATCH", "/api/chat/read-receipts/settings", { enabled }),
    onSuccess: (result) => queryClient.setQueryData(["/api/chat/read-receipts/settings"], (prev: ReadReceiptSettings | undefined) => (prev ? { ...prev, enabled: result.enabled } : prev)),
  });

  const saveExclusions = useMutation({
    mutationFn: () => apiJson<{ excludedUserIds: string[] }>("PUT", "/api/chat/read-receipts/exclusions", { userIds: excludedIds }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/chat/read-receipts/settings"] }),
  });

  const toggleExcluded = (userId: string) => setExcludedIds((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]));

  // Only people with a real conversation are offered as candidates — no
  // point excluding a stranger who has never seen a read receipt from you.
  const contacts = (conversations ?? []).map((c) => c.otherUser).filter((u): u is PublicUser => !!u);
  const uniqueContacts = Array.from(new Map(contacts.map((u) => [u.id, u])).values());

  return (
    <View style={[styles.container, { paddingTop: headerHeight, paddingBottom: insets.bottom }]}>
      <FlatList
        data={uniqueContacts}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: Spacing.xxl }}
        ListHeaderComponent={
          <>
            <View style={styles.section}>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>Read receipts</Text>
                  <Text style={styles.rowSubtitle}>When off, nobody sees when you've read their messages — and this overrides the list below for everyone.</Text>
                </View>
                <Switch
                  value={settings?.enabled ?? true}
                  onValueChange={(v) => toggleEnabled.mutate(v)}
                  trackColor={{ true: Colors.primary, false: Colors.border }}
                />
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Hide read receipts from specific people</Text>
              <Text style={styles.sectionSubtitle}>
                Select anyone you still want to chat with normally, but don't want to know when you've seen their messages. This works even while read receipts are on for everyone else.
              </Text>
            </View>
          </>
        }
        renderItem={({ item }) => {
          const excluded = excludedIds.includes(item.id);
          return (
            <Pressable onPress={() => toggleExcluded(item.id)} style={styles.contactRow}>
              {item.avatarUrl ? (
                <Image source={{ uri: resolveImageUrl(item.avatarUrl) }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarPlaceholder]}>
                  <Feather name="user" size={18} color={Colors.textMuted} />
                </View>
              )}
              <Text style={styles.contactName}>{item.displayName || item.username}</Text>
              <View style={[styles.checkbox, excluded && styles.checkboxActive]}>{excluded ? <Feather name="check" size={14} color={Colors.white} /> : null}</View>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <EmptyState icon={<Feather name="users" size={36} color={Colors.textMuted} />} title="No conversations yet" subtitle="Once you've chatted with someone, you can choose to hide read receipts from them here." />
        }
        ListFooterComponent={
          uniqueContacts.length > 0 ? (
            <Button title={saveExclusions.isSuccess ? "Saved!" : "Save"} onPress={() => saveExclusions.mutate()} loading={saveExclusions.isPending} style={{ marginTop: Spacing.lg, marginHorizontal: Spacing.xl }} />
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  section: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.lg, paddingBottom: Spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  rowTitle: { ...Typography.bodyBold, color: Colors.text },
  rowSubtitle: { ...Typography.small, color: Colors.textSecondary, marginTop: 2 },
  sectionTitle: { ...Typography.bodyBold, color: Colors.text, marginTop: Spacing.md },
  sectionSubtitle: { ...Typography.small, color: Colors.textSecondary, marginTop: 2 },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
  },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.surfaceAlt },
  avatarPlaceholder: { alignItems: "center", justifyContent: "center" },
  contactName: { ...Typography.body, color: Colors.text, flex: 1 },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 1.5, borderColor: Colors.border, alignItems: "center", justifyContent: "center" },
  checkboxActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
});
