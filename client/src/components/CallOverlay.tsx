import React, { useEffect, useRef, useState } from "react";
import { View, StyleSheet, Text, Pressable, Image, Modal, Platform, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Colors, Spacing, Typography } from "@/constants/theme";
import { resolveImageUrl } from "@/lib/media";
import { useCall } from "@/contexts/CallContext";
import { AudioRoutePickerView } from "audio-route-picker";

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

// On iOS this renders Apple's real system route picker (AVRoutePickerView)
// — the same control FaceTime uses — so a user with a Bluetooth headset
// connected gets the actual "Speaker / iPhone / [device name]" menu,
// instead of a plain on/off toggle that can't reach Bluetooth at all.
// react-native-incall-manager's route-switching API only exists on
// Android, so Android keeps the simple InCallManager-driven toggle.
function SpeakerButton({ isSpeakerOn, onToggle }: { isSpeakerOn: boolean; onToggle: () => void }) {
  if (Platform.OS === "ios") {
    return (
      <View style={[styles.smallButton, isSpeakerOn && styles.smallButtonActive]}>
        <AudioRoutePickerView style={StyleSheet.absoluteFillObject} tintColor={Colors.white} activeTintColor={Colors.gold} />
        <Feather name="volume-2" size={22} color={Colors.white} />
      </View>
    );
  }
  return (
    <Pressable onPress={onToggle} style={[styles.smallButton, isSpeakerOn && styles.smallButtonActive]}>
      <Feather name={isSpeakerOn ? "volume-2" : "volume-1"} size={22} color={Colors.white} />
    </Pressable>
  );
}

// react-native-webrtc's RTCView is a native view with no web build — like
// the rest of the calling stack, it's loaded dynamically and only on
// native so importing this file never touches the web bundle. Held in
// component state (rather than the module-level ref pattern CallContext
// uses) because it needs to be an actual value to render as JSX, not just
// something called imperatively.
export function CallOverlay() {
  const insets = useSafeAreaInsets();
  const { phase, peer, durationSec, isMuted, isSpeakerOn, isVideo, localStream, remoteStream, endReason, answerCall, declineCall, endCall, toggleMute, toggleSpeaker } = useCall();
  const lastShownReason = useRef<string | null>(null);
  const [RTCView, setRTCView] = useState<typeof import("react-native-webrtc").RTCView | null>(null);

  useEffect(() => {
    if (Platform.OS === "web") return;
    import("react-native-webrtc").then((m) => setRTCView(() => m.RTCView));
  }, []);

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
  // "outgoing" is included here (not just connecting/active) because the
  // caller's own camera is already live the moment they place a video
  // call — attachLocalMedia runs synchronously inside startCall, well
  // before the callee answers. Gating this to connecting/active only
  // left the caller staring at a plain gradient with no camera preview
  // for the entire "Calling…" ring — the local stream existed the whole
  // time, it just was never rendered.
  const isVideoPhase = phase === "outgoing" || phase === "connecting" || phase === "active";
  const showVideo = isVideo && RTCView && isVideoPhase;
  const name = peer.displayName || peer.username;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      {showVideo ? (
        <View style={styles.videoContainer}>
          {remoteStream ? (
            <RTCView streamURL={remoteStream.toURL()} style={styles.remoteVideo} objectFit="cover" />
          ) : localStream ? (
            // No remote video yet (still ringing/connecting) — show the
            // caller's own camera full-screen so it's obvious the camera
            // is actually working, instead of an empty gradient.
            <RTCView streamURL={localStream.toURL()} style={styles.remoteVideo} objectFit="cover" mirror />
          ) : (
            <LinearGradient colors={["#0B0716", "#1C1040"]} style={styles.remoteVideo} />
          )}
          {localStream && remoteStream ? <RTCView streamURL={localStream.toURL()} style={styles.localVideo} objectFit="cover" mirror zOrder={1} /> : null}
          <View style={[styles.videoOverlayTop, { paddingTop: insets.top + Spacing.md }]}>
            <Text style={styles.name}>{name}</Text>
            <Text style={styles.status}>{phase === "active" ? formatDuration(durationSec) : phaseLabel(phase)}</Text>
          </View>
          <View style={[styles.videoOverlayBottom, { paddingBottom: insets.bottom + Spacing.xl }]}>
            <View style={styles.activeRow}>
              <Pressable onPress={toggleMute} style={[styles.smallButton, isMuted && styles.smallButtonActive]}>
                <Feather name={isMuted ? "mic-off" : "mic"} size={22} color={Colors.white} />
              </Pressable>
              <SpeakerButton isSpeakerOn={isSpeakerOn} onToggle={toggleSpeaker} />
              <Pressable onPress={endCall} style={[styles.callButton, styles.declineButton]}>
                <Feather name="phone-off" size={26} color={Colors.white} />
              </Pressable>
            </View>
          </View>
        </View>
      ) : (
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
            <Text style={styles.status}>
              {isIncoming ? (isVideo ? "Incoming video call…" : "Incoming call…") : phase === "active" ? formatDuration(durationSec) : phaseLabel(phase)}
            </Text>
            {isVideo ? (
              <View style={styles.videoBadge}>
                <Feather name="video" size={12} color={Colors.white} />
                <Text style={styles.videoBadgeText}>Video call</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.actions}>
            {isIncoming ? (
              <View style={styles.incomingRow}>
                <Pressable onPress={declineCall} style={[styles.callButton, styles.declineButton]}>
                  <Feather name="phone-off" size={26} color={Colors.white} />
                </Pressable>
                <Pressable onPress={() => void answerCall()} style={[styles.callButton, styles.acceptButton]}>
                  <Feather name={isVideo ? "video" : "phone"} size={26} color={Colors.white} />
                </Pressable>
              </View>
            ) : (
              <View style={styles.activeRow}>
                <Pressable onPress={toggleMute} style={[styles.smallButton, isMuted && styles.smallButtonActive]}>
                  <Feather name={isMuted ? "mic-off" : "mic"} size={22} color={Colors.white} />
                </Pressable>
                <SpeakerButton isSpeakerOn={isSpeakerOn} onToggle={toggleSpeaker} />
                <Pressable onPress={endCall} style={[styles.callButton, styles.declineButton]}>
                  <Feather name="phone-off" size={26} color={Colors.white} />
                </Pressable>
              </View>
            )}
          </View>
        </LinearGradient>
      )}
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
  videoBadge: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(255,255,255,0.15)", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, marginTop: 4 },
  videoBadgeText: { fontSize: 11, fontWeight: "700", color: Colors.white },
  actions: { width: "100%", alignItems: "center", marginBottom: Spacing.xl },
  incomingRow: { flexDirection: "row", gap: Spacing.xxl, alignItems: "center" },
  activeRow: { flexDirection: "row", gap: Spacing.xl, alignItems: "center" },
  callButton: { width: 68, height: 68, borderRadius: 34, alignItems: "center", justifyContent: "center" },
  acceptButton: { backgroundColor: Colors.success },
  declineButton: { backgroundColor: Colors.danger },
  smallButton: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.15)" },
  smallButtonActive: { backgroundColor: Colors.gold },

  videoContainer: { flex: 1, backgroundColor: "#0B0716" },
  remoteVideo: { ...StyleSheet.absoluteFillObject },
  localVideo: { position: "absolute", top: 60, right: Spacing.lg, width: 100, height: 148, borderRadius: 12, backgroundColor: "#1C1040", borderWidth: 2, borderColor: "rgba(255,255,255,0.3)" },
  videoOverlayTop: { position: "absolute", top: 0, left: 0, right: 0, alignItems: "center", gap: 2 },
  videoOverlayBottom: { position: "absolute", bottom: 0, left: 0, right: 0, alignItems: "center" },
});
