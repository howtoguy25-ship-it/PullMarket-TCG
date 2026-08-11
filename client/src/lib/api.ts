import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";

export function getApiUrl(): string {
  return (Constants.expoConfig?.extra?.API_URL as string) || "http://localhost:5050";
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
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// A 401/410 from any authenticated endpoint means the stored token is no
// longer valid (expired, revoked, or the account is gone) — rather than
// leaving whichever screen happened to make that call stuck showing a
// generic "Not authenticated" error while the rest of the app still acts
// signed in, treat it as a real sign-out everywhere. AuthContext registers
// the handler on mount.
let onUnauthorized: ((message: string) => void) | null = null;
export function setUnauthorizedHandler(handler: ((message: string) => void) | null): void {
  onUnauthorized = handler;
}

export async function apiRequest(method: string, path: string, body?: unknown, isFormData = false): Promise<Response> {
  const token = await getToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (!isFormData && body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(`${getApiUrl()}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : isFormData ? (body as FormData) : JSON.stringify(body),
  });

  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = await res.clone().json();
      message = data.message || message;
    } catch {
      // response wasn't JSON
    }
    if (res.status === 401 || res.status === 410) onUnauthorized?.(message);
    throw new ApiError(res.status, message);
  }

  return res;
}

export async function apiJson<T>(method: string, path: string, body?: unknown, isFormData = false): Promise<T> {
  const res = await apiRequest(method, path, body, isFormData);
  return res.json();
}
