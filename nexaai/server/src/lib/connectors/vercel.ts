// Real Vercel Integration OAuth flow — real one-click deploy target for a
// Project's generated site (see routes/projects.ts).
//
// Vercel's integration OAuth is shaped a little differently from a plain
// OAuth2 client (Google/GitHub/Netlify above): the "authorize URL" isn't a
// generic endpoint you build query params onto — it's a fixed install URL
// tied to an Integration you create in Vercel's own dashboard, keyed by that
// integration's slug.
//
// Setup required (real, your own Vercel Integration):
//   1. vercel.com/dashboard/integrations/console -> "Create Integration".
//   2. Redirect URL: <APP_BASE_URL>/api/connectors/vercel/callback
//   3. Note the integration's slug, Client ID, and Client Secret.
//   4. Set VERCEL_CLIENT_ID / VERCEL_CLIENT_SECRET / VERCEL_INTEGRATION_SLUG / APP_BASE_URL.

import { Router } from "express";
import jwt from "jsonwebtoken";
import { eq, and } from "drizzle-orm";
import { db } from "../../db";
import { connectors } from "@shared/schema";

export function isVercelConnectorConfigured(): boolean {
  return !!(process.env.VERCEL_CLIENT_ID && process.env.VERCEL_CLIENT_SECRET && process.env.VERCEL_INTEGRATION_SLUG && process.env.APP_BASE_URL);
}

function redirectUri(): string {
  return `${process.env.APP_BASE_URL}/api/connectors/vercel/callback`;
}

export function buildVercelAuthUrl(userId: string): string {
  const state = jwt.sign({ userId, purpose: "vercel_connector_state" }, process.env.JWT_SECRET!, { expiresIn: "10m" });
  // Vercel's install flow reads redirect target from the integration's own
  // dashboard config, not a query param — `next` carries our state through.
  const params = new URLSearchParams({ next: `${redirectUri()}?state=${encodeURIComponent(state)}` });
  return `https://vercel.com/integrations/${process.env.VERCEL_INTEGRATION_SLUG}/new?${params.toString()}`;
}

interface VercelTokenResponse {
  access_token: string;
  team_id?: string | null;
  user_id?: string;
}

async function exchangeCodeForToken(code: string): Promise<VercelTokenResponse> {
  const response = await fetch("https://api.vercel.com/v2/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.VERCEL_CLIENT_ID!,
      client_secret: process.env.VERCEL_CLIENT_SECRET!,
      code,
      redirect_uri: redirectUri(),
    }),
  });
  if (!response.ok) throw new Error(`Vercel token exchange failed: ${response.status} ${await response.text()}`);
  return response.json() as Promise<VercelTokenResponse>;
}

async function fetchVercelUsername(accessToken: string): Promise<string> {
  const response = await fetch("https://api.vercel.com/v2/user", { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) return "Vercel account";
  const json = (await response.json()) as { user?: { username?: string; email?: string } };
  return json.user?.username ?? json.user?.email ?? "Vercel account";
}

function htmlPage(title: string, message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:-apple-system,sans-serif;background:#05040f;color:#f4f2ff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{background:#12102a;border:1px solid rgba(140,130,255,.18);border-radius:20px;padding:32px;max-width:360px;text-align:center}</style>
</head><body><div class="card"><h2>${title}</h2><p>${message}</p></div></body></html>`;
}

/** Mounted at /api/connectors/vercel/callback — Vercel's own install redirect target. */
export const vercelConnectorCallbackRouter = Router();

vercelConnectorCallbackRouter.get("/", async (req, res) => {
  const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
  if (error) return res.status(400).send(htmlPage("Connection cancelled", "You can close this tab and return to NexaAi."));
  if (!code || !state) return res.status(400).send(htmlPage("Something went wrong", "Missing code or state from Vercel."));

  let userId: string;
  try {
    const payload = jwt.verify(state, process.env.JWT_SECRET!) as { userId: string; purpose: string };
    if (payload.purpose !== "vercel_connector_state") throw new Error("bad state purpose");
    userId = payload.userId;
  } catch {
    return res.status(400).send(htmlPage("Link expired", "This connection link expired or is invalid — go back to NexaAi and try again."));
  }

  try {
    const tokens = await exchangeCodeForToken(code);
    const label = await fetchVercelUsername(tokens.access_token);

    const values = {
      status: "connected" as const,
      externalAccountLabel: label,
      accessToken: tokens.access_token,
      providerMetadata: { teamId: tokens.team_id ?? null },
      connectedAt: new Date(),
    };
    const [existing] = await db.select().from(connectors).where(and(eq(connectors.userId, userId), eq(connectors.provider, "vercel")));
    if (existing) {
      await db.update(connectors).set(values).where(eq(connectors.id, existing.id));
    } else {
      await db.insert(connectors).values({ userId, provider: "vercel", ...values });
    }

    res.send(htmlPage("Connected!", `NexaAi is now linked to ${label}. You can close this tab and return to the app.`));
  } catch (err) {
    res.status(500).send(htmlPage("Connection failed", err instanceof Error ? err.message : "Please try again."));
  }
});
