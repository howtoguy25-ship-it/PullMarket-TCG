import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
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
  endReason: string | null;
  startCall: (conversationId: string, callee: CallPeer) => Promise<void>;
  answerCall: () => Promise<void>;
  declineCall: () => void;
  endCall: () => void;
  toggleMute: () => void;
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

  const [phase, setPhase] = useState<CallPhase>("idle");
  const [peer, setPeer] = useState<CallPeer | null>(null);
  const [durationSec, setDurationSec] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [endReason, setEndReason] = useState<string | null>(null);

  const resetCallState = useCallback((reason: string | null) => {
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    pendingIncomingSdpRef.current = null;
    pendingCandidatesRef.current = [];
    callIdRef.current = null;
    conversationIdRef.current = null;
    setPhase("idle");
    setPeer(null);
    setDurationSec(0);
    setIsMuted(false);
    setEndReason(reason);
  }, []);

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
      if (pc.connectionState === "connected") setPhase("active");
      if (pc.connectionState === "failed") {
        setPhase("failed");
        setEndReason("Connection failed — check both devices' network and try again.");
      }
    };
    pcRef.current = pc;
    return pc;
  }, [send]);

  const attachLocalAudio = useCallback(async (pc: InstanceType<typeof import("react-native-webrtc").RTCPeerConnection>) => {
    const { mediaDevices } = await loadWebRTC();
    const stream = await mediaDevices.getUserMedia({ audio: true, video: false });
    localStreamRef.current = stream;
    stream.getTracks().forEach((track: any) => pc.addTrack(track, stream));
  }, []);

  const startCall = useCallback(
    async (conversationId: string, callee: CallPeer) => {
      if (Platform.OS === "web") return;
      setPeer(callee);
      setPhase("outgoing");
      setEndReason(null);
      conversationIdRef.current = conversationId;

      const { RTCSessionDescription } = await loadWebRTC();
      const pc = await createPeerConnection();
      await attachLocalAudio(pc);
      const offer = await pc.createOffer({});
      await pc.setLocalDescription(new RTCSessionDescription(offer));
      send({ type: "invite", conversationId, calleeId: callee.id, sdp: pc.localDescription });
    },
    [attachLocalAudio, createPeerConnection, send],
  );

  const answerCall = useCallback(async () => {
    if (!callIdRef.current || !pendingIncomingSdpRef.current) return;
    setPhase("connecting");
    const { RTCSessionDescription } = await loadWebRTC();
    const pc = await createPeerConnection();
    await attachLocalAudio(pc);
    await pc.setRemoteDescription(new RTCSessionDescription(pendingIncomingSdpRef.current as any));
    for (const candidate of pendingCandidatesRef.current) {
      const { RTCIceCandidate } = await loadWebRTC();
      await pc.addIceCandidate(new RTCIceCandidate(candidate as any));
    }
    pendingCandidatesRef.current = [];
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(new RTCSessionDescription(answer));
    send({ type: "answer", callId: callIdRef.current, sdp: pc.localDescription });
  }, [attachLocalAudio, createPeerConnection, send]);

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

  async function handleSignal(msg: any) {
    if (msg.type === "invited") {
      callIdRef.current = msg.callId;
    } else if (msg.type === "incoming") {
      callIdRef.current = msg.callId;
      conversationIdRef.current = msg.conversationId;
      pendingIncomingSdpRef.current = msg.sdp;
      setPeer(msg.caller);
      setPhase("incoming");
      setEndReason(null);
    } else if (msg.type === "answered") {
      if (msg.callId !== callIdRef.current || !pcRef.current) return;
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
    <CallContext.Provider value={{ phase, peer, durationSec, isMuted, endReason, startCall, answerCall, declineCall, endCall, toggleMute }}>
      {children}
    </CallContext.Provider>
  );
}

export function useCall(): CallContextValue {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCall must be used within a CallProvider");
  return ctx;
}
