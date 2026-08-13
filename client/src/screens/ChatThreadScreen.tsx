import React, { useLayoutEffect, useState } from "react";
import { View, StyleSheet, Text, FlatList, TextInput, Pressable, Image, Platform, KeyboardAvoidingView, ActivityIndicator, Modal, Alert } from "react-native";
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
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { RootStackParamList } from "@/navigation/types";
import { apiJson, apiRequest, ApiError } from "@/lib/api";
import { appendMediaToFormData } from "@/lib/formDataImage";
import { resolveImageUrl } from "@/lib/media";
import { useCall } from "@/contexts/CallContext";
import { isActivePro } from "@shared/validation";

type Nav = NativeStackNavigationProp<RootStackParamList>;
type ThreadRoute = RouteProp<RootStackParamList, "ChatThread">;

interface ChatUser {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  proStatus: string;
  proCurrentPeriodEnd: string | null;
}

interface Attachment {
  id: string;
  url: string;
  type: "image" | "video";
}

interface ReplyPreview {
  id: string;
  senderId: string;
  senderUsername: string;
  text: string | null;
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
  replyToMessageId: string | null;
  replyTo: ReplyPreview | null;
  forwarded: boolean;
  deletedForEveryoneAt: string | null;
}

interface ConversationDetail {
  id: string;
  status: "pending" | "accepted" | "declined";
  initiatorId: string;
  otherUser: ChatUser | null;
  isIncomingRequest: boolean;
}

interface ConversationSummary {
  id: string;
  otherUser: ChatUser | null;
}

interface PendingMedia {
  uri: string;
  type?: string;
  mimeType?: string;
  fileName?: string | null;
}

const DELETE_FOR_EVERYONE_WINDOW_MS = 24 * 60 * 60 * 1000;

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

function formatMessageTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return time;
  const datePart = d.toLocaleDateString([], d.getFullYear() === now.getFullYear() ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
  return `${datePart}, ${time}`;
}

// One gray tick = sent, two gray ticks = delivered, two highlighted
// (primary-colored) ticks = read — same three-state convention as any
// real chat app.
function ReceiptTicks({ message }: { message: Message }) {
  if (message.readAt) {
    return (
      <View style={styles.ticksRow}>
        <Feather name="check" size={12} color={Colors.primary} style={{ marginRight: -6 }} />
        <Feather name="check" size={12} color={Colors.primary} />
      </View>
    );
  }
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
  const { startCall } = useCall();

  const [text, setText] = useState("");
  const [pendingMedia, setPendingMedia] = useState<PendingMedia[]>([]);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [actionMessage, setActionMessage] = useState<Message | null>(null);
  const [forwardMessage, setForwardMessage] = useState<Message | null>(null);

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
      if (replyingTo) formData.append("replyToMessageId", replyingTo.id);
      for (let i = 0; i < pendingMedia.length; i++) {
        await appendMediaToFormData(formData, "media", pendingMedia[i], i);
      }
      return apiRequest("POST", `/api/chat/conversations/${conversationId}/messages`, formData, true);
    },
    onSuccess: () => {
      setText("");
      setPendingMedia([]);
      setReplyingTo(null);
      invalidateAll();
    },
    onError: (err) => showAlert("Couldn't send", err instanceof ApiError ? err.message : "Please try again."),
  });

  const deleteForMeMutation = useMutation({
    mutationFn: (messageId: string) => apiRequest("DELETE", `/api/chat/messages/${messageId}`),
    onSuccess: invalidateAll,
    onError: (err) => showAlert("Couldn't delete", err instanceof ApiError ? err.message : "Please try again."),
  });

  const deleteForEveryoneMutation = useMutation({
    mutationFn: (messageId: string) => apiJson("POST", `/api/chat/messages/${messageId}/delete-everyone`),
    onSuccess: invalidateAll,
    onError: (err) => showAlert("Couldn't delete", err instanceof ApiError ? err.message : "Please try again."),
  });

  const forwardMutation = useMutation({
    mutationFn: ({ messageId, toConversationId }: { messageId: string; toConversationId: string }) =>
      apiJson("POST", `/api/chat/messages/${messageId}/forward`, { toConversationId }),
    onSuccess: (_data, vars) => {
      setForwardMessage(null);
      queryClient.invalidateQueries({ queryKey: ["/api/chat/conversations"] });
      queryClient.invalidateQueries({ queryKey: [`/api/chat/conversations/${vars.toConversationId}/messages`] });
      showAlert("Forwarded", "Message forwarded.");
    },
    onError: (err) => showAlert("Couldn't forward", err instanceof ApiError ? err.message : "Please try again."),
  });

  const blockMutation = useMutation({
    mutationFn: () => apiJson("POST", `/api/blocks/${convo?.otherUser?.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/conversations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/friends/requests"] });
      navigation.goBack();
    },
    onError: (err) => showAlert("Couldn't block", err instanceof ApiError ? err.message : "Please try again."),
  });

  const handleBlock = async () => {
    if (!convo?.otherUser) return;
    const ok = await confirmAsync("Block user", `Block @${convo.otherUser.username}? They won't be able to message or friend-request you, and this conversation will close.`, "Block");
    if (ok) blockMutation.mutate();
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () =>
        convo?.otherUser ? (
          <Pressable style={styles.headerTitle} onPress={() => navigation.navigate("UserProfile", { userId: convo.otherUser!.id })}>
            <Avatar avatarUrl={convo.otherUser.avatarUrl} seed={convo.otherUser.username} size={30} />
            <Text style={styles.headerUsername}>@{convo.otherUser.username}</Text>
            {isActivePro(convo.otherUser) ? <VerifiedBadge size={13} /> : null}
          </Pressable>
        ) : null,
      headerRight: () =>
        convo?.otherUser ? (
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            {/* Calling is native-only for now — react-native-webrtc has no
               web build, so this simply doesn't render on web rather than
               show a button that can't work. */}
            {Platform.OS !== "web" && convo.status === "accepted" ? (
              <>
                <Pressable hitSlop={8} style={{ paddingHorizontal: Spacing.sm }} onPress={() => void startCall(conversationId, convo.otherUser!, false)}>
                  <Feather name="phone" size={18} color={Colors.primary} />
                </Pressable>
                <Pressable hitSlop={8} style={{ paddingHorizontal: Spacing.sm }} onPress={() => void startCall(conversationId, convo.otherUser!, true)}>
                  <Feather name="video" size={18} color={Colors.primary} />
                </Pressable>
              </>
            ) : null}
            <Pressable hitSlop={8} style={{ paddingHorizontal: Spacing.sm }} onPress={() => void handleBlock()}>
              <Feather name="slash" size={18} color={Colors.danger} />
            </Pressable>
            <Pressable
              hitSlop={8}
              style={{ paddingHorizontal: Spacing.sm }}
              onPress={() =>
                navigation.navigate("Report", { conversationId, reportedUserId: convo.otherUser!.id, reportedUsername: convo.otherUser!.username })
              }
            >
              <Feather name="flag" size={18} color={Colors.textSecondary} />
            </Pressable>
          </View>
        ) : null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, convo?.otherUser, convo?.status, conversationId, startCall]);

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

  const canDeleteForEveryone = (m: Message) => {
    const mine = m.senderId !== convo?.otherUser?.id;
    return mine && !m.deletedForEveryoneAt && Date.now() - new Date(m.createdAt).getTime() <= DELETE_FOR_EVERYONE_WINDOW_MS;
  };

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
            const isDeleted = !!item.deletedForEveryoneAt;
            return (
              <Pressable
                onLongPress={() => !isDeleted && setActionMessage(item)}
                style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}
              >
                {item.forwarded && !isDeleted ? (
                  <View style={styles.forwardedRow}>
                    <Feather name="corner-up-right" size={11} color={Colors.textMuted} />
                    <Text style={styles.forwardedText}>Forwarded</Text>
                  </View>
                ) : null}
                <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                  {isDeleted ? (
                    <View style={styles.deletedRow}>
                      <Feather name="slash" size={12} color={mine ? "rgba(255,255,255,0.75)" : Colors.textMuted} />
                      <Text style={[styles.deletedText, mine && styles.deletedTextMine]}>This message was deleted</Text>
                    </View>
                  ) : (
                    <>
                      {item.replyTo ? (
                        <View style={[styles.replyPreview, mine && styles.replyPreviewMine]}>
                          <Text style={[styles.replyPreviewSender, mine && styles.replyPreviewSenderMine]}>@{item.replyTo.senderUsername}</Text>
                          <Text style={[styles.replyPreviewText, mine && styles.replyPreviewTextMine]} numberOfLines={1}>
                            {item.replyTo.text || "Attachment"}
                          </Text>
                        </View>
                      ) : null}
                      {item.attachments.length > 0 ? (
                        <View style={styles.attachmentsWrap}>
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
                        </View>
                      ) : null}
                      {item.attachments.length > 0 && item.text ? <View style={[styles.mediaDivider, mine && styles.mediaDividerMine]} /> : null}
                      {item.text ? <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{item.text}</Text> : null}
                    </>
                  )}
                </View>
                <View style={styles.metaRow}>
                  <Text style={styles.timeText}>{formatMessageTime(item.createdAt)}</Text>
                  {mine ? <ReceiptTicks message={item} /> : null}
                </View>
              </Pressable>
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

      {replyingTo ? (
        <View style={styles.replyBar}>
          <View style={styles.replyBarAccent} />
          <View style={{ flex: 1 }}>
            <Text style={styles.replyBarSender}>Replying to {replyingTo.senderId === convo?.otherUser?.id ? `@${convo?.otherUser?.username}` : "yourself"}</Text>
            <Text style={styles.replyBarText} numberOfLines={1}>
              {replyingTo.text || "Attachment"}
            </Text>
          </View>
          <Pressable onPress={() => setReplyingTo(null)} hitSlop={8} style={styles.replyBarClose}>
            <Feather name="x" size={16} color={Colors.textSecondary} />
          </Pressable>
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

      <Modal visible={!!actionMessage} transparent animationType="fade" onRequestClose={() => setActionMessage(null)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setActionMessage(null)}>
          <View style={styles.sheetCard}>
            <Pressable
              style={styles.sheetOption}
              onPress={() => {
                setReplyingTo(actionMessage);
                setActionMessage(null);
              }}
            >
              <Feather name="corner-up-left" size={18} color={Colors.text} />
              <Text style={styles.sheetOptionText}>Reply</Text>
            </Pressable>
            <Pressable
              style={styles.sheetOption}
              onPress={() => {
                setForwardMessage(actionMessage);
                setActionMessage(null);
              }}
            >
              <Feather name="corner-up-right" size={18} color={Colors.text} />
              <Text style={styles.sheetOptionText}>Forward</Text>
            </Pressable>
            <Pressable
              style={styles.sheetOption}
              onPress={() => {
                if (actionMessage) deleteForMeMutation.mutate(actionMessage.id);
                setActionMessage(null);
              }}
            >
              <Feather name="trash-2" size={18} color={Colors.text} />
              <Text style={styles.sheetOptionText}>Delete for me</Text>
            </Pressable>
            {actionMessage && canDeleteForEveryone(actionMessage) ? (
              <Pressable
                style={styles.sheetOption}
                onPress={async () => {
                  const id = actionMessage.id;
                  setActionMessage(null);
                  const ok = await confirmAsync("Delete for everyone", "This removes the message for everyone in this chat. This can't be undone.", "Delete");
                  if (ok) deleteForEveryoneMutation.mutate(id);
                }}
              >
                <Feather name="trash-2" size={18} color={Colors.danger} />
                <Text style={[styles.sheetOptionText, { color: Colors.danger }]}>Delete for everyone</Text>
              </Pressable>
            ) : null}
            {actionMessage && actionMessage.senderId === convo?.otherUser?.id ? (
              <Pressable
                style={styles.sheetOption}
                onPress={() => {
                  if (actionMessage && convo?.otherUser) {
                    navigation.navigate("Report", {
                      conversationId,
                      reportedUserId: convo.otherUser.id,
                      reportedUsername: convo.otherUser.username,
                      messageId: actionMessage.id,
                    });
                  }
                  setActionMessage(null);
                }}
              >
                <Feather name="flag" size={18} color={Colors.text} />
                <Text style={styles.sheetOptionText}>Report</Text>
              </Pressable>
            ) : null}
            <Pressable style={[styles.sheetOption, styles.sheetCancel]} onPress={() => setActionMessage(null)}>
              <Text style={styles.sheetOptionText}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <ForwardPickerModal message={forwardMessage} currentConversationId={conversationId} onClose={() => setForwardMessage(null)} onPick={(toConversationId) => forwardMessage && forwardMutation.mutate({ messageId: forwardMessage.id, toConversationId })} isForwarding={forwardMutation.isPending} />
    </KeyboardAvoidingView>
  );
}

function ForwardPickerModal({
  message,
  currentConversationId,
  onClose,
  onPick,
  isForwarding,
}: {
  message: Message | null;
  currentConversationId: string;
  onClose: () => void;
  onPick: (toConversationId: string) => void;
  isForwarding: boolean;
}) {
  const { data: conversations } = useQuery<ConversationSummary[]>({ queryKey: ["/api/chat/conversations"], enabled: !!message });
  const targets = (conversations ?? []).filter((c) => c.id !== currentConversationId && c.otherUser);

  return (
    <Modal visible={!!message} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <View style={styles.forwardCard}>
          <Text style={styles.forwardTitle}>Forward to…</Text>
          <FlatList
            data={targets}
            keyExtractor={(item) => item.id}
            style={{ maxHeight: 360 }}
            ListEmptyComponent={<Text style={styles.forwardEmpty}>No other conversations yet</Text>}
            renderItem={({ item }) => (
              <Pressable style={styles.forwardRow} disabled={isForwarding} onPress={() => onPick(item.id)}>
                <Avatar avatarUrl={item.otherUser!.avatarUrl} seed={item.otherUser!.username} size={36} />
                <Text style={styles.forwardRowText}>@{item.otherUser!.username}</Text>
                {isForwarding ? <ActivityIndicator size="small" color={Colors.primary} /> : null}
              </Pressable>
            )}
          />
        </View>
      </Pressable>
    </Modal>
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
  deletedRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  deletedText: { ...Typography.body, color: Colors.textMuted, fontStyle: "italic" },
  deletedTextMine: { color: "rgba(255,255,255,0.75)" },
  attachmentsWrap: { gap: 6 },
  attachmentMedia: { width: 200, height: 200, borderRadius: BorderRadius.md, backgroundColor: Colors.border },
  mediaDivider: { height: 1, backgroundColor: Colors.border, marginVertical: 2 },
  mediaDividerMine: { backgroundColor: "rgba(255,255,255,0.3)" },
  forwardedRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 2, paddingHorizontal: 2 },
  forwardedText: { ...Typography.small, color: Colors.textMuted, fontSize: 11, fontStyle: "italic" },
  replyPreview: { borderLeftWidth: 3, borderLeftColor: Colors.primary, backgroundColor: Colors.surfaceAlt, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  replyPreviewMine: { backgroundColor: "rgba(255,255,255,0.18)", borderLeftColor: Colors.white },
  replyPreviewSender: { fontSize: 11, fontWeight: "700", color: Colors.primary },
  replyPreviewSenderMine: { color: Colors.white },
  replyPreviewText: { fontSize: 12, color: Colors.textSecondary },
  replyPreviewTextMine: { color: "rgba(255,255,255,0.85)" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2, marginHorizontal: 4 },
  timeText: { fontSize: 10.5, color: Colors.textMuted },
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
  replyBar: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, backgroundColor: Colors.surfaceAlt, borderTopWidth: 1, borderTopColor: Colors.border },
  replyBarAccent: { width: 3, alignSelf: "stretch", borderRadius: 2, backgroundColor: Colors.primary },
  replyBarSender: { fontSize: 12, fontWeight: "700", color: Colors.primary },
  replyBarText: { fontSize: 12, color: Colors.textSecondary, marginTop: 1 },
  replyBarClose: { padding: 4 },
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
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "flex-end" },
  sheetCard: { backgroundColor: Colors.surface, borderTopLeftRadius: BorderRadius.lg, borderTopRightRadius: BorderRadius.lg, width: "100%", paddingBottom: Spacing.xl, paddingTop: Spacing.sm },
  sheetOption: { flexDirection: "row", alignItems: "center", gap: Spacing.md, paddingHorizontal: Spacing.lg, paddingVertical: 14 },
  sheetOptionText: { ...Typography.body, color: Colors.text },
  sheetCancel: { borderTopWidth: 1, borderTopColor: Colors.border, marginTop: 4, justifyContent: "center" },
  forwardCard: { backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.md, width: "88%", maxWidth: 400 },
  forwardTitle: { ...Typography.bodyBold, color: Colors.text, marginBottom: Spacing.sm, paddingHorizontal: Spacing.xs },
  forwardEmpty: { ...Typography.small, color: Colors.textMuted, textAlign: "center", paddingVertical: Spacing.lg },
  forwardRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, paddingVertical: 10, paddingHorizontal: Spacing.xs },
  forwardRowText: { ...Typography.body, color: Colors.text, flex: 1 },
});
