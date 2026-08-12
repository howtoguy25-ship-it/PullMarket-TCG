import React, { useState } from "react";
import { View, StyleSheet, Text, FlatList, Pressable, TextInput, Keyboard } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Colors, Spacing, Typography, BorderRadius, Shadow, NoWebFocusOutline } from "@/constants/theme";
import { EmptyState } from "@/components/ui";
import { Avatar } from "@/components/Avatar";
import { RootStackParamList } from "@/navigation/types";
import { apiJson, ApiError } from "@/lib/api";

type Nav = NativeStackNavigationProp<RootStackParamList>;

interface UserResult {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  identityVerificationStatus: string;
}

interface FriendStatus {
  status: "none" | "friends" | "pending_sent" | "pending_received";
  requestId: string | null;
}

function UserRow({ user, navigation }: { user: UserResult; navigation: Nav }) {
  const queryClient = useQueryClient();
  const { data: status } = useQuery<FriendStatus>({ queryKey: [`/api/friends/status/${user.id}`] });

  const requestMutation = useMutation({
    mutationFn: () => apiJson("POST", `/api/friends/request/${user.id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/friends/status/${user.id}`] }),
  });

  const startChatMutation = useMutation({
    mutationFn: () => apiJson<{ id: string }>("POST", `/api/chat/conversations/with/${user.id}`),
    onSuccess: (convo) => navigation.navigate("ChatThread", { conversationId: convo.id, otherUserId: user.id }),
    onError: (err) => console.warn(err instanceof ApiError ? err.message : "Couldn't start chat"),
  });

  const friendIcon = status?.status === "friends" ? "user-check" : status?.status === "pending_sent" ? "clock" : status?.status === "pending_received" ? "user-plus" : "user-plus";
  const friendDisabled = status?.status === "friends" || status?.status === "pending_sent";

  return (
    <Pressable style={styles.row} onPress={() => navigation.navigate("UserProfile", { userId: user.id })}>
      <Avatar avatarUrl={user.avatarUrl} seed={user.username} size={46} />
      <View style={{ flex: 1 }}>
        <Text style={styles.username}>@{user.username}</Text>
        {user.displayName ? <Text style={styles.displayName}>{user.displayName}</Text> : null}
      </View>
      <Pressable
        onPress={(e) => {
          e.stopPropagation?.();
          if (status?.status === "pending_received" && status.requestId) navigation.navigate("FriendRequests");
          else if (!friendDisabled) requestMutation.mutate();
        }}
        style={[styles.iconButton, friendDisabled && styles.iconButtonDisabled]}
        hitSlop={8}
      >
        <Feather name={friendIcon} size={18} color={friendDisabled ? Colors.textMuted : Colors.primary} />
      </Pressable>
      <Pressable
        onPress={(e) => {
          e.stopPropagation?.();
          startChatMutation.mutate();
        }}
        style={styles.iconButton}
        hitSlop={8}
      >
        <Feather name="message-circle" size={18} color={Colors.primary} />
      </Pressable>
    </Pressable>
  );
}

export default function UserSearchScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const [query, setQuery] = useState("");

  const { data: results, isLoading } = useQuery<UserResult[]>({ queryKey: [`/api/users/search?q=${encodeURIComponent(query)}`], enabled: query.trim().length > 0 });

  return (
    <View style={[styles.container, { paddingTop: headerHeight + Spacing.sm, paddingBottom: insets.bottom }]}>
      <View style={styles.searchRow}>
        <View style={styles.searchBar}>
          <Feather name="search" size={18} color={Colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search username or phone number…"
            placeholderTextColor={Colors.textMuted}
            value={query}
            onChangeText={setQuery}
            autoFocus
            keyboardType="default"
          />
        </View>
        {query.length > 0 ? (
          <Pressable
            onPress={() => {
              setQuery("");
              Keyboard.dismiss();
            }}
            hitSlop={8}
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        ) : null}
      </View>

      <FlatList
        data={results ?? []}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: Spacing.xl }}
        renderItem={({ item }) => <UserRow user={item} navigation={navigation} />}
        ListEmptyComponent={
          query.trim().length > 0 && !isLoading ? (
            <EmptyState icon={<Feather name="user-x" size={40} color={Colors.textMuted} />} title="No users found" subtitle="Try a different username or phone number" />
          ) : (
            <EmptyState icon={<Feather name="search" size={40} color={Colors.textMuted} />} title="Find people" subtitle="Search by username or phone number to start a chat" />
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  searchRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, paddingHorizontal: Spacing.lg, marginBottom: Spacing.sm },
  searchBar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 11,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.card,
  },
  searchInput: { flex: 1, color: Colors.text, fontSize: 15, ...NoWebFocusOutline },
  cancelText: { ...Typography.body, color: Colors.primary, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  username: { ...Typography.bodyBold, color: Colors.text, fontSize: 15 },
  displayName: { ...Typography.small, color: Colors.textSecondary },
  iconButton: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "#FCE9E4" },
  iconButtonDisabled: { backgroundColor: Colors.border },
});
