import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Dimensions, Easing, FlatList, Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { radii, spacing, typography } from "../theme/colors";
import { useTheme } from "../lib/ThemeContext";
import type { Palette } from "../theme/palettes";
import { api } from "../lib/api";

export interface ChatSessionSummary {
  id: string;
  title: string;
  startedAt: string;
  projectId: string | null;
}

interface ProjectSummary {
  id: string;
  title: string;
  lastMessagePreview: string | null;
  lastActivityAt: string;
}

interface ChatSideMenuProps {
  visible: boolean;
  onClose: () => void;
  activeSessionId?: string | null;
  onSelectSession: (session: ChatSessionSummary) => void;
  onNewChat: () => void;
}

const DRAWER_WIDTH = Math.min(320, Dimensions.get("window").width * 0.84);

/**
 * Claude-style side menu — a real slide-out drawer off Chat's header, not
 * just a static list: real recent chat sessions and real Projects
 * (GET /api/chat/sessions, GET /api/projects), tapping one actually loads
 * it, plus quick links to the rest of the app. Same idea as Claude's own
 * sidebar (Chats / Projects / Settings), scoped to what NexaAi already has.
 */
export function ChatSideMenu({ visible, onClose, activeSessionId, onSelectSession, onNewChat }: ChatSideMenuProps) {
  const navigation = useNavigation<any>();
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const translateX = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!visible) return;
    Animated.parallel([
      Animated.timing(translateX, { toValue: 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: 260, useNativeDriver: true }),
    ]).start();
    Promise.all([api<{ sessions: ChatSessionSummary[] }>("/api/chat/sessions"), api<{ projects: ProjectSummary[] }>("/api/projects")]).then(
      ([s, p]) => {
        setSessions(s.sessions.filter((session) => !session.projectId).slice(0, 25));
        setProjects(p.projects.slice(0, 15));
        setLoaded(true);
      },
    );
  }, [visible, translateX, backdropOpacity]);

  const close = () => {
    Animated.parallel([
      Animated.timing(translateX, { toValue: -DRAWER_WIDTH, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start(({ finished }) => finished && onClose());
  };

  const go = (screen: string) => {
    close();
    navigation.navigate(screen);
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={close}>
      <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
        <TouchableOpacity style={styles.backdropTouchable} activeOpacity={1} onPress={close} />
      </Animated.View>
      <Animated.View style={[styles.drawer, { width: DRAWER_WIDTH, transform: [{ translateX }] }]}>
        <View style={styles.header}>
          <Text style={styles.brand}>✦ NexaAi</Text>
          <TouchableOpacity onPress={close}>
            <Ionicons name="close" size={22} color={palette.textMuted} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          testID="side-menu-new-chat"
          style={[styles.newChatButton, { backgroundColor: palette.accent }]}
          onPress={() => {
            close();
            onNewChat();
          }}
        >
          <Ionicons name="add" size={18} color="#fff" />
          <Text style={styles.newChatText}>New chat</Text>
        </TouchableOpacity>

        <FlatList
          data={[{ kind: "header-recent" as const }, ...sessions.map((s) => ({ kind: "session" as const, session: s })), { kind: "header-projects" as const }, ...projects.map((p) => ({ kind: "project" as const, project: p }))]}
          keyExtractor={(item, i) =>
            item.kind === "session" ? item.session.id : item.kind === "project" ? item.project.id : `${item.kind}-${i}`
          }
          style={styles.list}
          ListEmptyComponent={loaded ? <Text style={styles.emptyText}>No chats yet.</Text> : null}
          renderItem={({ item }) => {
            if (item.kind === "header-recent") return sessions.length ? <Text style={styles.sectionLabel}>Recent</Text> : null;
            if (item.kind === "header-projects") return projects.length ? <Text style={styles.sectionLabel}>Projects</Text> : null;
            if (item.kind === "session") {
              const s = item.session;
              return (
                <TouchableOpacity
                  style={[styles.row, s.id === activeSessionId && styles.rowActive]}
                  onPress={() => {
                    close();
                    onSelectSession(s);
                  }}
                >
                  <Ionicons name="chatbubble-outline" size={16} color={palette.textMuted} />
                  <Text style={styles.rowLabel} numberOfLines={1}>
                    {s.title || "New chat"}
                  </Text>
                </TouchableOpacity>
              );
            }
            const p = item.project;
            return (
              <TouchableOpacity
                style={styles.row}
                onPress={() => {
                  close();
                  navigation.navigate("ProjectChat", { projectId: p.id, projectTitle: p.title });
                }}
              >
                <Ionicons name="code-slash-outline" size={16} color={palette.textMuted} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel} numberOfLines={1}>
                    {p.title}
                  </Text>
                  {p.lastMessagePreview && (
                    <Text style={styles.rowPreview} numberOfLines={1}>
                      {p.lastMessagePreview}
                    </Text>
                  )}
                </View>
              </TouchableOpacity>
            );
          }}
        />

        <View style={styles.footer}>
          <TouchableOpacity style={styles.footerRow} onPress={() => go("Plans")}>
            <Ionicons name="flash-outline" size={16} color={palette.textMuted} />
            <Text style={styles.footerLabel}>Plans</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.footerRow} onPress={() => go("Credits")}>
            <Ionicons name="wallet-outline" size={16} color={palette.textMuted} />
            <Text style={styles.footerLabel}>Credits</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.footerRow} onPress={() => go("Settings")}>
            <Ionicons name="settings-outline" size={16} color={palette.textMuted} />
            <Text style={styles.footerLabel}>Settings</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </Modal>
  );
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  backdropTouchable: { flex: 1 },
  drawer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: palette.bgElevated,
    borderRightWidth: 1,
    borderRightColor: palette.border,
    paddingTop: 56,
    paddingBottom: spacing.lg,
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, marginBottom: spacing.md },
  brand: { ...typography.bodyBold, color: palette.textPrimary, fontSize: 16 },
  newChatButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginHorizontal: spacing.lg, borderRadius: radii.md, paddingVertical: spacing.sm },
  newChatText: { color: "#fff", fontWeight: "700" },
  list: { flex: 1, marginTop: spacing.md },
  sectionLabel: { ...typography.caption, color: palette.textMuted, fontWeight: "700", textTransform: "uppercase", paddingHorizontal: spacing.lg, marginTop: spacing.md, marginBottom: spacing.xs },
  emptyText: { ...typography.caption, color: palette.textMuted, textAlign: "center", marginTop: spacing.lg },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  rowActive: { backgroundColor: palette.bgCardAlt },
  rowLabel: { ...typography.body, color: palette.textPrimary, flex: 1 },
  rowPreview: { ...typography.caption, color: palette.textMuted },
  footer: { borderTopWidth: 1, borderTopColor: palette.border, paddingTop: spacing.sm },
  footerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  footerLabel: { ...typography.body, color: palette.textSecondary },
  });
}
