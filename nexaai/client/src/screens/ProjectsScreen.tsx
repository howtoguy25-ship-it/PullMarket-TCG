import React, { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { GalaxyBackground } from "../components/GalaxyBackground";
import { colors, radii, spacing, typography } from "../theme/colors";
import { useTheme } from "../lib/ThemeContext";
import { api } from "../lib/api";

interface ProjectVM {
  id: string;
  title: string;
  createdAt: string;
  lastActivityAt: string;
  lastMessagePreview: string | null;
}

/**
 * Real projects, each a named workspace for building one specific
 * site/app — with real, persisted chat history (server/src/routes/projects.ts),
 * not client-side-only state. "Recent chats" here is a live query, not a mock.
 */
export function ProjectsScreen() {
  const navigation = useNavigation<any>();
  const { palette } = useTheme();
  const [projects, setProjects] = useState<ProjectVM[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api<{ projects: ProjectVM[] }>("/api/projects")
      .then((r) => setProjects(r.projects))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(load);

  const createProject = async () => {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const { project } = await api<{ project: ProjectVM }>("/api/projects", { method: "POST", body: JSON.stringify({ title: newTitle.trim() }) });
      setCreateOpen(false);
      setNewTitle("");
      navigation.navigate("ProjectChat", { projectId: project.id, projectTitle: project.title });
      load();
    } finally {
      setCreating(false);
    }
  };

  return (
    <GalaxyBackground>
      <View style={styles.header}>
        <Text style={styles.title}>Projects</Text>
        <Text style={styles.subtitle}>A named workspace for building one specific site or app — real code, real history, picked back up anytime.</Text>
      </View>

      <TouchableOpacity style={[styles.newButton, { backgroundColor: palette.accent }]} onPress={() => setCreateOpen(true)}>
        <Ionicons name="add" size={18} color="#fff" />
        <Text style={styles.newButtonText}>New project</Text>
      </TouchableOpacity>

      {loading ? (
        <ActivityIndicator style={styles.loading} color={palette.accentBright} />
      ) : (
        <FlatList
          data={projects}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.emptyText}>No projects yet — start one above.</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.row}
              onPress={() => navigation.navigate("ProjectChat", { projectId: item.id, projectTitle: item.title })}
            >
              <View style={styles.rowIcon}>
                <Ionicons name="code-slash" size={18} color={palette.accentBright} />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{item.title}</Text>
                <Text style={styles.rowPreview} numberOfLines={1}>
                  {item.lastMessagePreview ?? "No messages yet"}
                </Text>
                <Text style={styles.rowMeta}>{new Date(item.lastActivityAt).toLocaleString()}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        />
      )}

      <Modal visible={createOpen} transparent animationType="fade" onRequestClose={() => setCreateOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>New project</Text>
            <Text style={styles.modalSubtitle}>Give it a name — e.g. "Portfolio site" or "Client landing page".</Text>
            <TextInput style={styles.input} placeholder="Project name" placeholderTextColor={colors.textMuted} value={newTitle} onChangeText={setNewTitle} autoFocus />
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalCancelButton} onPress={() => setCreateOpen(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalContinueButton, { backgroundColor: palette.accent }]} onPress={createProject} disabled={creating}>
                {creating ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalContinueText}>Continue</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </GalaxyBackground>
  );
}

const styles = StyleSheet.create({
  header: { padding: spacing.lg, gap: spacing.xs },
  title: { ...typography.h1, color: colors.textPrimary },
  subtitle: { ...typography.body, color: colors.textSecondary },
  newButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    borderRadius: radii.pill,
    paddingVertical: spacing.md,
  },
  newButtonText: { color: "#fff", fontWeight: "700" },
  loading: { marginTop: spacing.lg },
  list: { padding: spacing.lg, gap: spacing.sm },
  emptyText: { ...typography.body, color: colors.textMuted, textAlign: "center", marginTop: spacing.lg },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.bgCard,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  rowIcon: { width: 36, height: 36, borderRadius: radii.md, backgroundColor: colors.bgCardAlt, alignItems: "center", justifyContent: "center" },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { ...typography.bodyBold, color: colors.textPrimary },
  rowPreview: { ...typography.caption, color: colors.textSecondary },
  rowMeta: { ...typography.caption, color: colors.textMuted },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  modalCard: { width: "100%", maxWidth: 380, backgroundColor: colors.bgCard, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.sm },
  modalTitle: { ...typography.h2, color: colors.textPrimary },
  modalSubtitle: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.sm },
  input: { backgroundColor: colors.bgCardAlt, borderRadius: radii.md, padding: spacing.md, color: colors.textPrimary },
  modalButtons: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  modalCancelButton: { flex: 1, backgroundColor: colors.bgCardAlt, borderRadius: radii.md, padding: spacing.md, alignItems: "center" },
  modalCancelText: { color: colors.textSecondary, fontWeight: "700" },
  modalContinueButton: { flex: 1, borderRadius: radii.md, padding: spacing.md, alignItems: "center" },
  modalContinueText: { color: "#fff", fontWeight: "700" },
});
