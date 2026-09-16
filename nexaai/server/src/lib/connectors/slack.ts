// Real Slack connector — OAuth v2 ("Add to Slack") plus the real bot
// identity (team ID + bot user ID) the agent runner needs to match an
// inbound Events API message to the right connected NexaAi account, and
// to send replies back through the real Web API.
//
// Setup required (in your own Slack app at api.slack.com/apps, then here):
//   1. OAuth & Permissions -> Redirect URLs: add
//      <APP_BASE_URL>/api/connectors/slack/callback
//   2. OAuth & Permissions -> Bot Token Scopes: chat:write, im:read, im:history
//   3. Event Subscriptions -> Request URL: <APP_BASE_URL>/api/webhooks/slack
//      (Slack calls this once with a "url_verification" challenge — the
//      webhook route below answers it for real) -> Subscribe to bot events:
//      message.im
//   4. Set SLACK_CLIENT_ID / SLACK_CLIENT_SECRET / SLACK_SIGNING_SECRET /
//      APP_BASE_URL here. The signing secret is what verifies inbound
//      Events API requests are genuinely from Slack (see
//      routes/webhooks/slack.ts), the same idea as Meta's X-Hub-Signature.

import { Router } from "express";
import jwt from "jsonwebtoken";
import { eq, and } from "drizzle-orm";
import { db } from "../../db";
import { connectors } from "@shared/schema";
import { appBaseUrl } from "../appBaseUrl";

const SLACK_BOT_SCOPES = ["chat:write", "im:read", "im:history"].join(",");

export function isSlackConfigured(): boolean {
  return !!(process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET && process.env.SLACK_SIGNING_SECRET && process.env.APP_BASE_URL);
}

function redirectUri(): string {
  return `${appBaseUrl()}/api/connectors/slack/callback`;
}

export function buildSlackAuthUrl(userId: string): string {
  const state = jwt.sign({ userId, purpose: "slack_connector_state" }, process.env.JWT_SECRET!, { expiresIn: "10m" });
  const params = new URLSearchParams({
    client_id: process.env.SLACK_CLIENT_ID!,
    redirect_uri: redirectUri(),
    scope: SLACK_BOT_SCOPES,
    state,
  });
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

interface SlackOAuthResponse {
  ok: boolean;
  error?: string;
  access_token: string; // the real bot token (xoxb-...)
  team: { id: string; name: string };
  bot_user_id: string;
}

async function exchangeCodeForToken(code: string): Promise<SlackOAuthResponse> {
  const response = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.SLACK_CLIENT_ID!,
      client_secret: process.env.SLACK_CLIENT_SECRET!,
      code,
      redirect_uri: redirectUri(),
    }),
  });
  const json = (await response.json()) as SlackOAuthResponse;
  if (!response.ok || !json.ok) throw new Error(`Slack token exchange failed: ${json.error ?? response.status}`);
  return json;
}

function htmlPage(title: string, message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:-apple-system,sans-serif;background:#05040f;color:#f4f2ff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{background:#12102a;border:1px solid rgba(140,130,255,.18);border-radius:20px;padding:32px;max-width:380px;text-align:center}</style>
</head><body><div class="card"><h2>${title}</h2><p>${message}</p></div></body></html>`;
}

/** Mounted at /api/connectors/slack/callback — Slack's own OAuth redirect target. */
export const slackConnectorCallbackRouter = Router();

slackConnectorCallbackRouter.get("/", async (req, res) => {
  const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
  if (error) return res.status(400).send(htmlPage("Connection cancelled", "You can close this tab and return to NexaAi."));
  if (!code || !state) return res.status(400).send(htmlPage("Something went wrong", "Missing code or state from Slack."));

  let userId: string;
  try {
    const payload = jwt.verify(state, process.env.JWT_SECRET!) as { userId: string; purpose: string };
    if (payload.purpose !== "slack_connector_state") throw new Error("bad state purpose");
    userId = payload.userId;
  } catch {
    return res.status(400).send(htmlPage("Link expired", "This connection link expired or is invalid — go back to NexaAi and try again."));
  }

  try {
    const result = await exchangeCodeForToken(code);
    const values = {
      status: "connected" as const,
      externalAccountLabel: result.team.name,
      accessToken: result.access_token,
      providerMetadata: { teamId: result.team.id, botUserId: result.bot_user_id },
      connectedAt: new Date(),
    };
    const [existing] = await db.select().from(connectors).where(and(eq(connectors.userId, userId), eq(connectors.provider, "slack")));
    if (existing) {
      await db.update(connectors).set(values).where(eq(connectors.id, existing.id));
    } else {
      await db.insert(connectors).values({ userId, provider: "slack", ...values });
    }

    res.send(htmlPage("Connected!", `NexaAi can now reply in ${result.team.name} on Slack. You can close this tab and return to the app.`));
  } catch (err) {
    res.status(500).send(htmlPage("Connection failed", err instanceof Error ? err.message : "Please try again."));
  }
});
