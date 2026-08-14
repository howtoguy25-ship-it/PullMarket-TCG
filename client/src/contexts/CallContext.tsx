import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Platform, PermissionsAndroid, Alert } from "react-native";
import * as Haptics from "expo-haptics";
import { getToken, getApiUrl } from "@/lib/api";
import { useAuth } from "./AuthContext";
import { useRingtone } from "./RingtoneContext";

// react-native-webrtc's native getUserMedia does NOT request Android's
// runtime RECORD_AUDIO/CAMERA permissions itself — it just fails if they
// aren't already granted (confirmed against its Android source: no
// PermissionsAndroid/requestPermissions call anywhere in it). Without this,
// every call on Android would silently fail to attach a local audio track
// the first time a user calls (before they'd ever been prompted), leaving
// both sides with no sound. iOS doesn't need this: getUserMedia's native
// implementation there triggers the OS mic/camera prompt on its own.
async function ensureCallPermissions(video: boolean): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  const permissions = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, ...(video ? [PermissionsAndroid.PERMISSIONS.CAMERA] : [])];
  const results = await PermissionsAndroid.requestMultiple(permissions);
  return permissions.every((p) => results[p] === PermissionsAndroid.RESULTS.GRANTED);
}

// react-native-webrtc is a native module with no web build — loaded
// dynamically, and only ever on native, so importing this file doesn't
// break the web bundle. Calling is native-only for now; on web, startCall
// simply never gets invoked (ChatThreadScreen only shows the call button
// off-web — see its Platform.OS check).
let webrtcModule: typeof import("react-native-webrtc") | null = null;
async function loadWebRTC() {
  if (!webrtcModule) webrtcModule = await import("react-native-webrtc");
  return webrtcModule;
}

// react-native-incall-manager owns the call's audio session: it routes
// audio to the earpiece by default (like a real phone call) or the
// speaker on request, runs the proximity sensor (screen off near your
// ear during audio calls), and plays the device's own system ringtone /
// ringback tone — no bundled audio asset needed. Same native-only
// dynamic-import pattern as react-native-webrtc above.
let inCallManagerModule: typeof import("react-native-incall-manager").default | null = null;
async function loadInCallManager() {
  if (!inCallManagerModule) inCallManagerModule = (await import("react-native-incall-manager")).default;
  return inCallManagerModule;
}

// Public STUN only — no TURN server is set up, so this can fail to
// establish a direct connection between two peers that are both behind
// restrictive/symmetric NATs (some cellular carriers do this). A TURN
// server is a separate piece of infrastructure this doesn't include.
const ICE_SERVERS = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];

export interface CallPeer {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export type CallPhase = "idle" | "outgoing" | "incoming" | "connecting" | "active" | "ended" | "failed";

interface CallContextValue {
  phase: CallPhase;
  peer: CallPeer | null;
  durationSec: number;
  isMuted: boolean;
  isSpeakerOn: boolean;
  isVideo: boolean;
  localStream: import("react-native-webrtc").MediaStream | null;
  remoteStream: import("react-native-webrtc").MediaStream | null;
  endReason: string | null;
  startCall: (conversationId: string, callee: CallPeer, video?: boolean) => Promise<void>;
  answerCall: () => Promise<void>;
  declineCall: () => void;
  endCall: () => void;
  toggleMute: () => void;
  toggleSpeaker: () => void;
}

const CallContext = createContext<CallContextValue | null>(null);

function wsUrlFor(token: string): string {
  const base = getApiUrl().replace(/^http/i, "ws");
  return `${base}/ws/calls?token=${encodeURIComponent(token)}`;
}

export function CallProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { startIncomingRingtone, startOutgoingRingback } = useRingtone();
  const stopIncomingRingtoneRef = useRef<(() => void) | null>(null);
  const stopOutgoingRingbackRef = useRef<(() => void) | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<InstanceType<typeof import("react-native-webrtc").RTCPeerConnection> | null>(null);
  const localStreamRef = useRef<import("react-native-webrtc").MediaStream | null>(null);
  const pendingIncomingSdpRef = useRef<unknown>(null);
  const pendingCandidatesRef = useRef<unknown[]>([]);
  // The caller's own ICE candidates can start gathering (pc.onicecandidate
  // firing) before the "invited" ack round-trips back with a callId to tag
  // them with — those early candidates (often the first host candidate)
  // used to just be silently dropped since there was nowhere to send them
  // yet. Buffered here and flushed the moment callIdRef.current is set.
  const pendingLocalCandidatesRef = useRef<unknown[]>([]);
  const callIdRef = useRef<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const isVideoRef = useRef(false);
  const ringHapticIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [phase, setPhase] = useState<CallPhase>("idle");
  const [peer, setPeer] = useState<CallPeer | null>(null);
  const [durationSec, setDurationSec] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(false);
  const [isVideo, setIsVideo] = useState(false);
  const [localStream, setLocalStream] = useState<import("react-native-webrtc").MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<import("react-native-webrtc").MediaStream | null>(null);
  const [endReason, setEndReason] = useState<string | null>(null);

  // Stops the ring/ringback tone and the incoming-call haptic pulse — safe
  // to call any time (a no-op if nothing was playing), so every call-ending
  // path can call it unconditionally rather than tracking exactly which
  // sound might be active.
  const stopRingingEffects = useCallback(async () => {
    if (ringHapticIntervalRef.current) {
      clearInterval(ringHapticIntervalRef.current);
      ringHapticIntervalRef.current = null;
    }
    if (stopIncomingRingtoneRef.current) {
      stopIncomingRingtoneRef.current();
      stopIncomingRingtoneRef.current = null;
    }
    if (stopOutgoingRingbackRef.current) {
      stopOutgoingRingbackRef.current();
      stopOutgoingRingbackRef.current = null;
    }
  }, []);

  const resetCallState = useCallback(
    (reason: string | null) => {
      pcRef.current?.close();
      pcRef.current = null;
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      pendingIncomingSdpRef.current = null;
      pendingCandidatesRef.current = [];
      pendingLocalCandidatesRef.current = [];
      callIdRef.current = null;
      conversationIdRef.current = null;
      isVideoRef.current = false;
      void stopRingingEffects();
      void loadInCallManager().then((m) => m.stop());
      setPhase("idle");
      setPeer(null);
      setDurationSec(0);
      setIsMuted(false);
      setIsSpeakerOn(false);
      setIsVideo(false);
      setLocalStream(null);
      setRemoteStream(null);
      setEndReason(reason);
    },
    [stopRingingEffects],
  );

  // ── WebSocket signaling connection ────────────────────────────────────
  useEffect(() => {
    if (Platform.OS === "web" || !user) return;
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    async function connect() {
      const token = await getToken();
      if (!token || cancelled) return;
      const ws = new WebSocket(wsUrlFor(token));
      wsRef.current = ws;

      ws.onmessage = (event) => {
        let msg: any;
        try {
          msg = JSON.parse(event.data as string);
        } catch {
          return;
        }
        void handleSignal(msg);
      };
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        if (!cancelled) reconnectTimer = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws.close();
    }

    void connect();
    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const send = useCallback((payload: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(payload));
  }, []);

  const createPeerConnection = useCallback(async () => {
    const { RTCPeerConnection } = await loadWebRTC();
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pc.onicecandidate = (event: any) => {
      if (!event.candidate) return;
      if (callIdRef.current) send({ type: "ice-candidate", callId: callIdRef.current, candidate: event.candidate });
      else pendingLocalCandidatesRef.current.push(event.candidate);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        setPhase("active");
        void stopRingingEffects();
      }
      if (pc.connectionState === "failed") {
        setPhase("failed");
        setEndReason("Connection failed — check both devices' network and try again.");
      }
    };
    // Captures the other person's audio/video track the moment WebRTC
    // negotiation delivers it — this is what actually lets CallOverlay
    // render their video (or, audio-only, just play their voice).
    pc.ontrack = (event: any) => {
      const stream = event.streams?.[0] ?? null;
      if (stream) setRemoteStream(stream);
    };
    pcRef.current = pc;
    return pc;
  }, [send, stopRingingEffects]);

  const attachLocalMedia = useCallback(async (pc: InstanceType<typeof import("react-native-webrtc").RTCPeerConnection>, video: boolean) => {
    const { mediaDevices } = await loadWebRTC();
    const stream = await mediaDevices.getUserMedia({ audio: true, video });
    localStreamRef.current = stream;
    setLocalStream(stream);
    stream.getTracks().forEach((track: any) => pc.addTrack(track, stream));
  }, []);

  const startCall = useCallback(
    async (conversationId: string, callee: CallPeer, video = false) => {
      if (Platform.OS === "web") return;

      const granted = await ensureCallPermissions(video);
      if (!granted) {
        Alert.alert("Permission needed", video ? "Camera and microphone access are needed to make a video call." : "Microphone access is needed to make a call.");
        return;
      }

      isVideoRef.current = video;
      setIsVideo(video);
      setIsSpeakerOn(video); // InCallManager defaults speaker-on for video, earpiece for audio — keep the UI toggle in sync
      setPeer(callee);
      setPhase("outgoing");
      setEndReason(null);
      conversationIdRef.current = conversationId;

      try {
        const InCallManager = await loadInCallManager();
        InCallManager.start({ media: video ? "video" : "audio", auto: true });
        if (stopOutgoingRingbackRef.current) stopOutgoingRingbackRef.current();
        stopOutgoingRingbackRef.current = await startOutgoingRingback();

        const { RTCSessionDescription } = await loadWebRTC();
        const pc = await createPeerConnection();
        await attachLocalMedia(pc, video);
        const offer = await pc.createOffer({});
        await pc.setLocalDescription(new RTCSessionDescription(offer));
        send({ type: "invite", conversationId, calleeId: callee.id, sdp: pc.localDescription, isVideo: video });
      } catch (err) {
        console.error("startCall failed:", err);
        resetCallState("Couldn't start the call — check your microphone/camera access and try again.");
      }
    },
    [attachLocalMedia, createPeerConnection, resetCallState, send, startOutgoingRingback],
  );

  const answerCall = useCallback(async () => {
    if (!callIdRef.current || !pendingIncomingSdpRef.current) return;

    const video = isVideoRef.current;
    const granted = await ensureCallPermissions(video);
    if (!granted) {
      if (callIdRef.current) send({ type: "decline", callId: callIdRef.current });
      resetCallState(video ? "Camera and microphone access are needed to answer a video call." : "Microphone access is needed to answer a call.");
      return;
    }

    setPhase("connecting");
    void stopRingingEffects();
    setIsSpeakerOn(video);

    try {
      const InCallManager = await loadInCallManager();
      InCallManager.start({ media: video ? "video" : "audio", auto: true });

      const { RTCSessionDescription, RTCIceCandidate } = await loadWebRTC();
      const pc = await createPeerConnection();
      await attachLocalMedia(pc, video);
      await pc.setRemoteDescription(new RTCSessionDescription(pendingIncomingSdpRef.current as any));
      for (const candidate of pendingCandidatesRef.current) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate as any));
      }
      pendingCandidatesRef.current = [];
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(new RTCSessionDescription(answer));
      send({ type: "answer", callId: callIdRef.current, sdp: pc.localDescription });
    } catch (err) {
      console.error("answerCall failed:", err);
      if (callIdRef.current) send({ type: "decline", callId: callIdRef.current });
      resetCallState("Couldn't answer the call — check your microphone/camera access and try again.");
    }
  }, [attachLocalMedia, createPeerConnection, resetCallState, send, stopRingingEffects]);

  const declineCall = useCallback(() => {
    if (callIdRef.current) send({ type: "decline", callId: callIdRef.current });
    resetCallState(null);
  }, [resetCallState, send]);

  const endCall = useCallback(() => {
    if (callIdRef.current) send({ type: "end", callId: callIdRef.current });
    resetCallState(null);
  }, [resetCallState, send]);

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !isMuted;
    stream.getAudioTracks().forEach((t: any) => (t.enabled = !next));
    setIsMuted(next);
  }, [isMuted]);

  const toggleSpeaker = useCallback(() => {
    const next = !isSpeakerOn;
    void loadInCallManager().then((m) => m.setForceSpeakerphoneOn(next));
    setIsSpeakerOn(next);
  }, [isSpeakerOn]);

  async function handleSignal(msg: any) {
    if (msg.type === "invited") {
      callIdRef.current = msg.callId;
      if (pendingLocalCandidatesRef.current.length > 0) {
        for (const candidate of pendingLocalCandidatesRef.current) {
          send({ type: "ice-candidate", callId: msg.callId, candidate });
        }
        pendingLocalCandidatesRef.current = [];
      }
    } else if (msg.type === "incoming") {
      callIdRef.current = msg.callId;
      conversationIdRef.current = msg.conversationId;
      pendingIncomingSdpRef.current = msg.sdp;
      isVideoRef.current = !!msg.isVideo;
      setIsVideo(!!msg.isVideo);
      setPeer(msg.caller);
      setPhase("incoming");
      setEndReason(null);

      // Real ring: the user's chosen PullMarket ringtone (an original,
      // in-house-synthesized loop — not the OS system ringtone, see
      // RingtoneContext) plus a repeating haptic pulse so an incoming call
      // is felt, not just seen — both stop the moment the call is
      // answered/declined/ends/missed (stopRingingEffects, called from
      // every one of those paths).
      if (stopIncomingRingtoneRef.current) stopIncomingRingtoneRef.current();
      stopIncomingRingtoneRef.current = await startIncomingRingtone();
      if (ringHapticIntervalRef.current) clearInterval(ringHapticIntervalRef.current);
      ringHapticIntervalRef.current = setInterval(() => {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }, 1200);
    } else if (msg.type === "answered") {
      if (msg.callId !== callIdRef.current || !pcRef.current) return;
      void stopRingingEffects();
      const { RTCSessionDescription, RTCIceCandidate } = await loadWebRTC();
      await pcRef.current.setRemoteDescription(new RTCSessionDescription(msg.sdp));
      // Same flush answerCall already does on the callee side — any ICE
      // candidates that arrived from the callee before this SDP answer did
      // (a real race, not an edge case) were queued in pendingCandidatesRef
      // and need to be applied now that there's a remoteDescription to
      // apply them against. Without this they were silently dropped here,
      // which can leave the media path (audio/video) never connecting.
      for (const candidate of pendingCandidatesRef.current) {
        await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate as any));
      }
      pendingCandidatesRef.current = [];
      setPhase("connecting");
    } else if (msg.type === "ice-candidate") {
      if (msg.callId !== callIdRef.current) return;
      const { RTCIceCandidate } = await loadWebRTC();
      if (pcRef.current?.remoteDescription) {
        await pcRef.current.addIceCandidate(new RTCIceCandidate(msg.candidate));
      } else {
        pendingCandidatesRef.current.push(msg.candidate);
      }
    } else if (msg.type === "declined") {
      resetCallState("The other person declined.");
    } else if (msg.type === "ended") {
      resetCallState("Call ended.");
    } else if (msg.type === "missed") {
      resetCallState("No answer.");
    }
  }

  // Live call-duration ticker, only while actually connected.
  useEffect(() => {
    if (phase !== "active") return;
    const start = Date.now();
    const interval = setInterval(() => setDurationSec(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(interval);
  }, [phase]);

  return (
    <CallContext.Provider
      value={{
        phase,
        peer,
        durationSec,
        isMuted,
        isSpeakerOn,
        isVideo,
        localStream,
        remoteStream,
        endReason,
        startCall,
        answerCall,
        declineCall,
        endCall,
        toggleMute,
        toggleSpeaker,
      }}
    >
      {children}
    </CallContext.Provider>
  );
}

export function useCall(): CallContextValue {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCall must be used within a CallProvider");
  return ctx;
}
