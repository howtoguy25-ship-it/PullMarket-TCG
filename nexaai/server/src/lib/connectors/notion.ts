// Real Notion connector — OAuth 2.0 ("public integration"). Once
// connected, lib/notionContext.ts pulls real, live content from the
// user's own workspace and injects it into chat so NexaAi can actually
// answer from it — not just list page titles.
//
// Setup required (in your own integration at notion.so/my-integrations,
// then here):
//   1. Create a "Public" integration (not internal) so it can be
//      installed by any NexaAi user via OAuth, not just your own account.
//   2. Redirect URI: <APP_BASE_URL>/api/connectors/notion/callback
//   3. Set NOTION_CLIENT_ID / NOTION_CLIENT_SECRET / APP_BASE_URL here.
//
// One real constraint worth knowing: Notion's integration only sees pages
// the workspace member explicitly shares with it (via each page's "..." ->
// "Connections" menu) — there is no "grant access to everything" option,
// by Notion's own design. NexaAi is honest about this in the app (see
// PROVIDER_META's description) rather than implying full-workspace access.

import { Router } from "express";
import jwt from "jsonwebtoken";
import { eq, and } from "drizzle-orm";
import { db } from "../../db";
import { connectors } from "@shared/schema";
import { appBaseUrl } from "../appBaseUrl";

export function isNotionConfigured(): boolean {
  return !!(process.env.NOTION_CLIENT_ID && process.env.NOTION_CLIENT_SECRET && process.env.APP_BASE_URL);
}

function redirectUri(): string {
  return `${appBaseUrl()}/api/connectors/notion/callback`;
}

export function buildNotionAuthUrl(userId: string): string {
  const state = jwt.sign({ userId, purpose: "notion_connector_state" }, process.env.JWT_SECRET!, { expiresIn: "10m" });
  const params = new URLSearchParams({
    client_id: process.env.NOTION_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: "code",
    owner: "user",
    state,
  });
  return `https://api.notion.com/v1/oauth/authorize?${params.toString()}`;
}

interface NotionTokenResponse {
  access_token: string;
  workspace_id: string;
  workspace_name: string;
}

async function exchangeCodeForToken(code: string): Promise<NotionTokenResponse> {
  const basicAuth = Buffer.from(`${process.env.NOTION_CLIENT_ID}:${process.env.NOTION_CLIENT_SECRET}`).toString("base64");
  const response = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Basic ${basicAuth}` },
    body: JSON.stringify({ grant_type: "authorization_code", code, redirect_uri: redirectUri() }),
  });
  if (!response.ok) throw new Error(`Notion token exchange failed: ${response.status} ${await response.text()}`);
  return (await response.json()) as NotionTokenResponse;
}

function htmlPage(title: string, message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:-apple-system,sans-serif;background:#05040f;color:#f4f2ff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{background:#12102a;border:1px solid rgba(140,130,255,.18);border-radius:20px;padding:32px;max-width:380px;text-align:center}</style>
</head><body><div class="card"><h2>${title}</h2><p>${message}</p></div></body></html>`;
}

/** Mounted at /api/connectors/notion/callback — Notion's own OAuth redirect target. */
export const notionConnectorCallbackRouter = Router();

notionConnectorCallbackRouter.get("/", async (req, res) => {
  const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
  if (error) return res.status(400).send(htmlPage("Connection cancelled", "You can close this tab and return to NexaAi."));
  if (!code || !state) return res.status(400).send(htmlPage("Something went wrong", "Missing code or state from Notion."));

  let userId: string;
  try {
    const payload = jwt.verify(state, process.env.JWT_SECRET!) as { userId: string; purpose: string };
    if (payload.purpose !== "notion_connector_state") throw new Error("bad state purpose");
    userId = payload.userId;
  } catch {
    return res.status(400).send(htmlPage("Link expired", "This connection link expired or is invalid — go back to NexaAi and try again."));
  }

  try {
    const token = await exchangeCodeForToken(code);
    const values = {
      status: "connected" as const,
      externalAccountLabel: token.workspace_name,
      accessToken: token.access_token,
      providerMetadata: { workspaceId: token.workspace_id },
      connectedAt: new Date(),
    };
    const [existing] = await db.select().from(connectors).where(and(eq(connectors.userId, userId), eq(connectors.provider, "notion")));
    if (existing) {
      await db.update(connectors).set(values).where(eq(connectors.id, existing.id));
    } else {
      await db.insert(connectors).values({ userId, provider: "notion", ...values });
    }

    res.send(
      htmlPage(
        "Connected!",
        `NexaAi can now read pages you've shared with it in ${token.workspace_name}. Share specific pages with the integration from each page's "..." menu -> Connections. You can close this tab and return to the app.`,
      ),
    );
  } catch (err) {
    res.status(500).send(htmlPage("Connection failed", err instanceof Error ? err.message : "Please try again."));
  }
});
