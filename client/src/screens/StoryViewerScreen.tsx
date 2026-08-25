import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, StyleSheet, Text, Pressable, Image, Dimensions, FlatList, Alert, Platform, Modal } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Video, ResizeMode, AVPlaybackStatus } from "expo-av";
import { Feather } from "@expo/vector-icons";
import { Colors, Spacing, Typography, BorderRadius, Fonts } from "@/constants/theme";
import { RootStackParamList } from "@/navigation/types";
import { resolveImageUrl, effectiveStoryAspectRatio } from "@/lib/media";
import RotatedMedia from "@/components/RotatedMedia";
import { apiRequest, apiJson, ApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { STORY_IMAGE_DURATION_MS } from "@shared/validation";

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Rt = RouteProp<RootStackParamList, "StoryViewer">;

const { width, height } = Dimensions.get("window");

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

interface StoryItem {
  id: string;
  mediaType: "image" | "video";
  mediaUrl: string;
  mediaWidth: number | null;
  mediaHeight: number | null;
  rotation: number;
  caption: string | null;
  createdAt: string;
  seen: boolean;
}
interface StoryGroup {
  user: { id: string; username: string; displayName: string | null; avatarUrl: string | null } | null;
  stories: StoryItem[];
  hasUnseen: boolean;
  latestAt: string;
}
interface FeedResponse {
  mine: StoryGroup | null;
  others: StoryGroup[];
}

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h`;
}

function ViewersModal({ storyId, visible, onClose }: { storyId: string | null; visible: boolean; onClose: () => void }) {
  const { data } = useQuery<{ viewedAt: string; user: { id: string; username: string; avatarUrl: string | null } }[]>({
    queryKey: [`/api/stories/${storyId}/viewers`],
    enabled: visible && !!storyId,
  });
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.viewersContainer}>
        <View style={styles.viewersHeader}>
          <Text style={styles.viewersTitle}>Viewed by</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Feather name="x" size={22} color={Colors.text} />
          </Pressable>
        </View>
        <FlatList
          data={data ?? []}
          keyExtractor={(v) => v.user.id}
          contentContainerStyle={{ padding: Spacing.lg }}
          renderItem={({ item }) => (
            <View style={styles.viewerRow}>
              {item.user.avatarUrl ? <Image source={{ uri: resolveImageUrl(item.user.avatarUrl) }} style={styles.viewerAvatar} /> : <View style={[styles.viewerAvatar, { backgroundColor: Colors.surfaceAlt }]} />}
              <Text style={styles.viewerName}>@{item.user.username}</Text>
              <Text style={styles.viewerTime}>{timeAgo(item.viewedAt)} ago</Text>
            </View>
          )}
          ListEmptyComponent={<Text style={styles.emptyText}>No views yet.</Text>}
        />
      </View>
    </Modal>
  );
}

function UserStoryPage({
  group,
  active,
  isMine,
  onAdvance,
  onClose,
  onDeleted,
}: {
  group: StoryGroup;
  active: boolean;
  isMine: boolean;
  onAdvance: (dir: 1 | -1) => void;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [storyIndex, setStoryIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [viewersOpen, setViewersOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stories = group.stories;
  const current = stories[Math.min(storyIndex, stories.length - 1)];

  const viewMutation = useMutation({ mutationFn: (id: string) => apiRequest("POST", `/api/stories/${id}/view`) });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiJson("DELETE", `/api/stories/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stories/feed"] });
      onDeleted();
    },
    onError: (err) => showAlert("Couldn't delete", err instanceof ApiError ? err.message : "Please try again."),
  });

  const advanceStory = (dir: 1 | -1) => {
    const next = storyIndex + dir;
    if (next < 0) return onAdvance(-1);
    if (next >= stories.length) return onAdvance(1);
    setStoryIndex(next);
  };

  useEffect(() => {
    if (!active || !current) return;
    if (!isMine && !current.seen) void viewMutation.mutate(current.id);

    setProgress(0);
    if (current.mediaType === "image") {
      const start = Date.now();
      timerRef.current = setInterval(() => {
        const p = (Date.now() - start) / STORY_IMAGE_DURATION_MS;
        if (p >= 1) {
          setProgress(1);
          advanceStory(1);
        } else {
          setProgress(p);
        }
      }, 100);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, storyIndex, current?.id]);

  if (!current) return null;

  const isVideo = current.mediaType === "video";
  const aspectRatio = isVideo ? effectiveStoryAspectRatio(current.mediaWidth, current.mediaHeight, current.rotation) : 16 / 9;

  return (
    <View style={{ width, height, justifyContent: "center" }}>
      <View style={[styles.mediaFrame, { aspectRatio }]}>
        <RotatedMedia rotation={isVideo ? current.rotation : 0}>
          {isVideo ? (
            <Video
              source={{ uri: resolveImageUrl(current.mediaUrl)! }}
              style={styles.media}
              resizeMode={ResizeMode.COVER}
              shouldPlay={active}
              isMuted={!active}
              onPlaybackStatusUpdate={(status: AVPlaybackStatus) => {
                if (!status.isLoaded) return;
                if (status.durationMillis) setProgress(status.positionMillis / status.durationMillis);
                if (status.didJustFinish) advanceStory(1);
              }}
            />
          ) : (
            <Image source={{ uri: resolveImageUrl(current.mediaUrl) }} style={styles.media} resizeMode="cover" />
          )}
        </RotatedMedia>
      </View>

      <View style={[styles.progressRow, { top: insets.top + Spacing.sm }]}>
        {stories.map((s, i) => (
          <View key={s.id} style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${(i < storyIndex ? 1 : i === storyIndex ? progress : 0) * 100}%` }]} />
          </View>
        ))}
      </View>

      <View style={[styles.topBar, { top: insets.top + Spacing.md + 6 }]}>
        {group.user?.avatarUrl ? <Image source={{ uri: resolveImageUrl(group.user.avatarUrl) }} style={styles.topAvatar} /> : <View style={[styles.topAvatar, { backgroundColor: "rgba(255,255,255,0.2)" }]} />}
        <Text style={styles.topUsername}>{isMine ? "My status" : `@${group.user?.username}`}</Text>
        <Text style={styles.topTime}>{timeAgo(current.createdAt)}</Text>
        <View style={{ flex: 1 }} />
        {isMine ? (
          <Pressable onPress={() => deleteMutation.mutate(current.id)} hitSlop={10} style={{ marginRight: Spacing.md }}>
            <Feather name="trash-2" size={20} color={Colors.white} />
          </Pressable>
        ) : null}
        <Pressable onPress={onClose} hitSlop={10}>
          <Feather name="x" size={24} color={Colors.white} />
        </Pressable>
      </View>

      <Pressable style={styles.tapLeft} onPress={() => advanceStory(-1)} />
      <Pressable style={styles.tapRight} onPress={() => advanceStory(1)} />

      {current.caption ? (
        <View style={[styles.captionOverlay, { bottom: insets.bottom + (isMine ? 70 : Spacing.xl) }]}>
          <Text style={styles.captionText}>{current.caption}</Text>
        </View>
      ) : null}

      {isMine ? (
        <Pressable style={[styles.viewersBar, { bottom: insets.bottom + Spacing.md }]} onPress={() => setViewersOpen(true)}>
          <Feather name="eye" size={16} color={Colors.white} />
          <Text style={styles.viewersBarText}>Viewers</Text>
        </Pressable>
      ) : null}

      <ViewersModal storyId={isMine ? current.id : null} visible={viewersOpen} onClose={() => setViewersOpen(false)} />
    </View>
  );
}

export default function StoryViewerScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const { user } = useAuth();
  const { startUserId } = route.params;
  const listRef = useRef<FlatList>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const { data } = useQuery<FeedResponse>({ queryKey: ["/api/stories/feed"] });

  const groups = useMemo<StoryGroup[]>(() => {
    if (!data) return [];
    return data.mine ? [data.mine, ...data.others] : data.others;
  }, [data]);

  const startIndex = Math.max(0, groups.findIndex((g) => g.user?.id === startUserId));

  useEffect(() => {
    setActiveIndex(startIndex);
  }, [startIndex]);

  const handleAdvance = (from: number, dir: 1 | -1) => {
    const next = from + dir;
    if (next < 0 || next >= groups.length) return navigation.goBack();
    listRef.current?.scrollToIndex({ index: next, animated: true });
    setActiveIndex(next);
  };

  if (groups.length === 0) return null;

  return (
    <View style={styles.container}>
      <FlatList
        ref={listRef}
        data={groups}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={startIndex}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        keyExtractor={(g) => g.user?.id ?? "unknown"}
        onMomentumScrollEnd={(e) => setActiveIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item, index }) => (
          <UserStoryPage
            group={item}
            active={index === activeIndex}
            isMine={item.user?.id === user?.id}
            onAdvance={(dir) => handleAdvance(index, dir)}
            onClose={() => navigation.goBack()}
            onDeleted={() => (groups.length <= 1 ? navigation.goBack() : handleAdvance(index, 1))}
          />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  mediaFrame: { width: "100%", alignSelf: "center" },
  media: { width: "100%", height: "100%" },
  progressRow: { position: "absolute", left: Spacing.sm, right: Spacing.sm, flexDirection: "row", gap: 4 },
  progressTrack: { flex: 1, height: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.3)", overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: Colors.white },
  topBar: { position: "absolute", left: Spacing.md, right: Spacing.md, flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  topAvatar: { width: 30, height: 30, borderRadius: 15 },
  topUsername: { color: Colors.white, fontFamily: Fonts.bodyBold, fontSize: 14 },
  topTime: { color: "rgba(255,255,255,0.7)", fontSize: 12 },
  tapLeft: { position: "absolute", left: 0, top: 0, bottom: 0, width: "30%" },
  tapRight: { position: "absolute", right: 0, top: 0, bottom: 0, width: "70%" },
  captionOverlay: { position: "absolute", left: Spacing.lg, right: Spacing.lg, backgroundColor: "rgba(0,0,0,0.55)", borderRadius: BorderRadius.md, padding: Spacing.sm },
  captionText: { color: Colors.white, fontSize: 16, fontFamily: Fonts.bodyBold, textAlign: "center" },
  viewersBar: { position: "absolute", alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: BorderRadius.pill, paddingHorizontal: Spacing.md, paddingVertical: 8 },
  viewersBarText: { color: Colors.white, fontWeight: "700", fontSize: 13 },
  viewersContainer: { flex: 1, backgroundColor: Colors.background },
  viewersHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: Spacing.lg },
  viewersTitle: { ...Typography.h3, color: Colors.text },
  viewerRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, paddingVertical: Spacing.xs },
  viewerAvatar: { width: 32, height: 32, borderRadius: 16 },
  viewerName: { ...Typography.body, color: Colors.text, flex: 1 },
  viewerTime: { ...Typography.small, color: Colors.textMuted },
  emptyText: { ...Typography.small, color: Colors.textMuted, textAlign: "center", marginTop: Spacing.xl },
});
