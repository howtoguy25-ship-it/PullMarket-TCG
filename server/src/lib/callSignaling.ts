// WebSocket signaling for in-app audio calls. This server only ever
// forwards small JSON handshake messages (call invites, SDP offer/answer,
// ICE candidates) between the two people on a call — the actual audio is a
// direct WebRTC peer connection between their devices once signaling
// completes, never routed through here.
//
// No TURN server is configured — only public STUN (see the client's
// RTCPeerConnection config). That's enough for most home/office networks
// but can fail to connect two peers both behind restrictive/symmetric NATs
// (common on some cellular carriers). Adding a TURN server is a separate
// piece of infrastructure this doesn't include.
import type { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { db } from "../db";
import { calls, conversations, users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { verifyAuthToken } from "./jwt";
import { notifyUser } from "./notify";

const RING_TIMEOUT_MS = 45_000;

type ClientMessage =
  | { type: "invite"; conversationId: string; calleeId: string; sdp: unknown; isVideo?: boolean }
  | { type: "answer"; callId: string; sdp: unknown }
  | { type: "decline"; callId: string }
  | { type: "end"; callId: string }
  | { type: "ice-candidate"; callId: string; candidate: unknown };

const socketsByUserId = new Map<string, WebSocket>();
// callId -> the ring-timeout handle, so it can be cleared the moment the
// call is answered/declined/ended instead of firing a stale "missed" event.
const ringTimeouts = new Map<string, NodeJS.Timeout>();
// callId -> the two participant ids, kept in memory so ICE candidates and
// "end" don't need a DB round-trip on every single message.
const activeCalls = new Map<string, { callerId: string; calleeId: string }>();

function send(userId: string, payload: unknown) {
  const socket = socketsByUserId.get(userId);
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

async function markCallEnded(callId: string, status: "declined" | "missed" | "ended") {
  const timeout = ringTimeouts.get(callId);
  if (timeout) clearTimeout(timeout);
  ringTimeouts.delete(callId);
  activeCalls.delete(callId);
  await db.update(calls).set({ status, endedAt: new Date() }).where(eq(calls.id, callId));
}

export function setupCallSignaling(server: HttpServer): void {
  const wss = new WebSocketServer({ server, path: "/ws/calls" });

  wss.on("connection", (socket, req) => {
    const url = new URL(req.url ?? "", "http://localhost");
    const token = url.searchParams.get("token");
    let userId: string;
    try {
      userId = verifyAuthToken(token ?? "").userId;
    } catch {
      socket.close(4001, "Invalid or missing token");
      return;
    }

    // A second connection from the same user (e.g. app foregrounded on a
    // second device) replaces the old socket rather than stacking — only
    // one place to deliver a real-time signal to per person at a time.
    socketsByUserId.get(userId)?.close(4002, "Replaced by a new connection");
    socketsByUserId.set(userId, socket);

    socket.on("message", async (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      try {
        if (msg.type === "invite") {
          const [convo] = await db.select().from(conversations).where(eq(conversations.id, msg.conversationId));
          if (!convo || (convo.userAId !== userId && convo.userBId !== userId)) return;
          if (msg.calleeId !== convo.userAId && msg.calleeId !== convo.userBId) return;

          const [caller] = await db.select({ id: users.id, username: users.username, displayName: users.displayName, avatarUrl: users.avatarUrl }).from(users).where(eq(users.id, userId));
          const isVideo = !!msg.isVideo;
          const [call] = await db.insert(calls).values({ conversationId: convo.id, callerId: userId, calleeId: msg.calleeId, status: "ringing", isVideo }).returning();
          activeCalls.set(call.id, { callerId: userId, calleeId: msg.calleeId });

          send(userId, { type: "invited", callId: call.id });
          send(msg.calleeId, { type: "incoming", callId: call.id, conversationId: convo.id, sdp: msg.sdp, caller, isVideo });

          // Always fires — the callee may not have this WebSocket open
          // (app backgrounded/killed), so the push notification is the
          // real "someone's calling you" signal in that case, not the
          // "incoming" WS message above.
          const callKind = isVideo ? "video calling" : "calling";
          void notifyUser(msg.calleeId, {
            type: "incoming_call",
            title: isVideo ? "Incoming video call" : "Incoming call",
            body: caller?.displayName || caller?.username ? `${caller.displayName || caller.username} is ${callKind} you` : "You have an incoming call",
            data: { callId: call.id, conversationId: convo.id, callerId: userId, isVideo },
          });

          ringTimeouts.set(
            call.id,
            setTimeout(() => {
              void markCallEnded(call.id, "missed");
              send(userId, { type: "missed", callId: call.id });
            }, RING_TIMEOUT_MS),
          );
        } else if (msg.type === "answer") {
          const call = activeCalls.get(msg.callId);
          if (!call || call.calleeId !== userId) return;
          const timeout = ringTimeouts.get(msg.callId);
          if (timeout) clearTimeout(timeout);
          ringTimeouts.delete(msg.callId);
          await db.update(calls).set({ status: "accepted", answeredAt: new Date() }).where(eq(calls.id, msg.callId));
          send(call.callerId, { type: "answered", callId: msg.callId, sdp: msg.sdp });
        } else if (msg.type === "decline") {
          const call = activeCalls.get(msg.callId);
          if (!call || call.calleeId !== userId) return;
          await markCallEnded(msg.callId, "declined");
          send(call.callerId, { type: "declined", callId: msg.callId });
        } else if (msg.type === "end") {
          const call = activeCalls.get(msg.callId);
          if (!call || (call.callerId !== userId && call.calleeId !== userId)) return;
          const otherId = call.callerId === userId ? call.calleeId : call.callerId;
          await markCallEnded(msg.callId, "ended");
          send(otherId, { type: "ended", callId: msg.callId });
        } else if (msg.type === "ice-candidate") {
          const call = activeCalls.get(msg.callId);
          if (!call || (call.callerId !== userId && call.calleeId !== userId)) return;
          const otherId = call.callerId === userId ? call.calleeId : call.callerId;
          send(otherId, { type: "ice-candidate", callId: msg.callId, candidate: msg.candidate });
        }
      } catch (err) {
        console.error("Call signaling message handling failed:", err);
      }
    });

    socket.on("close", () => {
      if (socketsByUserId.get(userId) === socket) socketsByUserId.delete(userId);
    });
  });
}
