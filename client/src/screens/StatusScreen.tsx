import React from "react";
import { View, StyleSheet, Text, FlatList, Pressable, Image } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { Colors, Spacing, Typography, BorderRadius, Fonts } from "@/constants/theme";
import { EmptyState } from "@/components/ui";
import { RootStackParamList } from "@/navigation/types";
import { resolveImageUrl } from "@/lib/media";
import { useAuth } from "@/contexts/AuthContext";

type Nav = NativeStackNavigationProp<RootStackParamList>;

interface StoryItem {
  id: string;
  mediaType: "image" | "video";
  mediaUrl: string;
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
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function Avatar({ url, ring, size = 54 }: { url: string | null | undefined; ring: "unseen" | "seen" | "none"; size?: number }) {
  const ringColor = ring === "unseen" ? Colors.primary : ring === "seen" ? Colors.border : "transparent";
  return (
    <View style={[styles.ringWrap, { width: size + 6, height: size + 6, borderRadius: (size + 6) / 2, borderColor: ringColor, borderWidth: ring === "none" ? 0 : 2.5 }]}>
      {url ? (
        <Image source={{ uri: resolveImageUrl(url) }} style={{ width: size, height: size, borderRadius: size / 2 }} />
      ) : (
        <View style={[styles.avatarPlaceholder, { width: size, height: size, borderRadius: size / 2 }]}>
          <Feather name="user" size={size * 0.5} color={Colors.textMuted} />
        </View>
      )}
    </View>
  );
}

export default function StatusScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const { data, isLoading } = useQuery<FeedResponse>({ queryKey: ["/api/stories/feed"], refetchInterval: 20_000 });

  useFocusEffect(
    React.useCallback(() => {
      queryClient.invalidateQueries({ queryKey: ["/api/stories/feed"] });
    }, [queryClient]),
  );

  const mine = data?.mine ?? null;
  const others = data?.others ?? [];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Status</Text>
      </View>

      <FlatList
        data={others}
        keyExtractor={(g) => g.user!.id}
        contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xl }}
        ListHeaderComponent={
          <>
            <Pressable
              style={styles.myRow}
              onPress={() => (mine ? navigation.navigate("StoryViewer", { startUserId: user!.id }) : navigation.navigate("StoryCreate"))}
            >
              <View>
                <Avatar url={user?.avatarUrl} ring={mine ? "seen" : "none"} />
                <Pressable style={styles.addBadge} onPress={() => navigation.navigate("StoryCreate")} hitSlop={8}>
                  <Feather name="plus" size={13} color={Colors.white} />
                </Pressable>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.myRowTitle}>My status</Text>
                <Text style={styles.myRowSub}>{mine ? `${mine.stories.length} update${mine.stories.length > 1 ? "s" : ""} · tap to view` : "Tap to add a status update"}</Text>
              </View>
            </Pressable>

            {others.length > 0 ? <Text style={styles.sectionLabel}>Recent updates</Text> : null}
          </>
        }
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => navigation.navigate("StoryViewer", { startUserId: item.user!.id })}>
            <Avatar url={item.user?.avatarUrl} ring={item.hasUnseen ? "unseen" : "seen"} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>@{item.user?.username}</Text>
              <Text style={styles.rowSub}>{timeAgo(item.latestAt)}</Text>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          !isLoading ? (
            <EmptyState icon={<Feather name="camera" size={40} color={Colors.textMuted} />} title="No status updates yet" subtitle="When friends post a status, it'll show up here." />
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
  headerTitle: { fontSize: 26, fontFamily: Fonts.display, color: Colors.text },
  ringWrap: { alignItems: "center", justifyContent: "center" },
  avatarPlaceholder: { backgroundColor: Colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
  addBadge: { position: "absolute", bottom: 0, right: 0, width: 22, height: 22, borderRadius: 11, backgroundColor: Colors.primary, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: Colors.background },
  myRow: { flexDirection: "row", alignItems: "center", gap: Spacing.md, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
  myRowTitle: { ...Typography.bodyBold, color: Colors.text },
  myRowSub: { ...Typography.small, color: Colors.textMuted, marginTop: 2 },
  sectionLabel: { ...Typography.small, color: Colors.textMuted, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, paddingHorizontal: Spacing.lg, marginTop: Spacing.sm, marginBottom: Spacing.xs },
  row: { flexDirection: "row", alignItems: "center", gap: Spacing.md, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  rowTitle: { ...Typography.bodyBold, color: Colors.text },
  rowSub: { ...Typography.small, color: Colors.textMuted, marginTop: 2 },
});
