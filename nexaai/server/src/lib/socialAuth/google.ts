// Real "Continue with Google" sign-in — a separate, dedicated OAuth client
// from the Connectors screen's Google Calendar connector
// (lib/connectors/google.ts): that one asks for calendar read access on an
// already-signed-in account, this one is a bare identity login and needs
// nothing but `openid email profile`. Never reuse one app's client
// credentials for the other's purpose.
//
// Setup required (real, your own Google Cloud project):
//   1. console.cloud.google.com -> OAuth client ID (type "Web application").
//   2. Authorized redirect URI: <APP_BASE_URL>/api/auth/google/callback.
//   3. Set GOOGLE_AUTH_CLIENT_ID / GOOGLE_AUTH_CLIENT_SECRET / APP_BASE_URL.

import { Router } from "express";
import jwt from "jsonwebtoken";
import { findOrCreateSocialUser, issueTokenForSocialUser } from "./common";
import { appBaseUrl } from "../appBaseUrl";

const SCOPE = "openid email profile";

export function isGoogleSignInConfigured(): boolean {
  return !!(process.env.GOOGLE_AUTH_CLIENT_ID && process.env.GOOGLE_AUTH_CLIENT_SECRET && process.env.APP_BASE_URL);
}

function redirectUri(): string {
  return `${appBaseUrl()}/api/auth/google/callback`;
}

export function buildGoogleSignInUrl(platform: "web" | "native" = "native"): string {
  // platform rides inside the signed state JWT (not a separate query param)
  // so the callback below — which only ever sees Google's own redirect,
  // never the client directly — still knows whether to hand the result
  // back as nexaai://auth-callback (native's WebBrowser.openAuthSessionAsync
  // can intercept a custom scheme) or a real https:// redirect (a browser
  // cannot follow a custom scheme at all, so the web build needs to land
  // back on this same origin instead).
  const state = jwt.sign({ purpose: "google_signin_state", platform }, process.env.JWT_SECRET!, { expiresIn: "10m" });
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_AUTH_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPE,
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
}
interface GoogleProfile {
  sub: string;
  email?: string;
  name?: string;
}

async function exchangeCodeForProfile(code: string): Promise<GoogleProfile> {
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_AUTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_AUTH_CLIENT_SECRET!,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!tokenResponse.ok) throw new Error(`Google token exchange failed: ${tokenResponse.status} ${await tokenResponse.text()}`);
  const { access_token } = (await tokenResponse.json()) as TokenResponse;

  const profileResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!profileResponse.ok) throw new Error("Couldn't fetch the Google profile.");
  return (await profileResponse.json()) as GoogleProfile;
}

function redirectToApp(res: import("express").Response, params: Record<string, string>, platform: "web" | "native") {
  if (platform === "web") {
    // A real full-page redirect back to this same origin — a browser has
    // no way to follow nexaai://auth-callback at all. AuthScreen.tsx's own
    // mount effect (consumeWebAuthCallback) picks these query params up.
    const query = new URLSearchParams();
    if (params.token) query.set("authToken", params.token);
    if (params.error) query.set("authError", params.error);
    res.redirect(`${appBaseUrl()}/?${query.toString()}`);
    return;
  }
  res.redirect(`nexaai://auth-callback?${new URLSearchParams(params).toString()}`);
}

/** Best-effort platform read off an unverified state — used only on the early
 * error paths below (missing code, user declined consent) where we haven't
 * verified the state yet and may never get the chance to; picking the wrong
 * redirect target here only costs a broken redirect, never a security
 * decision, so skipping signature verification for this alone is fine. */
function platformFromUnverifiedState(state: string | undefined): "web" | "native" {
  if (!state) return "native";
  try {
    const decoded = jwt.decode(state) as { platform?: string } | null;
    return decoded?.platform === "web" ? "web" : "native";
  } catch {
    return "native";
  }
}

/** Mounted at /api/auth/google/callback — Google's own OAuth redirect target. */
export const googleSignInCallbackRouter = Router();

googleSignInCallbackRouter.get("/", async (req, res) => {
  const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
  if (error) return redirectToApp(res, { error: "cancelled" }, platformFromUnverifiedState(state));
  if (!code || !state) return redirectToApp(res, { error: "missing_code" }, platformFromUnverifiedState(state));

  let platform: "web" | "native" = "native";
  try {
    const payload = jwt.verify(state, process.env.JWT_SECRET!) as { purpose: string; platform?: "web" | "native" };
    if (payload.purpose !== "google_signin_state") throw new Error("bad state purpose");
    platform = payload.platform === "web" ? "web" : "native";
  } catch {
    return redirectToApp(res, { error: "expired" }, platformFromUnverifiedState(state));
  }

  try {
    const profile = await exchangeCodeForProfile(code);
    const user = await findOrCreateSocialUser("googleAuthId", profile.sub, profile.email ?? null, profile.name ?? "NexaAi user");
    redirectToApp(res, { token: issueTokenForSocialUser(user.id, user.tokenVersion) }, platform);
  } catch (err) {
    redirectToApp(res, { error: err instanceof Error ? err.message : "sign_in_failed" }, platform);
  }
});
