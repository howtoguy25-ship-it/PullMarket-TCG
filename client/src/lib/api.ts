import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";

// A bare domain typed into EXPO_PUBLIC_API_URL without "https://" (e.g.
// "www.pullmarkettcg.com" instead of "https://www.pullmarkettcg.com") isn't
// a valid absolute URL at all — every request built from it fails outright,
// with no useful error, taking the entire app down. That's an easy typo to
// make and an expensive one to diagnose, so this corrects it defensively
// rather than trusting the env var to always be well-formed.
export function getApiUrl(): string {
  const configured = (Constants.expoConfig?.extra?.API_URL as string) || "http://localhost:5050";
  return /^https?:\/\//i.test(configured) ? configured : `https://${configured}`;
}

const TOKEN_KEY = "pullmarket_auth_token";

export async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem(TOKEN_KEY);
}

export async function setToken(token: string | null): Promise<void> {
  if (token) await AsyncStorage.setItem(TOKEN_KEY, token);
  else await AsyncStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  detail?: string;
  constructor(status: number, message: string, detail?: string) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

// A 401/410 from any authenticated endpoint means the stored token is no
// longer valid (expired, revoked, or the account is gone) — rather than
// leaving whichever screen happened to make that call stuck showing a
// generic "Not authenticated" error while the rest of the app still acts
// signed in, treat it as a real sign-out everywhere. AuthContext registers
// the handler on mount. The context string (method, path, whether a token
// was even attached) rides along so the alert this produces is a complete
// diagnostic on its own — no server logs needed to know which specific
// request actually failed.
let onUnauthorized: ((message: string, context: string) => void) | null = null;
export function setUnauthorizedHandler(handler: ((message: string, context: string) => void) | null): void {
  onUnauthorized = handler;
}

export async function apiRequest(method: string, path: string, body?: unknown, isFormData = false): Promise<Response> {
  const token = await getToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (!isFormData && body !== undefined) headers["Content-Type"] = "application/json";

  const url = `${getApiUrl()}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : isFormData ? (body as FormData) : JSON.stringify(body),
    });
  } catch (err) {
    // fetch() rejects for network-level failures (no route to host, DNS,
    // connection refused) — this is what a client pointed at a wrong/dead
    // API_URL (e.g. localhost baked into a production build) looks like.
    // Name the actual URL it tried to reach so that misconfiguration is
    // obvious from the error alone instead of looking identical to any
    // other "couldn't do the thing" failure.
    console.error(`[api] Network error: ${method} ${url}`, err);
    throw new ApiError(0, `Network error reaching ${url}`, err instanceof Error ? err.message : String(err));
  }

  if (!res.ok) {
    let message = res.statusText;
    let detail: string | undefined;
    try {
      const data = await res.clone().json();
      message = data.message || message;
      detail = data.detail;
    } catch {
      // response wasn't JSON
    }
    if (detail) console.error(`[api] ${method} ${path} -> ${res.status} ${message}: ${detail}`);
    if (res.status === 401 || res.status === 410) {
      onUnauthorized?.(message, `${method} ${path} -> ${res.status}${token ? "" : " (no token attached)"}`);
    }
    throw new ApiError(res.status, message, detail);
  }

  return res;
}

export async function apiJson<T>(method: string, path: string, body?: unknown, isFormData = false): Promise<T> {
  const res = await apiRequest(method, path, body, isFormData);
  return res.json();
}
