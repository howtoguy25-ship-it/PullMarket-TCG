import React, { useEffect, useState } from "react";
import { View, StyleSheet, Text, Pressable, Switch, ScrollView, Image } from "react-native";
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
    <ScrollView style={[styles.container, { paddingTop: headerHeight }]} contentContainerStyle={{ paddingHorizontal: Spacing.lg, paddingBottom: insets.bottom + Spacing.xxl }}>
      <Text style={styles.sectionHeader}>Read Receipts</Text>
      <View style={styles.section}>
        <View style={styles.toggleRow}>
          <View style={styles.rowIcon}>
            <Feather name={settings?.enabled ?? true ? "eye" : "eye-off"} size={16} color={Colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Read receipts</Text>
            <Text style={styles.rowSubtitle}>When off, nobody sees when you've read their messages — and this overrides the list below for everyone.</Text>
          </View>
          <Switch value={settings?.enabled ?? true} onValueChange={(v) => toggleEnabled.mutate(v)} trackColor={{ true: Colors.primary, false: Colors.border }} thumbColor={Colors.white} />
        </View>
      </View>

      <Text style={styles.sectionHeader}>Hide From Specific People</Text>
      <Text style={styles.sectionSubtitle}>
        Select anyone you still want to chat with normally, but don't want to know when you've seen their messages. This works even while read receipts are on for everyone else.
      </Text>

      {uniqueContacts.length > 0 ? (
        <View style={[styles.section, { marginTop: Spacing.md }]}>
          {uniqueContacts.map((item, i) => {
            const excluded = excludedIds.includes(item.id);
            return (
              <Pressable key={item.id} onPress={() => toggleExcluded(item.id)} style={[styles.contactRow, i > 0 && styles.contactRowDivider]}>
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
          })}
        </View>
      ) : (
        <View style={[styles.section, styles.emptyCard]}>
          <EmptyState icon={<Feather name="users" size={36} color={Colors.textMuted} />} title="No conversations yet" subtitle="Once you've chatted with someone, you can choose to hide read receipts from them here." />
        </View>
      )}

      {uniqueContacts.length > 0 ? (
        <Button title={saveExclusions.isSuccess ? "Saved!" : "Save"} onPress={() => saveExclusions.mutate()} loading={saveExclusions.isPending} style={{ marginTop: Spacing.lg }} />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  sectionHeader: { ...Typography.small, color: Colors.textSecondary, fontWeight: "700", marginTop: Spacing.lg, marginBottom: Spacing.xs, letterSpacing: 0.5 },
  sectionSubtitle: { ...Typography.small, color: Colors.textSecondary },
  section: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, overflow: "hidden" },
  emptyCard: { paddingVertical: Spacing.xl },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, padding: Spacing.md },
  rowIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: "#FCE9E4", alignItems: "center", justifyContent: "center" },
  rowTitle: { ...Typography.bodyBold, color: Colors.text },
  rowSubtitle: { ...Typography.small, color: Colors.textSecondary, marginTop: 2 },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  contactRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.surfaceAlt },
  avatarPlaceholder: { alignItems: "center", justifyContent: "center" },
  contactName: { ...Typography.body, color: Colors.text, flex: 1 },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 1.5, borderColor: Colors.border, alignItems: "center", justifyContent: "center" },
  checkboxActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
});
