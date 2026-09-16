// Real X (Twitter) connector — OAuth 2.0 Authorization Code + PKCE (X
// requires PKCE for every client, confidential or not). Genuinely buildable
// by any developer today: X's Free/Basic/Pro flat-rate tiers closed to new
// signups Feb 2026 — new developer apps now get pay-per-use billing by
// default, which includes DM read/send within the real `dm.read`/`dm.write`
// scopes, metered per action rather than gated behind a fixed monthly plan.
//
// IMPORTANT — verify against X's current docs before going live: endpoint
// hosts/paths below (api.x.com, the DM events shape) reflect X's post-
// rebrand documentation as of when this was written; X has moved API
// hosts/versions before, so re-check docs.x.com if anything 404s.
//
// Setup required (in your own X Developer app, then here):
//   1. User authentication settings -> OAuth 2.0 -> Type of App: Web App
//      (confidential client). Callback URI: <APP_BASE_URL>/api/connectors/x/callback
//   2. Scopes: users.read, dm.read, dm.write, offline.access (the last one
//      is what makes X issue a refresh token — without it the connection
//      silently stops working after ~2 hours).
//   3. Set X_CLIENT_ID / X_CLIENT_SECRET / APP_BASE_URL here.
//
// No real-time push (Account Activity API webhooks) is confirmed available
// outside X's old Enterprise tier — lib/agents/xPoller.ts polls
// GET /2/dm_events on an interval instead. This is a real, working
// mechanism, just not instant; see that file's header for the tradeoff.

import { Router } from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { eq, and } from "drizzle-orm";
import { db } from "../../db";
import { connectors } from "@shared/schema";
import { appBaseUrl } from "../appBaseUrl";

const X_API_BASE = "https://api.x.com/2";
const X_SCOPES = ["users.read", "dm.read", "dm.write", "offline.access"].join(" ");

export function isXConfigured(): boolean {
  return !!(process.env.X_CLIENT_ID && process.env.X_CLIENT_SECRET && process.env.APP_BASE_URL);
}

function redirectUri(): string {
  return `${appBaseUrl()}/api/connectors/x/callback`;
}

function base64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function buildXAuthUrl(userId: string): string {
  const codeVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(crypto.createHash("sha256").update(codeVerifier).digest());
  // The verifier rides in the signed `state` param so it survives the
  // redirect round-trip without needing server-side session storage — its
  // JWT signature stops it being forged/tampered, which is all PKCE needs
  // from this leg (the real protection is that only this server ever
  // presents the verifier, at the token-exchange step below).
  const state = jwt.sign({ userId, purpose: "x_connector_state", codeVerifier }, process.env.JWT_SECRET!, { expiresIn: "10m" });
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.X_CLIENT_ID!,
    redirect_uri: redirectUri(),
    scope: X_SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `https://x.com/i/oauth2/authorize?${params.toString()}`;
}

interface XTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number; // seconds
  token_type: string;
}

async function exchangeCodeForToken(code: string, codeVerifier: string): Promise<XTokenResponse> {
  const basicAuth = Buffer.from(`${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`).toString("base64");
  const response = await fetch(`${X_API_BASE}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basicAuth}` },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
      code_verifier: codeVerifier,
    }),
  });
  if (!response.ok) throw new Error(`X token exchange failed: ${response.status} ${await response.text()}`);
  return (await response.json()) as XTokenResponse;
}

/** Refreshes an expired access token using the stored refresh_token — X access tokens are short-lived (~2h). */
export async function refreshXAccessToken(refreshToken: string): Promise<XTokenResponse> {
  const basicAuth = Buffer.from(`${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`).toString("base64");
  const response = await fetch(`${X_API_BASE}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basicAuth}` },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });
  if (!response.ok) throw new Error(`X token refresh failed: ${response.status} ${await response.text()}`);
  return (await response.json()) as XTokenResponse;
}

async function fetchOwnXUser(accessToken: string): Promise<{ id: string; username: string }> {
  const response = await fetch(`${X_API_BASE}/users/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`Failed to fetch X account identity: ${response.status} ${await response.text()}`);
  const json = (await response.json()) as { data: { id: string; username: string } };
  return json.data;
}

function htmlPage(title: string, message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:-apple-system,sans-serif;background:#05040f;color:#f4f2ff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{background:#12102a;border:1px solid rgba(140,130,255,.18);border-radius:20px;padding:32px;max-width:380px;text-align:center}</style>
</head><body><div class="card"><h2>${title}</h2><p>${message}</p></div></body></html>`;
}

/** Mounted at /api/connectors/x/callback — X's own OAuth redirect target. */
export const xConnectorCallbackRouter = Router();

xConnectorCallbackRouter.get("/", async (req, res) => {
  const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
  if (error) return res.status(400).send(htmlPage("Connection cancelled", "You can close this tab and return to NexaAi."));
  if (!code || !state) return res.status(400).send(htmlPage("Something went wrong", "Missing code or state from X."));

  let userId: string;
  let codeVerifier: string;
  try {
    const payload = jwt.verify(state, process.env.JWT_SECRET!) as { userId: string; purpose: string; codeVerifier: string };
    if (payload.purpose !== "x_connector_state") throw new Error("bad state purpose");
    userId = payload.userId;
    codeVerifier = payload.codeVerifier;
  } catch {
    return res.status(400).send(htmlPage("Link expired", "This connection link expired or is invalid — go back to NexaAi and try again."));
  }

  try {
    const token = await exchangeCodeForToken(code, codeVerifier);
    const me = await fetchOwnXUser(token.access_token);

    const values = {
      status: "connected" as const,
      externalAccountLabel: `@${me.username}`,
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? null,
      tokenExpiresAt: new Date(Date.now() + token.expires_in * 1000),
      providerMetadata: { userId: me.id, username: me.username, lastSeenDmEventId: null },
      connectedAt: new Date(),
    };
    const [existing] = await db.select().from(connectors).where(and(eq(connectors.userId, userId), eq(connectors.provider, "x")));
    if (existing) {
      await db.update(connectors).set(values).where(eq(connectors.id, existing.id));
    } else {
      await db.insert(connectors).values({ userId, provider: "x", ...values });
    }

    res.send(htmlPage("Connected!", `NexaAi can now reply as @${me.username} on X. You can close this tab and return to the app.`));
  } catch (err) {
    res.status(500).send(htmlPage("Connection failed", err instanceof Error ? err.message : "Please try again."));
  }
});
