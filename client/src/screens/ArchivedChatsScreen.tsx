import { useState } from "react";
import { View, StyleSheet, Text, FlatList, Pressable, Platform, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Colors, Spacing, Typography } from "@/constants/theme";
import { EmptyState } from "@/components/ui";
import { Avatar } from "@/components/Avatar";
import { ChatSwipeRow } from "@/components/ChatSwipeRow";
import { MuteDurationSheet, MuteChoice } from "@/components/MuteDurationSheet";
import { RootStackParamList } from "@/navigation/types";
import { apiJson, apiRequest, ApiError } from "@/lib/api";
import { timeAgoShort } from "@/lib/timeAgo";

type Nav = NativeStackNavigationProp<RootStackParamList>;

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

interface ChatUser {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

interface ConversationRow {
  id: string;
  lastMessageAt: string;
  lastMessagePreview: string | null;
  otherUser: ChatUser | null;
  unreadCount: number;
  muted: boolean;
}

export default function ArchivedChatsScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const queryClient = useQueryClient();
  const [mutePickerFor, setMutePickerFor] = useState<ConversationRow | null>(null);

  const { data, isLoading } = useQuery<ConversationRow[]>({ queryKey: ["/api/chat/conversations?archived=true"] });
  const chats = data ?? [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/chat/conversations?archived=true"] });
    queryClient.invalidateQueries({ queryKey: ["/api/chat/conversations"] });
  };
  const muteMutation = useMutation({
    mutationFn: ({ id, choice }: { id: string; choice: MuteChoice }) => apiJson("POST", `/api/chat/conversations/${id}/mute`, choice),
    onSuccess: invalidate,
    onError: (err) => showAlert("Couldn't update mute", err instanceof ApiError ? err.message : "Please try again."),
  });
  const unarchiveMutation = useMutation({
    mutationFn: (id: string) => apiJson("POST", `/api/chat/conversations/${id}/unarchive`),
    onSuccess: invalidate,
    onError: (err) => showAlert("Couldn't unarchive", err instanceof ApiError ? err.message : "Please try again."),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/chat/conversations/${id}`),
    onSuccess: invalidate,
    onError: (err) => showAlert("Couldn't delete", err instanceof ApiError ? err.message : "Please try again."),
  });

  const handleDelete = async (row: ConversationRow) => {
    const ok = await confirmAsync("Delete chat", `Delete your conversation with @${row.otherUser?.username ?? "this user"}? It'll come back if they message you again.`, "Delete");
    if (ok) deleteMutation.mutate(row.id);
  };

  return (
    <View style={[styles.container, { paddingTop: headerHeight }]}>
      <FlatList
        data={chats}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xl, flexGrow: 1 }}
        renderItem={({ item }) => (
          <ChatSwipeRow
            muted={item.muted}
            archived
            onPressDelete={() => void handleDelete(item)}
            onPressMute={() => setMutePickerFor(item)}
            onArchive={() => unarchiveMutation.mutate(item.id)}
          >
            <Pressable style={styles.chatRow} onPress={() => navigation.navigate("ChatThread", { conversationId: item.id, otherUserId: item.otherUser?.id })}>
              <Avatar avatarUrl={item.otherUser?.avatarUrl} seed={item.otherUser?.username ?? item.id} size={50} />
              <View style={{ flex: 1 }}>
                <View style={styles.chatNameRow}>
                  <Text style={styles.chatName}>@{item.otherUser?.username ?? "Unknown"}</Text>
                  {item.muted ? <Feather name="bell-off" size={13} color={Colors.textMuted} /> : null}
                </View>
                <Text style={styles.chatPreview} numberOfLines={1}>
                  {item.lastMessagePreview || "Say hello"}
                </Text>
              </View>
              <Text style={styles.chatTime}>{timeAgoShort(item.lastMessageAt)}</Text>
            </Pressable>
          </ChatSwipeRow>
        )}
        ListEmptyComponent={
          !isLoading ? (
            <EmptyState icon={<Feather name="archive" size={40} color={Colors.textMuted} />} title="No archived chats" subtitle="Swipe a chat right on the Messages tab to archive it" />
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
  chatRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, backgroundColor: Colors.background },
  chatNameRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  chatName: { ...Typography.bodyBold, color: Colors.text, fontSize: 15 },
  chatPreview: { ...Typography.small, color: Colors.textSecondary, marginTop: 2 },
  chatTime: { ...Typography.small, color: Colors.textMuted, fontSize: 11 },
});
