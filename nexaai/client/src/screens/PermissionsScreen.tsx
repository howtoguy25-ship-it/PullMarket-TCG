import React, { useCallback, useState } from "react";
import { Platform, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { Camera } from "expo-camera";
import { Audio } from "expo-av";
import * as Location from "expo-location";
import * as Calendar from "expo-calendar";
import * as Linking from "expo-linking";
import { GalaxyBackground } from "../components/GalaxyBackground";
import { colors, radii, spacing, typography } from "../theme/colors";
import { useTheme } from "../lib/ThemeContext";

type PermStatus = "granted" | "denied" | "undetermined" | "unsupported";

interface Row {
  key: string;
  label: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  get: () => Promise<PermStatus>;
  request: () => Promise<PermStatus>;
}

const ROWS: Row[] = [
  {
    key: "camera",
    label: "Camera",
    description: "For camera-ask and card-style photo capture.",
    icon: "camera",
    get: async () => toStatus(await Camera.getCameraPermissionsAsync()),
    request: async () => toStatus(await Camera.requestCameraPermissionsAsync()),
  },
  {
    key: "microphone",
    label: "Microphone",
    description: "For voice memos and live voice chat.",
    icon: "mic",
    get: async () => toStatus(await Audio.getPermissionsAsync()),
    request: async () => toStatus(await Audio.requestPermissionsAsync()),
  },
  {
    key: "location",
    label: "Location",
    description: "To find the closest business for real-world assistance.",
    icon: "location",
    get: async () => toStatus(await Location.getForegroundPermissionsAsync()),
    request: async () => toStatus(await Location.requestForegroundPermissionsAsync()),
  },
  {
    key: "calendar",
    label: "Calendar",
    description: "So NexaAi can factor your schedule into its answers.",
    icon: "calendar",
    get: async () => toStatus(await Calendar.getCalendarPermissionsAsync()),
    request: async () => toStatus(await Calendar.requestCalendarPermissionsAsync()),
  },
  {
    key: "reminders",
    label: "Reminders",
    description: Platform.OS === "ios" ? "So NexaAi can factor your to-dos into its answers." : "iOS only — Android has no Reminders API.",
    icon: "checkbox",
    get: async () => (Platform.OS === "ios" ? toStatus(await Calendar.getRemindersPermissionsAsync()) : "unsupported"),
    request: async () => (Platform.OS === "ios" ? toStatus(await Calendar.requestRemindersPermissionsAsync()) : "unsupported"),
  },
];

function toStatus(response: { status: string; granted?: boolean }): PermStatus {
  if (response.granted || response.status === "granted") return "granted";
  if (response.status === "denied") return "denied";
  return "undetermined";
}

function statusLabel(status: PermStatus): string {
  switch (status) {
    case "granted":
      return "Allowed";
    case "denied":
      return "Denied";
    case "unsupported":
      return "Not available";
    default:
      return "Not asked yet";
  }
}

export function PermissionsScreen() {
  const { palette } = useTheme();
  const [statuses, setStatuses] = useState<Record<string, PermStatus>>({});

  const refresh = useCallback(() => {
    Promise.all(ROWS.map((row) => row.get().then((status) => [row.key, status] as const))).then((entries) =>
      setStatuses(Object.fromEntries(entries)),
    );
  }, []);

  // Re-checks every time this screen gains focus — the only way to see a
  // permission the user just changed from the system Settings app, since
  // an app can't be told about that change any other way.
  useFocusEffect(refresh);

  const onToggle = async (row: Row) => {
    const current = statuses[row.key];
    if (current === "unsupported") return;
    if (current === "granted") {
      // Apps cannot revoke their own OS permission grants — the only real
      // path is the system Settings app.
      Linking.openSettings();
      return;
    }
    const next = await row.request();
    setStatuses((prev) => ({ ...prev, [row.key]: next }));
    if (next === "denied") Linking.openSettings();
  };

  return (
    <GalaxyBackground>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Permissions</Text>
        <Text style={styles.subtitle}>What NexaAi can access on this device — toggling on requests it for real; toggling off an already-granted permission opens system Settings, since only iOS/Android let you revoke it there.</Text>

        <View style={styles.card}>
          {ROWS.map((row, i) => {
            const status = statuses[row.key] ?? "undetermined";
            return (
              <View key={row.key} style={[styles.row, i < ROWS.length - 1 && styles.rowBorder]}>
                <View style={styles.iconWrap}>
                  <Ionicons name={row.icon} size={18} color={palette.accentBright} />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel}>{row.label}</Text>
                  <Text style={styles.rowDescription}>{row.description}</Text>
                  <Text style={[styles.rowStatus, status === "granted" && styles.rowStatusGranted]}>{statusLabel(status)}</Text>
                </View>
                <Switch
                  value={status === "granted"}
                  disabled={status === "unsupported"}
                  onValueChange={() => onToggle(row)}
                  trackColor={{ true: palette.accent }}
                />
              </View>
            );
          })}
        </View>
      </ScrollView>
    </GalaxyBackground>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.lg },
  title: { ...typography.h1, color: colors.textPrimary },
  subtitle: { ...typography.body, color: colors.textSecondary },
  card: { backgroundColor: colors.bgCard, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  iconWrap: { width: 36, height: 36, borderRadius: radii.md, backgroundColor: colors.bgCardAlt, alignItems: "center", justifyContent: "center" },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { ...typography.bodyBold, color: colors.textPrimary },
  rowDescription: { ...typography.caption, color: colors.textMuted },
  rowStatus: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  rowStatusGranted: { color: colors.success },
});
