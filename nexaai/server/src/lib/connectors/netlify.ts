// Real Netlify OAuth 2.0 flow — real one-click deploy target for a
// Project's generated site (see routes/projects.ts). Mirrors
// lib/connectors/google.ts's shape.
//
// Setup required (real, your own Netlify OAuth application):
//   1. app.netlify.com/user/applications -> "New OAuth App".
//   2. Redirect URI: <APP_BASE_URL>/api/connectors/netlify/callback
//   3. Set NETLIFY_CLIENT_ID / NETLIFY_CLIENT_SECRET / APP_BASE_URL.

import { Router } from "express";
import jwt from "jsonwebtoken";
import { eq, and } from "drizzle-orm";
import { db } from "../../db";
import { connectors } from "@shared/schema";

export function isNetlifyConnectorConfigured(): boolean {
  return !!(process.env.NETLIFY_CLIENT_ID && process.env.NETLIFY_CLIENT_SECRET && process.env.APP_BASE_URL);
}

function redirectUri(): string {
  return `${process.env.APP_BASE_URL}/api/connectors/netlify/callback`;
}

export function buildNetlifyAuthUrl(userId: string): string {
  const state = jwt.sign({ userId, purpose: "netlify_connector_state" }, process.env.JWT_SECRET!, { expiresIn: "10m" });
  const params = new URLSearchParams({
    client_id: process.env.NETLIFY_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: "code",
    state,
  });
  return `https://app.netlify.com/authorize?${params.toString()}`;
}

async function exchangeCodeForToken(code: string): Promise<string> {
  const response = await fetch("https://api.netlify.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: process.env.NETLIFY_CLIENT_ID!,
      client_secret: process.env.NETLIFY_CLIENT_SECRET!,
      redirect_uri: redirectUri(),
    }),
  });
  if (!response.ok) throw new Error(`Netlify token exchange failed: ${response.status} ${await response.text()}`);
  const json = (await response.json()) as { access_token: string };
  return json.access_token;
}

async function fetchNetlifyEmail(accessToken: string): Promise<string> {
  const response = await fetch("https://api.netlify.com/api/v1/user", { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) return "Netlify account";
  const json = (await response.json()) as { email?: string };
  return json.email ?? "Netlify account";
}

function htmlPage(title: string, message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:-apple-system,sans-serif;background:#05040f;color:#f4f2ff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{background:#12102a;border:1px solid rgba(140,130,255,.18);border-radius:20px;padding:32px;max-width:360px;text-align:center}</style>
</head><body><div class="card"><h2>${title}</h2><p>${message}</p></div></body></html>`;
}

/** Mounted at /api/connectors/netlify/callback — Netlify's own OAuth redirect target. */
export const netlifyConnectorCallbackRouter = Router();

netlifyConnectorCallbackRouter.get("/", async (req, res) => {
  const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
  if (error) return res.status(400).send(htmlPage("Connection cancelled", "You can close this tab and return to NexaAi."));
  if (!code || !state) return res.status(400).send(htmlPage("Something went wrong", "Missing code or state from Netlify."));

  let userId: string;
  try {
    const payload = jwt.verify(state, process.env.JWT_SECRET!) as { userId: string; purpose: string };
    if (payload.purpose !== "netlify_connector_state") throw new Error("bad state purpose");
    userId = payload.userId;
  } catch {
    return res.status(400).send(htmlPage("Link expired", "This connection link expired or is invalid — go back to NexaAi and try again."));
  }

  try {
    const accessToken = await exchangeCodeForToken(code);
    const email = await fetchNetlifyEmail(accessToken);

    const values = { status: "connected" as const, externalAccountLabel: email, accessToken, connectedAt: new Date() };
    const [existing] = await db.select().from(connectors).where(and(eq(connectors.userId, userId), eq(connectors.provider, "netlify")));
    if (existing) {
      await db.update(connectors).set(values).where(eq(connectors.id, existing.id));
    } else {
      await db.insert(connectors).values({ userId, provider: "netlify", ...values });
    }

    res.send(htmlPage("Connected!", `NexaAi is now linked to ${email}. You can close this tab and return to the app.`));
  } catch (err) {
    res.status(500).send(htmlPage("Connection failed", err instanceof Error ? err.message : "Please try again."));
  }
});
