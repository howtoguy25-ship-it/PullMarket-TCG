// Real Google OAuth 2.0 Authorization Code flow for the "Connectors"
// screen — lets NexaAi read a user's Google Calendar so it can (eventually)
// factor real events into answers/agents. This is the one connector wired
// end-to-end; the others (Notion/Slack/Instagram/WhatsApp) are honest
// "not configured" stubs — see routes/connectors.ts.
//
// Setup required (real, your own Google Cloud project):
//   1. console.cloud.google.com -> new project -> enable the Google Calendar API.
//   2. OAuth consent screen -> add the `.../auth/calendar.readonly` scope.
//   3. Credentials -> OAuth client ID (type "Web application") -> add
//      `<APP_BASE_URL>/api/connectors/google/callback` as an authorized
//      redirect URI.
//   4. Set GOOGLE_CONNECTOR_CLIENT_ID / GOOGLE_CONNECTOR_CLIENT_SECRET /
//      APP_BASE_URL in the server environment.
// (Deliberately separate env vars from the root PullMarket TCG app's own
// Google Sign-In client — different app, different OAuth client.)

import { Router } from "express";
import jwt from "jsonwebtoken";
import { eq, and } from "drizzle-orm";
import { db } from "../../db";
import { connectors } from "@shared/schema";

const SCOPE = "https://www.googleapis.com/auth/calendar.readonly openid email";

export function isGoogleConnectorConfigured(): boolean {
  return !!(process.env.GOOGLE_CONNECTOR_CLIENT_ID && process.env.GOOGLE_CONNECTOR_CLIENT_SECRET && process.env.APP_BASE_URL);
}

function redirectUri(): string {
  return `${process.env.APP_BASE_URL}/api/connectors/google/callback`;
}

export function buildGoogleAuthUrl(userId: string): string {
  const state = jwt.sign({ userId, purpose: "google_connector_state" }, process.env.JWT_SECRET!, { expiresIn: "10m" });
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CONNECTOR_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CONNECTOR_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CONNECTOR_CLIENT_SECRET!,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!response.ok) throw new Error(`Google token exchange failed: ${response.status} ${await response.text()}`);
  return response.json() as Promise<TokenResponse>;
}

async function fetchGoogleEmail(accessToken: string): Promise<string> {
  const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return "Google account";
  const json = (await response.json()) as { email?: string };
  return json.email ?? "Google account";
}

function htmlPage(title: string, message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:-apple-system,sans-serif;background:#05040f;color:#f4f2ff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{background:#12102a;border:1px solid rgba(140,130,255,.18);border-radius:20px;padding:32px;max-width:360px;text-align:center}</style>
</head><body><div class="card"><h2>${title}</h2><p>${message}</p></div></body></html>`;
}

/** Mounted at /api/connectors/google/callback — this is Google's own OAuth redirect target, not a normal authenticated API route. */
export const googleConnectorCallbackRouter = Router();

googleConnectorCallbackRouter.get("/", async (req, res) => {
  const { code, state, error } = req.query as { code?: string; state?: string; error?: string };

  if (error) return res.status(400).send(htmlPage("Connection cancelled", "You can close this tab and return to NexaAi."));
  if (!code || !state) return res.status(400).send(htmlPage("Something went wrong", "Missing code or state from Google."));

  let userId: string;
  try {
    const payload = jwt.verify(state, process.env.JWT_SECRET!) as { userId: string; purpose: string };
    if (payload.purpose !== "google_connector_state") throw new Error("bad state purpose");
    userId = payload.userId;
  } catch {
    return res.status(400).send(htmlPage("Link expired", "This connection link expired or is invalid — go back to NexaAi and try again."));
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const email = await fetchGoogleEmail(tokens.access_token);

    const [existing] = await db.select().from(connectors).where(and(eq(connectors.userId, userId), eq(connectors.provider, "google")));
    const values = {
      status: "connected" as const,
      externalAccountLabel: email,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      connectedAt: new Date(),
    };
    if (existing) {
      await db.update(connectors).set(values).where(eq(connectors.id, existing.id));
    } else {
      await db.insert(connectors).values({ userId, provider: "google", ...values });
    }

    res.send(htmlPage("Connected!", `NexaAi is now linked to ${email}. You can close this tab and return to the app.`));
  } catch (err) {
    res.status(500).send(htmlPage("Connection failed", err instanceof Error ? err.message : "Please try again."));
  }
});
