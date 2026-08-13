import React, { useState } from "react";
import { View, StyleSheet, Text, FlatList, Pressable, Platform, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Colors, Spacing, Typography, BorderRadius } from "@/constants/theme";
import { EmptyState } from "@/components/ui";
import { Avatar } from "@/components/Avatar";
import { ChatSwipeRow } from "@/components/ChatSwipeRow";
import { MuteDurationSheet, MuteChoice } from "@/components/MuteDurationSheet";
import { RootStackParamList } from "@/navigation/types";
import { apiJson, apiRequest, describeApiError } from "@/lib/api";
import { timeAgoShort } from "@/lib/timeAgo";

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

type Nav = NativeStackNavigationProp<RootStackParamList>;

interface ChatUser {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

interface ConversationRow {
  id: string;
  status: "pending" | "accepted" | "declined";
  initiatorId: string;
  lastMessageAt: string;
  lastMessagePreview: string | null;
  otherUser: ChatUser | null;
  isIncomingRequest: boolean;
  unreadCount: number;
  muted: boolean;
  mutedForever: boolean;
  mutedUntil: string | null;
  archived: boolean;
}

function useConversations() {
  return useQuery<ConversationRow[]>({ queryKey: ["/api/chat/conversations"], refetchInterval: 5000, meta: { silent401: true } });
}

function useFriendRequestCount() {
  const { data } = useQuery<{ incoming: unknown[]; outgoing: unknown[] }>({ queryKey: ["/api/friends/requests"], refetchInterval: 15000 });
  return data?.incoming.length ?? 0;
}

export default function ChatListScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { data: conversations, isLoading, refetch } = useConversations();
  const friendRequestCount = useFriendRequestCount();
  const [mutePickerFor, setMutePickerFor] = useState<ConversationRow | null>(null);

  useFocusEffect(
    React.useCallback(() => {
      refetch();
    }, [refetch]),
  );

  const acceptMutation = useMutation({
    mutationFn: (id: string) => apiJson("POST", `/api/chat/conversations/${id}/accept`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/chat/conversations"] }),
  });
  const declineMutation = useMutation({
    mutationFn: (id: string) => apiJson("POST", `/api/chat/conversations/${id}/decline`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/chat/conversations"] }),
  });
  const invalidateConversations = () => queryClient.invalidateQueries({ queryKey: ["/api/chat/conversations"] });
  const muteMutation = useMutation({
    mutationFn: ({ id, choice }: { id: string; choice: MuteChoice }) => apiJson("POST", `/api/chat/conversations/${id}/mute`, choice),
    onSuccess: invalidateConversations,
    onError: (err) => showAlert("Couldn't update mute", describeApiError(err)),
  });
  const archiveMutation = useMutation({
    mutationFn: (id: string) => apiJson("POST", `/api/chat/conversations/${id}/archive`),
    onSuccess: invalidateConversations,
    onError: (err) => showAlert("Couldn't archive", describeApiError(err)),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/chat/conversations/${id}`),
    onSuccess: invalidateConversations,
    onError: (err) => showAlert("Couldn't delete", describeApiError(err)),
  });

  const handleDelete = async (row: ConversationRow) => {
    const ok = await confirmAsync("Delete chat", `Delete your conversation with @${row.otherUser?.username ?? "this user"}? It'll come back if they message you again.`, "Delete");
    if (ok) deleteMutation.mutate(row.id);
  };

  const rows = conversations ?? [];
  const requests = rows.filter((r) => r.isIncomingRequest);
  const chats = rows.filter((r) => !r.isIncomingRequest).sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());

  const openThread = (row: ConversationRow) => navigation.navigate("ChatThread", { conversationId: row.id, otherUserId: row.otherUser?.id });

  return (
    <View style={[styles.container, { paddingTop: insets.top + Spacing.sm }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Messages</Text>
        <View style={styles.headerActions}>
          <Pressable onPress={() => navigation.navigate("ArchivedChats")} style={styles.headerButton} hitSlop={8}>
            <Feather name="archive" size={20} color={Colors.text} />
          </Pressable>
          <Pressable onPress={() => navigation.navigate("FriendRequests")} style={styles.headerButton} hitSlop={8}>
            <Feather name="users" size={20} color={Colors.text} />
            {friendRequestCount > 0 ? (
              <View style={styles.headerBadge}>
                <Text style={styles.headerBadgeText}>{friendRequestCount}</Text>
              </View>
            ) : null}
          </Pressable>
          <Pressable onPress={() => navigation.navigate("UserSearch")} style={styles.headerButton} hitSlop={8}>
            <Feather name="edit" size={20} color={Colors.text} />
          </Pressable>
        </View>
      </View>

      <FlatList
        data={chats}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xl }}
        ListHeaderComponent={
          requests.length > 0 ? (
            <View style={styles.requestsSection}>
              <Text style={styles.sectionTitle}>Message requests · {requests.length}</Text>
              {requests.map((req) => (
                <View key={req.id} style={styles.requestRow}>
                  <Pressable style={styles.requestInfo} onPress={() => openThread(req)}>
                    <Avatar avatarUrl={req.otherUser?.avatarUrl} seed={req.otherUser?.username ?? req.id} size={44} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.chatName}>@{req.otherUser?.username ?? "Unknown"}</Text>
                      <Text style={styles.requestPreview} numberOfLines={1}>
                        {req.lastMessagePreview || "Wants to chat with you"}
                      </Text>
                    </View>
                  </Pressable>
                  <View style={styles.requestActions}>
                    <Pressable onPress={() => declineMutation.mutate(req.id)} style={[styles.requestActionButton, styles.declineButton]} hitSlop={6}>
                      <Feather name="x" size={16} color={Colors.white} />
                    </Pressable>
                    <Pressable onPress={() => acceptMutation.mutate(req.id)} style={[styles.requestActionButton, styles.acceptButton]} hitSlop={6}>
                      <Feather name="check" size={16} color={Colors.white} />
                    </Pressable>
                  </View>
                </View>
              ))}
              {chats.length > 0 ? <Text style={styles.sectionTitle}>Chats</Text> : null}
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const pendingSentByMe = item.status === "pending" && item.initiatorId !== item.otherUser?.id;
          return (
            <ChatSwipeRow
              muted={item.muted}
              onPressDelete={() => void handleDelete(item)}
              onPressMute={() => setMutePickerFor(item)}
              onArchive={() => archiveMutation.mutate(item.id)}
            >
              <Pressable style={styles.chatRow} onPress={() => openThread(item)}>
                <Avatar avatarUrl={item.otherUser?.avatarUrl} seed={item.otherUser?.username ?? item.id} size={50} />
                <View style={styles.chatTextCol}>
                  <View style={styles.chatNameRow}>
                    <Text style={styles.chatName} numberOfLines={1}>
                      @{item.otherUser?.username ?? "Unknown"}
                    </Text>
                    {item.muted ? <Feather name="bell-off" size={13} color={Colors.textMuted} /> : null}
                  </View>
                  <Text style={[styles.chatPreview, item.unreadCount > 0 && styles.chatPreviewUnread]} numberOfLines={1}>
                    {pendingSentByMe ? "Request sent · " : ""}
                    {item.lastMessagePreview || "Say hello"}
                  </Text>
                </View>
                <View style={styles.chatMeta}>
                  <Text style={styles.chatTime}>{timeAgoShort(item.lastMessageAt)}</Text>
                  {item.unreadCount > 0 ? (
                    <View style={styles.unreadDot}>
                      <Text style={styles.unreadDotText}>{item.unreadCount > 9 ? "9+" : item.unreadCount}</Text>
                    </View>
                  ) : null}
                </View>
              </Pressable>
            </ChatSwipeRow>
          );
        }}
        ListEmptyComponent={
          !isLoading && requests.length === 0 ? (
            <EmptyState
              icon={<Feather name="message-circle" size={40} color={Colors.textMuted} />}
              title="No messages yet"
              subtitle="Search for a user to start a conversation"
            />
          ) : null
        }
      />

      <MuteDurationSheet
        visible={!!mutePickerFor}
        onClose={() => setMutePickerFor(null)}
        onSelect={(choice) => mutePickerFor && muteMutation.mutate({ id: mutePickerFor.id, choice })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm },
  headerTitle: { ...Typography.h2, color: Colors.text },
  headerActions: { flexDirection: "row", gap: Spacing.md },
  headerButton: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerBadge: { position: "absolute", top: 0, right: 0, backgroundColor: Colors.primary, borderRadius: 8, minWidth: 16, height: 16, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  headerBadgeText: { color: Colors.white, fontSize: 10, fontWeight: "800" },
  requestsSection: { paddingTop: Spacing.xs },
  sectionTitle: { ...Typography.small, color: Colors.textSecondary, fontWeight: "700", paddingHorizontal: Spacing.lg, paddingVertical: Spacing.xs, letterSpacing: 0.3 },
  requestRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, backgroundColor: Colors.surfaceAlt },
  requestInfo: { flex: 1, flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  requestPreview: { ...Typography.small, color: Colors.textSecondary },
  requestActions: { flexDirection: "row", gap: Spacing.xs },
  requestActionButton: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  acceptButton: { backgroundColor: Colors.success },
  declineButton: { backgroundColor: Colors.danger },
  chatRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingVertical: 12, minHeight: 66, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  chatTextCol: { flex: 1, justifyContent: "center", gap: 3 },
  chatNameRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  chatName: { ...Typography.bodyBold, color: Colors.text, fontSize: 15, flexShrink: 1 },
  chatPreview: { ...Typography.small, color: Colors.textSecondary },
  chatPreviewUnread: { color: Colors.text, fontWeight: "700" },
  chatMeta: { alignItems: "flex-end", justifyContent: "center", gap: 6, alignSelf: "stretch" },
  chatTime: { ...Typography.small, color: Colors.textMuted, fontSize: 11 },
  unreadDot: { backgroundColor: Colors.primary, borderRadius: 9, minWidth: 18, height: 18, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  unreadDotText: { color: Colors.white, fontSize: 10, fontWeight: "800" },
});
