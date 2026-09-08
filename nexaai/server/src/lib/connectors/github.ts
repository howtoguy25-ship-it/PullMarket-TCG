// Real GitHub OAuth 2.0 (Authorization Code) flow for the Connectors screen
// — lets a Project's generated code actually get pushed to a repo the user
// owns (see routes/projects.ts). Mirrors lib/connectors/google.ts's shape.
//
// Setup required (real, your own GitHub OAuth App):
//   1. github.com/settings/developers -> "New OAuth App".
//   2. Authorization callback URL: <APP_BASE_URL>/api/connectors/github/callback
//   3. Set GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET / APP_BASE_URL.

import { Router } from "express";
import jwt from "jsonwebtoken";
import { eq, and } from "drizzle-orm";
import { db } from "../../db";
import { connectors } from "@shared/schema";

const SCOPE = "repo read:user";

export function isGitHubConnectorConfigured(): boolean {
  return !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET && process.env.APP_BASE_URL);
}

function redirectUri(): string {
  return `${process.env.APP_BASE_URL}/api/connectors/github/callback`;
}

export function buildGitHubAuthUrl(userId: string): string {
  const state = jwt.sign({ userId, purpose: "github_connector_state" }, process.env.JWT_SECRET!, { expiresIn: "10m" });
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID!,
    redirect_uri: redirectUri(),
    scope: SCOPE,
    state,
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

async function exchangeCodeForToken(code: string): Promise<string> {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri(),
    }),
  });
  if (!response.ok) throw new Error(`GitHub token exchange failed: ${response.status} ${await response.text()}`);
  const json = (await response.json()) as { access_token?: string; error_description?: string };
  if (!json.access_token) throw new Error(json.error_description ?? "GitHub did not return an access token");
  return json.access_token;
}

async function fetchGitHubLogin(accessToken: string): Promise<string> {
  const response = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "NexaAi" },
  });
  if (!response.ok) return "GitHub account";
  const json = (await response.json()) as { login?: string };
  return json.login ? `@${json.login}` : "GitHub account";
}

function htmlPage(title: string, message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:-apple-system,sans-serif;background:#05040f;color:#f4f2ff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{background:#12102a;border:1px solid rgba(140,130,255,.18);border-radius:20px;padding:32px;max-width:360px;text-align:center}</style>
</head><body><div class="card"><h2>${title}</h2><p>${message}</p></div></body></html>`;
}

/** Mounted at /api/connectors/github/callback — GitHub's own OAuth redirect target. */
export const githubConnectorCallbackRouter = Router();

githubConnectorCallbackRouter.get("/", async (req, res) => {
  const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
  if (error) return res.status(400).send(htmlPage("Connection cancelled", "You can close this tab and return to NexaAi."));
  if (!code || !state) return res.status(400).send(htmlPage("Something went wrong", "Missing code or state from GitHub."));

  let userId: string;
  try {
    const payload = jwt.verify(state, process.env.JWT_SECRET!) as { userId: string; purpose: string };
    if (payload.purpose !== "github_connector_state") throw new Error("bad state purpose");
    userId = payload.userId;
  } catch {
    return res.status(400).send(htmlPage("Link expired", "This connection link expired or is invalid — go back to NexaAi and try again."));
  }

  try {
    const accessToken = await exchangeCodeForToken(code);
    const login = await fetchGitHubLogin(accessToken);

    const values = { status: "connected" as const, externalAccountLabel: login, accessToken, connectedAt: new Date() };
    const [existing] = await db.select().from(connectors).where(and(eq(connectors.userId, userId), eq(connectors.provider, "github")));
    if (existing) {
      await db.update(connectors).set(values).where(eq(connectors.id, existing.id));
    } else {
      await db.insert(connectors).values({ userId, provider: "github", ...values });
    }

    res.send(htmlPage("Connected!", `NexaAi is now linked to ${login}. You can close this tab and return to the app.`));
  } catch (err) {
    res.status(500).send(htmlPage("Connection failed", err instanceof Error ? err.message : "Please try again."));
  }
});
