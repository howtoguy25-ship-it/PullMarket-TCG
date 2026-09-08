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
  paceHintMsSinceLastMessage?: number;
}

export interface StreamChatDone {
  sessionId: string;
  message: { id: string; role: "assistant"; content: string; kind: string };
  answerCount: number;
  creditBalanceAfterCents: number;
  usedGraceOverage: boolean;
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
  },
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
    });
  } catch (err) {
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
            handlers.onDone(payload as StreamChatDone);
            return;
          }
          if (typeof payload.delta === "string") handlers.onDelta(payload.delta);
        }
        sepIndex = buffer.indexOf("\n\n");
      }
    }
  } catch (err) {
    handlers.onError(err instanceof Error ? err.message : "Connection to NexaAi dropped.");
  }
}
