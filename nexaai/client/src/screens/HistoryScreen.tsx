import React, { useCallback, useMemo, useState } from "react";
import { FlatList, Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { GalaxyBackground } from "../components/GalaxyBackground";
import { radii, spacing, typography } from "../theme/colors";
import { useTheme } from "../lib/ThemeContext";
import type { Palette } from "../theme/palettes";
import { api, API_URL, ApiError } from "../lib/api";
import { Alert } from "../lib/alert";

interface HistoryAttachment {
  url: string;
  filename: string;
  mimeType: string;
  kind: "image" | "video" | "file";
}

interface HistoryItem {
  id: string;
  sessionId: string;
  sessionTitle: string;
  kind: string;
  content: string;
  metadata: HistoryAttachment | null;
  createdAt: string;
}

/**
 * Real cross-session history: every prompt/image/video this account has
 * ever sent, in one list, with a real working multi-select + delete — see
 * server/src/routes/history.ts. Deleting here is a real "remove this from
 * my history" outcome for the user (it disappears here and from the
 * session it came from); it does not erase NexaAi's own permanent record,
 * which stays available to the account owner (Settings copy below says so
 * plainly, and so does the Privacy policy).
 */
export function HistoryScreen() {
  const { palette } = useTheme();
  const navigation = useNavigation<any>();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setSelectMode(false);
    setSelectedIds(new Set());
    api<{ items: HistoryItem[]; nextCursor: string | null }>("/api/history")
      .then((r) => {
        setItems(r.items);
        setNextCursor(r.nextCursor);
      })
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(load);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await api<{ items: HistoryItem[]; nextCursor: string | null }>(`/api/history?cursor=${encodeURIComponent(nextCursor)}`);
      setItems((prev) => [...prev, ...r.items]);
      setNextCursor(r.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const deleteOne = async (id: string) => {
    try {
      await api(`/api/history/${id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      Alert.alert("Couldn't delete", err instanceof ApiError ? err.message : "Try again in a moment.");
    }
  };

  const deleteSelected = () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    Alert.alert(
      `Remove ${count} item${count === 1 ? "" : "s"} from history?`,
      "This removes them from your History and from the chats they're in. This can't be undone from here.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            setDeleting(true);
            try {
              const ids = Array.from(selectedIds);
              await api("/api/history/bulk-delete", { method: "POST", body: JSON.stringify({ ids }) });
              setItems((prev) => prev.filter((i) => !selectedIds.has(i.id)));
              setSelectedIds(new Set());
              setSelectMode(false);
            } catch (err) {
              Alert.alert("Couldn't delete", err instanceof ApiError ? err.message : "Try again in a moment.");
            } finally {
              setDeleting(false);
            }
          },
        },
      ],
    );
  };

  return (
    <GalaxyBackground>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>History</Text>
          <Text style={styles.subtitle}>Every prompt, image, and video you've sent — select any to remove them.</Text>
        </View>
        {items.length > 0 && (
          <TouchableOpacity
            onPress={() => {
              setSelectMode((v) => !v);
              setSelectedIds(new Set());
            }}
          >
            <Text style={styles.selectToggle}>{selectMode ? "Cancel" : "Select"}</Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        contentContainerStyle={styles.list}
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Ionicons name="time-outline" size={32} color={palette.textMuted} />
              <Text style={styles.emptyText}>Nothing here yet. Every prompt, photo, and video you send will show up here.</Text>
            </View>
          ) : null
        }
        ListFooterComponent={
          nextCursor ? (
            <TouchableOpacity style={styles.loadMoreBtn} onPress={loadMore} disabled={loadingMore}>
              <Text style={styles.loadMoreText}>{loadingMore ? "Loading…" : "Load more"}</Text>
            </TouchableOpacity>
          ) : null
        }
        renderItem={({ item }) => {
          const selected = selectedIds.has(item.id);
          return (
            <TouchableOpacity
              style={[styles.card, selected && styles.cardSelected]}
              activeOpacity={0.8}
              onPress={() => (selectMode ? toggleSelected(item.id) : navigation.navigate("Chat", { openSessionId: item.sessionId }))}
              onLongPress={() => {
                setSelectMode(true);
                toggleSelected(item.id);
              }}
            >
              <View style={styles.cardTopRow}>
                {selectMode && (
                  <Ionicons
                    name={selected ? "checkmark-circle" : "ellipse-outline"}
                    size={20}
                    color={selected ? palette.accentBright : palette.textMuted}
                  />
                )}
                <Text style={styles.sessionTitle} numberOfLines={1}>
                  {item.sessionTitle}
                </Text>
                <Text style={styles.date}>{new Date(item.createdAt).toLocaleDateString()}</Text>
              </View>

              {item.metadata?.url && item.metadata.kind === "image" && (
                <Image source={{ uri: `${API_URL}${item.metadata.url}` }} style={styles.thumbnail} resizeMode="cover" />
              )}
              {item.metadata?.url && item.metadata.kind !== "image" && (
                <View style={styles.fileChip}>
                  <Ionicons name={item.metadata.kind === "video" ? "videocam-outline" : "document-outline"} size={14} color={palette.textSecondary} />
                  <Text style={styles.fileChipText} numberOfLines={1}>
                    {item.metadata.filename}
                  </Text>
                </View>
              )}

              <Text style={styles.content} numberOfLines={3}>
                {item.content}
              </Text>

              <View style={styles.cardDivider} />
              <View style={styles.cardFooter}>
                <Text style={styles.time}>{new Date(item.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</Text>
                {!selectMode && (
                  <TouchableOpacity onPress={() => deleteOne(item.id)} hitSlop={8}>
                    <Ionicons name="trash-outline" size={17} color={palette.danger} />
                  </TouchableOpacity>
                )}
              </View>
            </TouchableOpacity>
          );
        }}
      />

      {selectMode && selectedIds.size > 0 && (
        <View style={styles.selectionBar}>
          <Text style={styles.selectionBarText}>{selectedIds.size} selected</Text>
          <TouchableOpacity style={styles.deleteSelectedBtn} onPress={deleteSelected} disabled={deleting}>
            <Ionicons name="trash-outline" size={16} color="#fff" />
            <Text style={styles.deleteSelectedText}>{deleting ? "Removing…" : "Delete selected"}</Text>
          </TouchableOpacity>
        </View>
      )}
    </GalaxyBackground>
  );
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", padding: spacing.lg, gap: spacing.sm },
    title: { ...typography.h1, color: palette.textPrimary },
    subtitle: { ...typography.caption, color: palette.textMuted, marginTop: 2, maxWidth: 280 },
    selectToggle: { color: palette.accentBright, fontWeight: "700", paddingTop: 4 },

    list: { paddingHorizontal: spacing.lg, paddingBottom: 100, gap: spacing.sm },
    card: { backgroundColor: palette.bgCard, borderRadius: radii.md, borderWidth: 1, borderColor: palette.border, padding: spacing.md, gap: 6, marginBottom: spacing.sm },
    cardSelected: { borderColor: palette.accentBright, borderWidth: 1.5 },
    cardTopRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    sessionTitle: { ...typography.caption, color: palette.textMuted, fontWeight: "700", flex: 1, textTransform: "uppercase", fontSize: 10, letterSpacing: 0.4 },
    date: { ...typography.caption, color: palette.textMuted, fontSize: 10 },
    thumbnail: { width: "100%", aspectRatio: 16 / 9, borderRadius: 8, backgroundColor: palette.border },
    fileChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: palette.bgCardAlt, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 8 },
    fileChipText: { ...typography.caption, color: palette.textSecondary, flexShrink: 1 },
    content: { ...typography.body, color: palette.textPrimary },
    cardDivider: { height: 1, backgroundColor: palette.border, opacity: 0.6, marginTop: 2 },
    cardFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 4 },
    time: { ...typography.caption, color: palette.textMuted },

    empty: { alignItems: "center", gap: spacing.md, padding: spacing.xxl },
    emptyText: { ...typography.body, color: palette.textMuted, textAlign: "center" },
    loadMoreBtn: { alignItems: "center", paddingVertical: spacing.md },
    loadMoreText: { ...typography.caption, color: palette.accentBright, fontWeight: "700" },

    selectionBar: {
      position: "absolute",
      left: spacing.lg,
      right: spacing.lg,
      bottom: spacing.lg,
      backgroundColor: palette.bgCard,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.lg,
      padding: spacing.md,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      shadowColor: "#000",
      shadowOpacity: 0.3,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 6,
    },
    selectionBarText: { ...typography.body, color: palette.textPrimary, fontWeight: "700" },
    deleteSelectedBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: palette.danger, borderRadius: radii.pill, paddingVertical: 8, paddingHorizontal: 14 },
    deleteSelectedText: { ...typography.caption, color: "#fff", fontWeight: "700" },
  });
}
