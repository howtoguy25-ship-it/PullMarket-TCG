import { Platform } from "react-native";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { fetch as expoFetch } from "expo/fetch";

export const API_URL = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ?? "http://localhost:5080";
const TOKEN_KEY = "nexaai_token";

// expo-secure-store has no web implementation at all (calling it throws
// "not a function", not a graceful no-op) — the native module simply isn't
// there on web. `npm run dev` runs the mobile client's web build alongside
// the server for quick iteration, so this needs a real fallback rather
// than leaving login broken whenever this exact app runs in a browser.
export async function getToken(): Promise<string | null> {
  if (Platform.OS === "web") return Promise.resolve(localStorage.getItem(TOKEN_KEY));
  return SecureStore.getItemAsync(TOKEN_KEY);
}
export async function setToken(token: string): Promise<void> {
  if (Platform.OS === "web") return Promise.resolve(localStorage.setItem(TOKEN_KEY, token));
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}
export async function clearToken(): Promise<void> {
  if (Platform.OS === "web") return Promise.resolve(localStorage.removeItem(TOKEN_KEY));
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

const LAST_SESSION_KEY = "nexaai_last_session_id";

/** Real "what were you last chatting about" persistence — so reopening the app resumes that same session (with a real "Resumed session" marker, ChatScreen.tsx) instead of always starting a blank new chat. */
export async function getLastSessionId(): Promise<string | null> {
  if (Platform.OS === "web") return Promise.resolve(localStorage.getItem(LAST_SESSION_KEY));
  return SecureStore.getItemAsync(LAST_SESSION_KEY);
}
export async function setLastSessionId(sessionId: string): Promise<void> {
  if (Platform.OS === "web") return Promise.resolve(localStorage.setItem(LAST_SESSION_KEY, sessionId));
  await SecureStore.setItemAsync(LAST_SESSION_KEY, sessionId);
}

// Several routes return a zod validation failure as `{ error: parsed.error.flatten() }`
// — a real object, not a string. `Error`'s constructor coerces its message
// argument with ToString, so passing that object through unchanged renders
// as the literal text "[object Object]" everywhere this error is shown
// (signup, login, every validated form). Pull a real message out of it.
function deriveErrorMessage(status: number, body: any): string {
  if (typeof body?.message === "string" && body.message) return body.message;
  if (typeof body?.error === "string" && body.error) return body.error;
  const flat = body?.error;
  if (flat && typeof flat === "object") {
    const fieldError = flat.fieldErrors && Object.values(flat.fieldErrors).find((v: any) => Array.isArray(v) && v.length);
    const text = (Array.isArray(flat.formErrors) && flat.formErrors[0]) || (Array.isArray(fieldError) && fieldError[0]);
    if (typeof text === "string" && text) return text;
  }
  return `Request failed (${status})`;
}

export class ApiError extends Error {
  status: number;
  body: any;
  constructor(status: number, body: any) {
    super(deriveErrorMessage(status, body));
    this.status = status;
    this.body = body;
  }
}

export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await response.json() : null;
  if (!response.ok) throw new ApiError(response.status, body);
  return body as T;
}

export interface StreamChatBody {
  sessionId?: string;
  projectId?: string;
  text: string;
  kind?: "text" | "voice_memo" | "camera_ask" | "who_is_lookup" | "assistance_request" | "file_attachment";
  requestedAnswerCount?: number;
  requestedFocusMode?: "quick" | "build" | "auto" | "gorilla";
  attachment?: { url: string; filename: string; mimeType: string; sizeBytes: number; kind: "image" | "video" | "file" };
  businessCategory?: string;
  userLat?: number;
  userLng?: number;
  /** Records "what the user is working on" for this session — see server/src/routes/chat.ts's activeTask handling. Sent once, with the message that starts a task. */
  setActiveTask?: string;
}

/** Same shape as components/MessageBubble.tsx's NearbyBusiness — duplicated here rather than imported, to avoid a circular import (MessageBubble already imports from this file). */
interface NearbyBusinessLike {
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  distanceKm: number | null;
}

export interface StreamChatDone {
  sessionId: string;
  userMessage: { id: string; role: "user"; content: string; createdAt: string };
  message: {
    id: string;
    role: "assistant";
    content: string;
    kind: string;
    metadata?: { businesses?: NearbyBusinessLike[]; videoFrames?: VideoFrameBreakdownEntry[] } | null;
  };
  answerCount: number;
  creditBalanceAfterCents: number;
  usedGraceOverage: boolean;
  activeTask: string | null;
  /** True when this reply was cut short by a real stop (user tap or disconnect) rather than finishing on its own. */
  stopped?: boolean;
  /** Smart Build's real "once finished" notification (routes/chat.ts) — a genuine second assistant message reporting the real SiteSpark push result, when Smart Build auto-built something and SiteSpark is connected. */
  followUpMessage?: { id: string; role: "assistant"; content: string; kind: string; createdAt: string } | null;
  /** Present only when this exact turn is the one that auto-started a real Project via Smart Build — drives ChatScreen's dedicated (autoSpeak-independent) spoken reply for this turn. */
  smartBuild?: { triggered: true };
}

/** One real sampled video still, live-pushed the moment it's extracted — before its description exists yet. */
export interface VideoFrameEvent {
  index: number;
  timestampSeconds: number;
  thumbnailBase64: string;
  mediaType: string;
}

/** The real Claude vision description for a frame already pushed via VideoFrameEvent — arrives slightly after it, same index. */
export interface VideoFrameDescriptionEvent {
  index: number;
  description: string;
}

/** Persisted shape of the full frame-by-frame breakdown — same as server/src/lib/videoFrames.ts's VideoFrameBreakdownEntry, stored on the assistant message's metadata.videoFrames so history reloads show the same breakdown. */
export interface VideoFrameBreakdownEntry {
  index: number;
  timestampSeconds: number;
  description: string;
}

export interface EditMessageResult {
  userMessage: { id: string; role: "user"; content: string; createdAt: string };
  message: { id: string; role: "assistant"; content: string; kind: string; createdAt: string };
  focusMode: string;
  creditBalanceAfterCents: number;
  usedGraceOverage: boolean;
}

/**
 * Real "edit a sent message" — server enforces the 1-minute window (see
 * server/src/routes/chat.ts's EDIT_WINDOW_MS) and genuinely regenerates the
 * reply against the edited text; this isn't a client-side rewrite.
 */
export async function editSentMessage(messageId: string, newText: string, requestedFocusMode?: string): Promise<EditMessageResult> {
  return api<EditMessageResult>(`/api/chat/messages/${messageId}/edit`, {
    method: "PATCH",
    body: JSON.stringify({ newText, requestedFocusMode }),
  });
}

/**
 * Real token-by-token streaming from the server's SSE endpoint (uses
 * `expo/fetch`, Expo's own fetch implementation with true streaming
 * response-body support on native and web — this is not a client-side
 * fake-typing effect, the bytes arrive from Claude as they're generated).
 */
export async function streamChatMessage(
  body: StreamChatBody,
  handlers: {
    onDelta: (delta: string) => void;
    onDone: (final: StreamChatDone) => void;
    onError: (message: string, status?: number, errorBody?: any) => void;
    /** A real sampled video still just arrived — render its thumbnail immediately, description follows via onVideoFrameDescription. */
    onVideoFrame?: (frame: VideoFrameEvent) => void;
    /** The real Claude vision description for a frame already rendered via onVideoFrame. */
    onVideoFrameDescription?: (event: VideoFrameDescriptionEvent) => void;
    /** Fires when `signal` aborts this call — a real user-initiated stop, not an error. Whatever `onDelta` already delivered stays put. */
    onStopped?: () => void;
  },
  signal?: AbortSignal,
): Promise<void> {
  const token = await getToken();
  let response: Response;
  try {
    response = await expoFetch(`${API_URL}/api/chat/messages/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) {
      handlers.onStopped?.();
      return;
    }
    handlers.onError(err instanceof Error ? err.message : "Couldn't reach NexaAi.");
    return;
  }

  if (!response.body) {
    handlers.onError("Streaming isn't supported on this device/browser.");
    return;
  }

  if (!response.ok) {
    const isJson = response.headers.get("content-type")?.includes("application/json");
    const errBody = isJson ? await response.json() : null;
    handlers.onError(errBody?.message ?? errBody?.error ?? `Request failed (${response.status})`, response.status, errBody);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sepIndex = buffer.indexOf("\n\n");
      while (sepIndex !== -1) {
        const rawEvent = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);
        const dataLine = rawEvent.split("\n").find((line) => line.startsWith("data: "));
        if (dataLine) {
          const payload = JSON.parse(dataLine.slice("data: ".length));
          if (payload.error) {
            handlers.onError(payload.error, undefined, payload);
            return;
          }
          if (payload.done) {
            // Stopped before any real text existed — the server skipped
            // saving anything, so there's no `message` to hand onDone.
            if (payload.stopped && !payload.message) handlers.onStopped?.();
            else handlers.onDone(payload as StreamChatDone);
            return;
          }
          if (typeof payload.delta === "string") handlers.onDelta(payload.delta);
          if (payload.videoFrame) handlers.onVideoFrame?.(payload.videoFrame as VideoFrameEvent);
          if (payload.videoFrameDescription) handlers.onVideoFrameDescription?.(payload.videoFrameDescription as VideoFrameDescriptionEvent);
        }
        sepIndex = buffer.indexOf("\n\n");
      }
    }
  } catch (err) {
    if (signal?.aborted) {
      handlers.onStopped?.();
      return;
    }
    handlers.onError(err instanceof Error ? err.message : "Connection to NexaAi dropped.");
  }
}
