import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Dimensions, Easing, FlatList, Image, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { radii, spacing, typography } from "../theme/colors";
import { useTheme } from "../lib/ThemeContext";
import type { Palette } from "../theme/palettes";
import { useAuth } from "../lib/AuthContext";
import { api } from "../lib/api";

export interface ChatSessionSummary {
  id: string;
  title: string;
  startedAt: string;
  projectId: string | null;
  activeTask: string | null;
}

interface ChatSideMenuProps {
  visible: boolean;
  onClose: () => void;
  activeSessionId?: string | null;
  onSelectSession: (session: ChatSessionSummary) => void;
  onNewChat: () => void;
}

const DRAWER_WIDTH = Math.min(320, Dimensions.get("window").width * 0.84);

// Everything previously reachable via the bottom tab bar, now reachable
// here instead — see navigation/RootNavigator.tsx's header comment: this
// app has no bottom tab bar by design, permanently.
const NAV_ITEMS: { route: string; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { route: "Chat", label: "Chat", icon: "chatbubble-ellipses-outline" },
  { route: "Camera", label: "Ask with camera", icon: "camera-outline" },
  { route: "Voice", label: "Voice", icon: "call-outline" },
  { route: "Projects", label: "Projects", icon: "code-slash-outline" },
  { route: "Plans", label: "Plans", icon: "flash-outline" },
  { route: "Credits", label: "Credits", icon: "wallet-outline" },
  { route: "Agents", label: "My agents", icon: "hardware-chip-outline" },
  { route: "Settings", label: "Settings", icon: "settings-outline" },
];

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Buckets real session timestamps into Today / Yesterday / Previous 7 Days / Older — not a static label. */
function bucketLabel(startedAt: string): string {
  const today = startOfDay(new Date());
  const day = startOfDay(new Date(startedAt));
  const diffDays = Math.round((today - day) / (24 * 60 * 60 * 1000));
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays <= 7) return "Previous 7 Days";
  return "Older";
}

/**
 * Claude-style side menu — the app's ONLY navigation surface besides the
 * screens' own back buttons (see RootNavigator.tsx: there is no bottom tab
 * bar). Real recent chat sessions (GET /api/chat/sessions), grouped by real
 * date, with a client-side search filter and a footer identifying the
 * actual logged-in user.
 */
export function ChatSideMenu({ visible, onClose, activeSessionId, onSelectSession, onNewChat }: ChatSideMenuProps) {
  const navigation = useNavigation<any>();
  const { palette } = useTheme();
  const { user } = useAuth();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const translateX = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!visible) return;
    Animated.parallel([
      Animated.timing(translateX, { toValue: 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: 260, useNativeDriver: true }),
    ]).start();
    api<{ sessions: ChatSessionSummary[] }>("/api/chat/sessions").then((s) => {
      setSessions(s.sessions.filter((session) => !session.projectId).slice(0, 60));
      setLoaded(true);
    });
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

  const filtered = query.trim() ? sessions.filter((s) => (s.title || "New chat").toLowerCase().includes(query.trim().toLowerCase())) : sessions;

  type Row = { kind: "bucket"; label: string; key: string } | { kind: "session"; session: ChatSessionSummary };
  const rows: Row[] = [];
  let lastBucket: string | null = null;
  for (const session of filtered) {
    const bucket = bucketLabel(session.startedAt);
    if (bucket !== lastBucket) {
      rows.push({ kind: "bucket", label: bucket, key: `bucket-${bucket}-${session.id}` });
      lastBucket = bucket;
    }
    rows.push({ kind: "session", session });
  }

  const initial = (user?.displayName || user?.email || "?").trim().charAt(0).toUpperCase();

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={close}>
      <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
        <TouchableOpacity style={styles.backdropTouchable} activeOpacity={1} onPress={close} />
      </Animated.View>
      <Animated.View style={[styles.drawer, { width: DRAWER_WIDTH, transform: [{ translateX }] }]}>
        <View style={styles.brandRow}>
          <Image source={require("../../../assets/icon-transparent.png")} style={styles.brandIcon} resizeMode="contain" />
          <Text style={styles.brand}>NexaAi</Text>
          <TouchableOpacity onPress={close} style={styles.closeButton}>
            <Ionicons name="close" size={20} color={palette.textMuted} />
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

        <View style={styles.searchRow}>
          <Ionicons name="search" size={16} color={palette.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search chats"
            placeholderTextColor={palette.textMuted}
            value={query}
            onChangeText={setQuery}
          />
        </View>

        <View style={styles.navList}>
          {NAV_ITEMS.map((item) => (
            <TouchableOpacity key={item.route} style={styles.navRow} activeOpacity={0.6} onPress={() => go(item.route)}>
              <Ionicons name={item.icon} size={22} color={palette.textSecondary} />
              <Text style={styles.navLabel}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <FlatList
          data={rows}
          keyExtractor={(item, i) => (item.kind === "bucket" ? item.key : item.session.id)}
          style={styles.list}
          ListHeaderComponent={rows.length ? <Text style={styles.historyLabel}>Chats</Text> : null}
          ListEmptyComponent={loaded ? <Text style={styles.emptyText}>{query ? "No matching chats." : "No chats yet."}</Text> : null}
          renderItem={({ item }) => {
            if (item.kind === "bucket") return <Text style={styles.sectionLabel}>{item.label}</Text>;
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
          }}
        />

        <TouchableOpacity style={styles.profileRow} onPress={() => go("Settings")}>
          <View style={[styles.avatar, { backgroundColor: palette.accent }]}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.profileName} numberOfLines={1}>
              {user?.displayName || "Account"}
            </Text>
            <Text style={styles.profileEmail} numberOfLines={1}>
              {user?.email}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={palette.textMuted} />
        </TouchableOpacity>
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
    },
    brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, marginBottom: spacing.lg },
    brandIcon: { width: 40, height: 40 },
    brand: { ...typography.h1, fontSize: 23, color: palette.textPrimary, flex: 1 },
    closeButton: { padding: 4 },
    newChatButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      marginHorizontal: spacing.lg,
      borderRadius: radii.lg,
      paddingVertical: spacing.sm,
    },
    newChatText: { ...typography.bodyBold, color: "#fff" },
    searchRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginHorizontal: spacing.lg,
      marginTop: spacing.sm,
      backgroundColor: palette.bgCardAlt,
      borderRadius: radii.md,
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
    },
    searchInput: { flex: 1, ...typography.body, color: palette.textPrimary, padding: 0 },
    navList: { marginTop: spacing.md, paddingHorizontal: spacing.sm, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: palette.divider },
    navRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      borderRadius: radii.md,
      marginBottom: 2,
    },
    navLabel: { ...typography.bodyBold, fontSize: 16, color: palette.textPrimary },
    list: { flex: 1 },
    historyLabel: { ...typography.sectionLabel, color: palette.textMuted, textTransform: "uppercase", paddingHorizontal: spacing.lg, marginTop: spacing.sm },
    sectionLabel: { ...typography.sectionLabel, color: palette.textMuted, textTransform: "uppercase", paddingHorizontal: spacing.lg, marginTop: spacing.sm, marginBottom: 2 },
    emptyText: { ...typography.caption, color: palette.textMuted, textAlign: "center", marginTop: spacing.lg },
    row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
    rowActive: { backgroundColor: palette.bgCardAlt },
    rowLabel: { ...typography.body, color: palette.textPrimary, flex: 1 },
    profileRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderTopWidth: 1,
      borderTopColor: palette.border,
    },
    avatar: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
    avatarText: { color: "#fff", fontWeight: "700" },
    profileName: { ...typography.bodyBold, color: palette.textPrimary },
    profileEmail: { ...typography.caption, color: palette.textMuted },
  });
}
