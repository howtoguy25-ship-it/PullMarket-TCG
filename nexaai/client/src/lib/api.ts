import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { fetch as expoFetch } from "expo/fetch";

const API_URL = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ?? "http://localhost:5060";
const TOKEN_KEY = "nexaai_token";

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}
export async function setToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}
export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  body: any;
  constructor(status: number, body: any) {
    super(body?.message ?? body?.error ?? `Request failed (${status})`);
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
  text: string;
  kind?: "text" | "voice_memo" | "camera_ask" | "who_is_lookup" | "assistance_request";
  requestedAnswerCount?: number;
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
