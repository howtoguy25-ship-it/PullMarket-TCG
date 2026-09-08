// Real Stripe Connect OAuth flow — lets a site a user builds actually take
// real payments through their own Stripe account (see routes/projects.ts).
//
// Setup required (real, your own Stripe platform settings):
//   1. dashboard.stripe.com/settings/connect/onboarding-options -> enable OAuth.
//   2. Redirect URI: <APP_BASE_URL>/api/connectors/stripe/callback
//   3. Set STRIPE_CLIENT_ID (the "Connect" client ID, starts with "ca_") /
//      STRIPE_SECRET_KEY (your platform's own secret key, used to redeem the
//      code) / APP_BASE_URL.

import { Router } from "express";
import jwt from "jsonwebtoken";
import { eq, and } from "drizzle-orm";
import { db } from "../../db";
import { connectors } from "@shared/schema";

export function isStripeConnectorConfigured(): boolean {
  return !!(process.env.STRIPE_CLIENT_ID && process.env.STRIPE_SECRET_KEY && process.env.APP_BASE_URL);
}

function redirectUri(): string {
  return `${process.env.APP_BASE_URL}/api/connectors/stripe/callback`;
}

export function buildStripeAuthUrl(userId: string): string {
  const state = jwt.sign({ userId, purpose: "stripe_connector_state" }, process.env.JWT_SECRET!, { expiresIn: "10m" });
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.STRIPE_CLIENT_ID!,
    scope: "read_write",
    redirect_uri: redirectUri(),
    state,
  });
  return `https://connect.stripe.com/oauth/authorize?${params.toString()}`;
}

interface StripeTokenResponse {
  access_token: string;
  refresh_token?: string;
  stripe_user_id: string;
}

async function exchangeCodeForToken(code: string): Promise<StripeTokenResponse> {
  const response = await fetch("https://connect.stripe.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_secret: process.env.STRIPE_SECRET_KEY!,
      code,
      grant_type: "authorization_code",
    }),
  });
  const json = (await response.json()) as StripeTokenResponse & { error?: string; error_description?: string };
  if (!response.ok || json.error) throw new Error(json.error_description ?? `Stripe token exchange failed: ${response.status}`);
  return json;
}

async function fetchStripeAccountLabel(stripeUserId: string): Promise<string> {
  const response = await fetch(`https://api.stripe.com/v1/accounts/${stripeUserId}`, {
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
  });
  if (!response.ok) return stripeUserId;
  const json = (await response.json()) as { business_profile?: { name?: string }; email?: string };
  return json.business_profile?.name ?? json.email ?? stripeUserId;
}

function htmlPage(title: string, message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:-apple-system,sans-serif;background:#05040f;color:#f4f2ff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{background:#12102a;border:1px solid rgba(140,130,255,.18);border-radius:20px;padding:32px;max-width:360px;text-align:center}</style>
</head><body><div class="card"><h2>${title}</h2><p>${message}</p></div></body></html>`;
}

/** Mounted at /api/connectors/stripe/callback — Stripe's own OAuth redirect target. */
export const stripeConnectorCallbackRouter = Router();

stripeConnectorCallbackRouter.get("/", async (req, res) => {
  const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
  if (error) return res.status(400).send(htmlPage("Connection cancelled", "You can close this tab and return to NexaAi."));
  if (!code || !state) return res.status(400).send(htmlPage("Something went wrong", "Missing code or state from Stripe."));

  let userId: string;
  try {
    const payload = jwt.verify(state, process.env.JWT_SECRET!) as { userId: string; purpose: string };
    if (payload.purpose !== "stripe_connector_state") throw new Error("bad state purpose");
    userId = payload.userId;
  } catch {
    return res.status(400).send(htmlPage("Link expired", "This connection link expired or is invalid — go back to NexaAi and try again."));
  }

  try {
    const tokens = await exchangeCodeForToken(code);
    const label = await fetchStripeAccountLabel(tokens.stripe_user_id);

    const values = {
      status: "connected" as const,
      externalAccountLabel: label,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      providerMetadata: { stripeUserId: tokens.stripe_user_id },
      connectedAt: new Date(),
    };
    const [existing] = await db.select().from(connectors).where(and(eq(connectors.userId, userId), eq(connectors.provider, "stripe")));
    if (existing) {
      await db.update(connectors).set(values).where(eq(connectors.id, existing.id));
    } else {
      await db.insert(connectors).values({ userId, provider: "stripe", ...values });
    }

    res.send(htmlPage("Connected!", `NexaAi is now linked to ${label}. You can close this tab and return to the app.`));
  } catch (err) {
    res.status(500).send(htmlPage("Connection failed", err instanceof Error ? err.message : "Please try again."));
  }
});
