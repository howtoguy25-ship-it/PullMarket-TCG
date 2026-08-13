import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import * as Haptics from "expo-haptics";
import { getToken, getApiUrl } from "@/lib/api";
import { useAuth } from "./AuthContext";

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

  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<InstanceType<typeof import("react-native-webrtc").RTCPeerConnection> | null>(null);
  const localStreamRef = useRef<import("react-native-webrtc").MediaStream | null>(null);
  const pendingIncomingSdpRef = useRef<unknown>(null);
  const pendingCandidatesRef = useRef<unknown[]>([]);
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
    const InCallManager = await loadInCallManager();
    InCallManager.stopRingtone();
    InCallManager.stopRingback();
  }, []);

  const resetCallState = useCallback(
    (reason: string | null) => {
      pcRef.current?.close();
      pcRef.current = null;
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      pendingIncomingSdpRef.current = null;
      pendingCandidatesRef.current = [];
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
      if (event.candidate && callIdRef.current) send({ type: "ice-candidate", callId: callIdRef.current, candidate: event.candidate });
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
      isVideoRef.current = video;
      setIsVideo(video);
      setIsSpeakerOn(video); // InCallManager defaults speaker-on for video, earpiece for audio — keep the UI toggle in sync
      setPeer(callee);
      setPhase("outgoing");
      setEndReason(null);
      conversationIdRef.current = conversationId;

      const InCallManager = await loadInCallManager();
      InCallManager.start({ media: video ? "video" : "audio", auto: true });
      InCallManager.startRingback("_DEFAULT_");

      const { RTCSessionDescription } = await loadWebRTC();
      const pc = await createPeerConnection();
      await attachLocalMedia(pc, video);
      const offer = await pc.createOffer({});
      await pc.setLocalDescription(new RTCSessionDescription(offer));
      send({ type: "invite", conversationId, calleeId: callee.id, sdp: pc.localDescription, isVideo: video });
    },
    [attachLocalMedia, createPeerConnection, send],
  );

  const answerCall = useCallback(async () => {
    if (!callIdRef.current || !pendingIncomingSdpRef.current) return;
    setPhase("connecting");
    void stopRingingEffects();
    const video = isVideoRef.current;
    setIsSpeakerOn(video);

    const InCallManager = await loadInCallManager();
    InCallManager.start({ media: video ? "video" : "audio", auto: true });

    const { RTCSessionDescription } = await loadWebRTC();
    const pc = await createPeerConnection();
    await attachLocalMedia(pc, video);
    await pc.setRemoteDescription(new RTCSessionDescription(pendingIncomingSdpRef.current as any));
    for (const candidate of pendingCandidatesRef.current) {
      const { RTCIceCandidate } = await loadWebRTC();
      await pc.addIceCandidate(new RTCIceCandidate(candidate as any));
    }
    pendingCandidatesRef.current = [];
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(new RTCSessionDescription(answer));
    send({ type: "answer", callId: callIdRef.current, sdp: pc.localDescription });
  }, [attachLocalMedia, createPeerConnection, send, stopRingingEffects]);

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
    } else if (msg.type === "incoming") {
      callIdRef.current = msg.callId;
      conversationIdRef.current = msg.conversationId;
      pendingIncomingSdpRef.current = msg.sdp;
      isVideoRef.current = !!msg.isVideo;
      setIsVideo(!!msg.isVideo);
      setPeer(msg.caller);
      setPhase("incoming");
      setEndReason(null);

      // Real ring: the device's own system ringtone via InCallManager, plus
      // a repeating haptic pulse so an incoming call is felt, not just seen
      // — both stop the moment the call is answered/declined/ends/missed
      // (stopRingingEffects, called from every one of those paths).
      // vibrate_pattern is a plain number (not an array) so InCallManager's
      // own Vibration.vibrate call is skipped — vibration is handled
      // separately below via expo-haptics, so the two don't double up.
      const InCallManager = await loadInCallManager();
      InCallManager.startRingtone("_DEFAULT_", 0, "default", -1);
      if (ringHapticIntervalRef.current) clearInterval(ringHapticIntervalRef.current);
      ringHapticIntervalRef.current = setInterval(() => {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }, 1200);
    } else if (msg.type === "answered") {
      if (msg.callId !== callIdRef.current || !pcRef.current) return;
      void stopRingingEffects();
      const { RTCSessionDescription } = await loadWebRTC();
      await pcRef.current.setRemoteDescription(new RTCSessionDescription(msg.sdp));
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
