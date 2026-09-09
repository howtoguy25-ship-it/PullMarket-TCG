import React, { useCallback, useMemo, useState } from "react";
import { Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { GalaxyBackground } from "../components/GalaxyBackground";
import { radii, spacing, typography } from "../theme/colors";
import { useTheme } from "../lib/ThemeContext";
import type { Palette } from "../theme/palettes";
import { api } from "../lib/api";

interface MemoryEntry {
  id: string;
  content: string;
  createdAt: string;
}

export function MemoryFilesScreen() {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api<{ entries: MemoryEntry[] }>("/api/memory")
      .then((r) => setEntries(r.entries))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(load);

  const deleteOne = async (id: string) => {
    await api(`/api/memory/${id}`, { method: "DELETE" });
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  const clearAll = () => {
    if (entries.length === 0) return;
    Alert.alert("Clear all memory?", "This deletes everything NexaAi remembers about you. This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear all",
        style: "destructive",
        onPress: async () => {
          await api("/api/memory", { method: "DELETE" });
          setEntries([]);
        },
      },
    ]);
  };

  return (
    <GalaxyBackground>
      <View style={styles.header}>
        <Text style={styles.title}>Memory files</Text>
        {entries.length > 0 && (
          <TouchableOpacity onPress={clearAll}>
            <Text style={styles.clearAll}>Clear all</Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={entries}
        keyExtractor={(e) => e.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Ionicons name="sparkles-outline" size={32} color={palette.textMuted} />
              <Text style={styles.emptyText}>
                Nothing remembered yet. As you chat, NexaAi will save durable facts here — you can review or delete any of them
                any time.
              </Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.content}>{item.content}</Text>
            <View style={styles.cardFooter}>
              <Text style={styles.date}>{new Date(item.createdAt).toLocaleDateString()}</Text>
              <TouchableOpacity onPress={() => deleteOne(item.id)}>
                <Ionicons name="trash-outline" size={18} color={palette.danger} />
              </TouchableOpacity>
            </View>
          </View>
        )}
      />
    </GalaxyBackground>
  );
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.lg },
    title: { ...typography.h1, color: palette.textPrimary },
    clearAll: { color: palette.danger, fontWeight: "700" },
    list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.sm },
    card: { backgroundColor: palette.bgCard, borderRadius: radii.md, borderWidth: 1, borderColor: palette.border, padding: spacing.md, gap: spacing.sm },
    content: { ...typography.body, color: palette.textPrimary },
    cardFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    date: { ...typography.caption, color: palette.textMuted },
    empty: { alignItems: "center", gap: spacing.md, padding: spacing.xxl },
    emptyText: { ...typography.body, color: palette.textMuted, textAlign: "center" },
  });
}
