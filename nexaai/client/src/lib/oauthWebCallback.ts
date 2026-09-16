import { Platform } from "react-native";

/**
 * Consumes the ?authToken=/?authError= query params the server's Google/
 * GitHub OAuth callback lands the WEB build on after a real full-page
 * redirect (server/src/lib/socialAuth/google.ts and github.ts's
 * redirectToApp) — the native app instead gets nexaai://auth-callback,
 * which WebBrowser.openAuthSessionAsync can intercept; a browser has no
 * way to follow a custom URL scheme at all, so the web build needs its own
 * real completion path back to this same origin. Reads once, strips the
 * params from the URL immediately so a page refresh doesn't replay them,
 * and returns null on native or when neither param is present.
 */
export function consumeWebAuthCallback(): { token?: string; error?: string } | null {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const token = params.get("authToken") ?? undefined;
  const error = params.get("authError") ?? undefined;
  if (!token && !error) return null;
  params.delete("authToken");
  params.delete("authError");
  const rest = params.toString();
  window.history.replaceState({}, "", window.location.pathname + (rest ? `?${rest}` : "") + window.location.hash);
  return { token, error };
}
