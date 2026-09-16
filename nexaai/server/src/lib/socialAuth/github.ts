// Real "Continue with GitHub" sign-in — a separate, dedicated OAuth app
// from the Connectors screen's GitHub connector (lib/connectors/github.ts),
// which pushes a Project's generated code to a repo the user already
// signed in some other way. This one is a bare identity login and only
// needs `read:user user:email`. Never reuse one app's client credentials
// for the other's purpose.
//
// Setup required (real, your own GitHub OAuth App):
//   1. github.com/settings/developers -> New OAuth App.
//   2. Authorization callback URL: <APP_BASE_URL>/api/auth/github/callback.
//   3. Set GITHUB_AUTH_CLIENT_ID / GITHUB_AUTH_CLIENT_SECRET / APP_BASE_URL.

import { Router } from "express";
import jwt from "jsonwebtoken";
import { findOrCreateSocialUser, issueTokenForSocialUser } from "./common";
import { appBaseUrl } from "../appBaseUrl";

const SCOPE = "read:user user:email";

export function isGithubSignInConfigured(): boolean {
  return !!(process.env.GITHUB_AUTH_CLIENT_ID && process.env.GITHUB_AUTH_CLIENT_SECRET && process.env.APP_BASE_URL);
}

function redirectUri(): string {
  return `${appBaseUrl()}/api/auth/github/callback`;
}

export function buildGithubSignInUrl(platform: "web" | "native" = "native"): string {
  // See google.ts's identical comment: platform rides inside the signed
  // state JWT so the callback below knows whether to hand the result back
  // as nexaai://auth-callback (native) or a real https:// redirect (web —
  // a browser cannot follow a custom scheme at all).
  const state = jwt.sign({ purpose: "github_signin_state", platform }, process.env.JWT_SECRET!, { expiresIn: "10m" });
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_AUTH_CLIENT_ID!,
    redirect_uri: redirectUri(),
    scope: SCOPE,
    state,
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

interface TokenResponse {
  access_token?: string;
  error?: string;
}
interface GithubUser {
  id: number;
  login: string;
  name: string | null;
}
interface GithubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

async function exchangeCodeForProfile(code: string): Promise<{ id: string; email: string | null; name: string }> {
  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      code,
      client_id: process.env.GITHUB_AUTH_CLIENT_ID,
      client_secret: process.env.GITHUB_AUTH_CLIENT_SECRET,
      redirect_uri: redirectUri(),
    }),
  });
  const tokenBody = (await tokenResponse.json()) as TokenResponse;
  if (!tokenBody.access_token) throw new Error(tokenBody.error ?? "GitHub token exchange failed");

  const headers = { Authorization: `Bearer ${tokenBody.access_token}`, "User-Agent": "NexaAi" };
  const userResponse = await fetch("https://api.github.com/user", { headers });
  if (!userResponse.ok) throw new Error("Couldn't fetch the GitHub profile.");
  const user = (await userResponse.json()) as GithubUser;

  const emailsResponse = await fetch("https://api.github.com/user/emails", { headers });
  const emails = emailsResponse.ok ? ((await emailsResponse.json()) as GithubEmail[]) : [];
  const primaryEmail = emails.find((e) => e.primary && e.verified)?.email ?? emails.find((e) => e.verified)?.email ?? null;

  return { id: String(user.id), email: primaryEmail, name: user.name ?? user.login };
}

function redirectToApp(res: import("express").Response, params: Record<string, string>, platform: "web" | "native") {
  if (platform === "web") {
    const query = new URLSearchParams();
    if (params.token) query.set("authToken", params.token);
    if (params.error) query.set("authError", params.error);
    res.redirect(`${appBaseUrl()}/?${query.toString()}`);
    return;
  }
  res.redirect(`nexaai://auth-callback?${new URLSearchParams(params).toString()}`);
}

function platformFromUnverifiedState(state: string | undefined): "web" | "native" {
  if (!state) return "native";
  try {
    const decoded = jwt.decode(state) as { platform?: string } | null;
    return decoded?.platform === "web" ? "web" : "native";
  } catch {
    return "native";
  }
}

/** Mounted at /api/auth/github/callback — GitHub's own OAuth redirect target. */
export const githubSignInCallbackRouter = Router();

githubSignInCallbackRouter.get("/", async (req, res) => {
  const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
  if (error) return redirectToApp(res, { error: "cancelled" }, platformFromUnverifiedState(state));
  if (!code || !state) return redirectToApp(res, { error: "missing_code" }, platformFromUnverifiedState(state));

  let platform: "web" | "native" = "native";
  try {
    const payload = jwt.verify(state, process.env.JWT_SECRET!) as { purpose: string; platform?: "web" | "native" };
    if (payload.purpose !== "github_signin_state") throw new Error("bad state purpose");
    platform = payload.platform === "web" ? "web" : "native";
  } catch {
    return redirectToApp(res, { error: "expired" }, platformFromUnverifiedState(state));
  }

  try {
    const profile = await exchangeCodeForProfile(code);
    const user = await findOrCreateSocialUser("githubAuthId", profile.id, profile.email, profile.name);
    redirectToApp(res, { token: issueTokenForSocialUser(user.id, user.tokenVersion) }, platform);
  } catch (err) {
    redirectToApp(res, { error: err instanceof Error ? err.message : "sign_in_failed" }, platform);
  }
});
