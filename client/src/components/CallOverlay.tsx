import React, { useEffect, useRef } from "react";
import { View, StyleSheet, Text, Pressable, Image, Modal, Platform, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Colors, Spacing, Typography } from "@/constants/theme";
import { resolveImageUrl } from "@/lib/media";
import { useCall } from "@/contexts/CallContext";

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function phaseLabel(phase: string): string {
  if (phase === "outgoing") return "Calling…";
  if (phase === "connecting") return "Connecting…";
  if (phase === "active") return "";
  return "";
}

export function CallOverlay() {
  const insets = useSafeAreaInsets();
  const { phase, peer, durationSec, isMuted, endReason, answerCall, declineCall, endCall, toggleMute } = useCall();
  const lastShownReason = useRef<string | null>(null);

  useEffect(() => {
    if (endReason && endReason !== lastShownReason.current) {
      lastShownReason.current = endReason;
      if (Platform.OS === "web") window.alert(endReason);
      else Alert.alert("Call ended", endReason);
    }
  }, [endReason]);

  const visible = phase !== "idle";
  if (!visible || !peer) return null;

  const isIncoming = phase === "incoming";
  const name = peer.displayName || peer.username;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      <LinearGradient colors={["#0B0716", "#1C1040"]} style={[styles.container, { paddingTop: insets.top + Spacing.xl, paddingBottom: insets.bottom + Spacing.xl }]}>
        <View style={styles.header}>
          {peer.avatarUrl ? (
            <Image source={{ uri: resolveImageUrl(peer.avatarUrl) }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
              <Feather name="user" size={48} color={Colors.textMuted} />
            </View>
          )}
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.status}>{isIncoming ? "Incoming call…" : phase === "active" ? formatDuration(durationSec) : phaseLabel(phase)}</Text>
        </View>

        <View style={styles.actions}>
          {isIncoming ? (
            <View style={styles.incomingRow}>
              <Pressable onPress={declineCall} style={[styles.callButton, styles.declineButton]}>
                <Feather name="phone-off" size={26} color={Colors.white} />
              </Pressable>
              <Pressable onPress={() => void answerCall()} style={[styles.callButton, styles.acceptButton]}>
                <Feather name="phone" size={26} color={Colors.white} />
              </Pressable>
            </View>
          ) : (
            <View style={styles.activeRow}>
              <Pressable onPress={toggleMute} style={[styles.smallButton, isMuted && styles.smallButtonActive]}>
                <Feather name={isMuted ? "mic-off" : "mic"} size={22} color={Colors.white} />
              </Pressable>
              <Pressable onPress={endCall} style={[styles.callButton, styles.declineButton]}>
                <Feather name="phone-off" size={26} color={Colors.white} />
              </Pressable>
            </View>
          )}
        </View>
      </LinearGradient>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "space-between", paddingHorizontal: Spacing.xl },
  header: { alignItems: "center", gap: Spacing.md, marginTop: Spacing.xxl },
  avatar: { width: 120, height: 120, borderRadius: 60, backgroundColor: Colors.surfaceAlt },
  avatarPlaceholder: { alignItems: "center", justifyContent: "center" },
  name: { ...Typography.h2, color: Colors.white },
  status: { ...Typography.body, color: "rgba(255,255,255,0.75)" },
  actions: { width: "100%", alignItems: "center", marginBottom: Spacing.xl },
  incomingRow: { flexDirection: "row", gap: Spacing.xxl, alignItems: "center" },
  activeRow: { flexDirection: "row", gap: Spacing.xl, alignItems: "center" },
  callButton: { width: 68, height: 68, borderRadius: 34, alignItems: "center", justifyContent: "center" },
  acceptButton: { backgroundColor: Colors.success },
  declineButton: { backgroundColor: Colors.danger },
  smallButton: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.15)" },
  smallButtonActive: { backgroundColor: Colors.gold },
});
