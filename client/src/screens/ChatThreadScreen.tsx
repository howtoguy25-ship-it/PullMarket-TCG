import React, { useLayoutEffect, useState } from "react";
import { View, StyleSheet, Text, FlatList, TextInput, Pressable, Image, Platform, KeyboardAvoidingView, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { Video, ResizeMode } from "expo-av";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Colors, Spacing, Typography, BorderRadius } from "@/constants/theme";
import { Avatar } from "@/components/Avatar";
import { RootStackParamList } from "@/navigation/types";
import { apiJson, apiRequest, ApiError } from "@/lib/api";
import { appendMediaToFormData } from "@/lib/formDataImage";
import { resolveImageUrl } from "@/lib/media";

type Nav = NativeStackNavigationProp<RootStackParamList>;
type ThreadRoute = RouteProp<RootStackParamList, "ChatThread">;

interface ChatUser {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

interface Attachment {
  id: string;
  url: string;
  type: "image" | "video";
}

interface Message {
  id: string;
  senderId: string;
  text: string | null;
  flagged: boolean;
  deliveredAt: string | null;
  readAt: string | null;
  createdAt: string;
  attachments: Attachment[];
}

interface ConversationDetail {
  id: string;
  status: "pending" | "accepted" | "declined";
  initiatorId: string;
  otherUser: ChatUser | null;
  isIncomingRequest: boolean;
}

interface PendingMedia {
  uri: string;
  type?: string;
  mimeType?: string;
  fileName?: string | null;
}

function ReceiptTicks({ message }: { message: Message }) {
  if (message.readAt) return <Feather name="check-circle" size={12} color={Colors.success} />;
  if (message.deliveredAt) {
    return (
      <View style={styles.ticksRow}>
        <Feather name="check" size={12} color={Colors.textMuted} style={{ marginRight: -6 }} />
        <Feather name="check" size={12} color={Colors.textMuted} />
      </View>
    );
  }
  return <Feather name="check" size={12} color={Colors.textMuted} />;
}

export default function ChatThreadScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<ThreadRoute>();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const queryClient = useQueryClient();
  const { conversationId } = route.params;

  const [text, setText] = useState("");
  const [pendingMedia, setPendingMedia] = useState<PendingMedia[]>([]);

  const { data: convo } = useQuery<ConversationDetail>({ queryKey: [`/api/chat/conversations/${conversationId}`], refetchInterval: 4000, meta: { silent401: true } });
  const { data: messages, isLoading } = useQuery<Message[]>({ queryKey: [`/api/chat/conversations/${conversationId}/messages`], refetchInterval: 3000, meta: { silent401: true } });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/chat/conversations/${conversationId}`] });
    queryClient.invalidateQueries({ queryKey: [`/api/chat/conversations/${conversationId}/messages`] });
    queryClient.invalidateQueries({ queryKey: ["/api/chat/conversations"] });
  };

  const acceptMutation = useMutation({ mutationFn: () => apiJson("POST", `/api/chat/conversations/${conversationId}/accept`), onSuccess: invalidateAll });
  const declineMutation = useMutation({
    mutationFn: () => apiJson("POST", `/api/chat/conversations/${conversationId}/decline`),
    onSuccess: () => {
      invalidateAll();
      navigation.goBack();
    },
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      if (text.trim()) formData.append("text", text.trim());
      for (let i = 0; i < pendingMedia.length; i++) {
        await appendMediaToFormData(formData, "media", pendingMedia[i], i);
      }
      return apiRequest("POST", `/api/chat/conversations/${conversationId}/messages`, formData, true);
    },
    onSuccess: () => {
      setText("");
      setPendingMedia([]);
      invalidateAll();
    },
    onError: (err) => console.warn(err instanceof ApiError ? err.message : "Couldn't send message"),
  });

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () =>
        convo?.otherUser ? (
          <Pressable style={styles.headerTitle} onPress={() => navigation.navigate("UserProfile", { userId: convo.otherUser!.id })}>
            <Avatar avatarUrl={convo.otherUser.avatarUrl} seed={convo.otherUser.username} size={30} />
            <Text style={styles.headerUsername}>@{convo.otherUser.username}</Text>
          </Pressable>
        ) : null,
      headerRight: () =>
        convo?.otherUser ? (
          <Pressable
            hitSlop={8}
            style={{ paddingHorizontal: Spacing.sm }}
            onPress={() =>
              navigation.navigate("Report", { conversationId, reportedUserId: convo.otherUser!.id, reportedUsername: convo.otherUser!.username })
            }
          >
            <Feather name="flag" size={18} color={Colors.textSecondary} />
          </Pressable>
        ) : null,
    });
  }, [navigation, convo?.otherUser, conversationId]);

  const pickMedia = async () => {
    if (pendingMedia.length >= 4) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      allowsMultipleSelection: true,
      selectionLimit: 4 - pendingMedia.length,
      quality: 0.85,
    });
    if (!result.canceled) {
      setPendingMedia((prev) =>
        [
          ...prev,
          ...result.assets.map((a) => ({ uri: a.uri, type: a.type ?? undefined, mimeType: a.mimeType, fileName: a.fileName })),
        ].slice(0, 4),
      );
    }
  };

  const removeMedia = (index: number) => setPendingMedia((prev) => prev.filter((_, i) => i !== index));

  const canSend = (text.trim().length > 0 || pendingMedia.length > 0) && !sendMutation.isPending && convo?.status !== "declined";
  const showRequestBanner = convo?.status === "pending" && convo.isIncomingRequest;
  const showSentBanner = convo?.status === "pending" && !convo.isIncomingRequest;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={headerHeight}>
      {isLoading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={messages ?? []}
          keyExtractor={(item) => item.id}
          inverted
          contentContainerStyle={{ padding: Spacing.md, flexGrow: 1, justifyContent: "flex-end" }}
          renderItem={({ item }) => {
            const mine = item.senderId !== convo?.otherUser?.id;
            return (
              <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
                <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                  {item.attachments.map((att) =>
                    att.type === "video" ? (
                      <Video
                        key={att.id}
                        source={{ uri: resolveImageUrl(att.url)! }}
                        style={styles.attachmentMedia}
                        useNativeControls
                        resizeMode={ResizeMode.COVER}
                      />
                    ) : (
                      <Image key={att.id} source={{ uri: resolveImageUrl(att.url) }} style={styles.attachmentMedia} resizeMode="cover" />
                    ),
                  )}
                  {item.text ? <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{item.text}</Text> : null}
                </View>
                {mine ? (
                  <View style={styles.receiptRow}>
                    <ReceiptTicks message={item} />
                  </View>
                ) : null}
              </View>
            );
          }}
        />
      )}

      {showRequestBanner ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>@{convo?.otherUser?.username} wants to chat with you</Text>
          <View style={styles.bannerActions}>
            <Pressable onPress={() => declineMutation.mutate()} style={[styles.bannerButton, styles.declineButton]}>
              <Feather name="x" size={16} color={Colors.white} />
              <Text style={styles.bannerButtonText}>Decline</Text>
            </Pressable>
            <Pressable onPress={() => acceptMutation.mutate()} style={[styles.bannerButton, styles.acceptButton]}>
              <Feather name="check" size={16} color={Colors.white} />
              <Text style={styles.bannerButtonText}>Accept</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {showSentBanner ? (
        <View style={styles.sentBanner}>
          <Feather name="info" size={13} color={Colors.textSecondary} />
          <Text style={styles.sentBannerText}>Message request sent — they'll see it in their requests</Text>
        </View>
      ) : null}

      {pendingMedia.length > 0 ? (
        <View style={styles.mediaPreviewRow}>
          {pendingMedia.map((m, i) => (
            <View key={m.uri} style={styles.mediaPreview}>
              {m.type === "video" ? (
                <View style={[styles.mediaPreviewImage, styles.videoPreviewPlaceholder]}>
                  <Feather name="video" size={18} color={Colors.white} />
                </View>
              ) : (
                <Image source={{ uri: m.uri }} style={styles.mediaPreviewImage} />
              )}
              <Pressable onPress={() => removeMedia(i)} style={styles.mediaRemove} hitSlop={6}>
                <Feather name="x" size={12} color={Colors.white} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <View style={[styles.composeRow, { paddingBottom: insets.bottom + Spacing.sm }]}>
        <Pressable onPress={pickMedia} style={styles.attachButton} hitSlop={8}>
          <Feather name="plus-circle" size={26} color={Colors.primary} />
        </Pressable>
        <TextInput
          style={styles.composeInput}
          placeholder="Message…"
          placeholderTextColor={Colors.textMuted}
          value={text}
          onChangeText={setText}
          multiline
        />
        <Pressable onPress={() => sendMutation.mutate()} disabled={!canSend} style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}>
          <Feather name="arrow-up" size={18} color={Colors.white} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerTitle: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerUsername: { ...Typography.bodyBold, color: Colors.text, fontSize: 15 },
  bubbleRow: { marginVertical: 3, maxWidth: "78%" },
  bubbleRowMine: { alignSelf: "flex-end", alignItems: "flex-end" },
  bubbleRowTheirs: { alignSelf: "flex-start", alignItems: "flex-start" },
  bubble: { borderRadius: BorderRadius.lg, paddingHorizontal: Spacing.md, paddingVertical: 10, gap: 6 },
  bubbleMine: { backgroundColor: Colors.primary, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderBottomLeftRadius: 4 },
  bubbleText: { ...Typography.body, color: Colors.text },
  bubbleTextMine: { color: Colors.white },
  attachmentMedia: { width: 200, height: 200, borderRadius: BorderRadius.md, backgroundColor: Colors.border },
  receiptRow: { marginTop: 2, marginRight: 4 },
  ticksRow: { flexDirection: "row", alignItems: "center" },
  banner: { backgroundColor: Colors.surfaceAlt, borderTopWidth: 1, borderTopColor: Colors.border, padding: Spacing.md, gap: Spacing.sm },
  bannerText: { ...Typography.bodyBold, color: Colors.text, fontSize: 14, textAlign: "center" },
  bannerActions: { flexDirection: "row", gap: Spacing.sm },
  bannerButton: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: BorderRadius.pill },
  acceptButton: { backgroundColor: Colors.success },
  declineButton: { backgroundColor: Colors.danger },
  bannerButtonText: { ...Typography.bodyBold, color: Colors.white, fontSize: 14 },
  sentBanner: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, backgroundColor: Colors.surfaceAlt },
  sentBannerText: { ...Typography.small, color: Colors.textSecondary },
  mediaPreviewRow: { flexDirection: "row", gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingTop: Spacing.sm },
  mediaPreview: { position: "relative" },
  mediaPreviewImage: { width: 56, height: 56, borderRadius: BorderRadius.sm, backgroundColor: Colors.border },
  videoPreviewPlaceholder: { alignItems: "center", justifyContent: "center", backgroundColor: Colors.secondary },
  mediaRemove: { position: "absolute", top: -6, right: -6, backgroundColor: Colors.overlay, borderRadius: 10, width: 20, height: 20, alignItems: "center", justifyContent: "center" },
  composeRow: { flexDirection: "row", alignItems: "flex-end", gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.background },
  attachButton: { paddingBottom: 8 },
  composeInput: { flex: 1, maxHeight: 100, backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: Spacing.md, paddingVertical: 10, color: Colors.text, fontSize: 15 },
  sendButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.primary, alignItems: "center", justifyContent: "center", marginBottom: 2 },
  sendButtonDisabled: { backgroundColor: Colors.border },
});
