// SiteSpark connector — same shape as this file's Google/GitHub/Netlify
// siblings, but genuinely different in one respect: SiteSpark is the user's
// own separate app, so there's no fixed provider to point at. This is a
// real, generic OAuth 2.0 Authorization Code client (RFC 6749) — it becomes
// functional the moment SiteSpark implements the matching endpoints a
// standard OAuth provider needs, PLUS one real import endpoint that turns a
// NexaAi Project's generated files into an actual SiteSpark site:
//   1. An authorize endpoint (GET, redirects back with ?code=&state=)
//   2. A token endpoint (POST, exchanges code -> access_token)
//   3. A "who am I" endpoint (GET, returns the connected account's identity)
//   4. A site-import endpoint (POST, see pushProjectToSiteSpark below) —
//      this is the piece that makes routes/projects.ts's
//      "Export to SiteSpark" action real instead of OAuth-only.
//
// Setup required (in your own SiteSpark app, then here):
//   1. Build those endpoints in SiteSpark, and register
//      <APP_BASE_URL>/api/connectors/sitespark/callback as an allowed
//      redirect URI for a SiteSpark OAuth client.
//   2. Set SITESPARK_CLIENT_ID / SITESPARK_CLIENT_SECRET /
//      SITESPARK_OAUTH_BASE_URL / SITESPARK_API_BASE_URL (SiteSpark's own
//      base URL, e.g. https://buildsitespark.com — often the same host as
//      SITESPARK_OAUTH_BASE_URL) / APP_BASE_URL here.
//   3. Set SITESPARK_API_KEY — a platform-level secret (sisp_live_...) that
//      authenticates NexaAi itself as the calling application on the
//      site-import call below, sent as X-Api-Key alongside the per-user
//      OAuth bearer token. Rotate it in SiteSpark's dashboard if it's ever
//      been exposed, and never commit the real value — only .env.example's
//      blank placeholder belongs in git.
//
// Until SiteSpark's own endpoints exist, this stays visible in the
// Connectors list as "not set up yet" — the same honest pattern every other
// not-yet-configured connector in this app uses — and any export attempt
// fails with a clear, honest error rather than a fake success.

import { Router } from "express";
import jwt from "jsonwebtoken";
import { eq, and } from "drizzle-orm";
import { db } from "../../db";
import { connectors } from "@shared/schema";
import { appBaseUrl } from "../appBaseUrl";

export function isSiteSparkConnectorConfigured(): boolean {
  return !!(
    process.env.SITESPARK_CLIENT_ID &&
    process.env.SITESPARK_CLIENT_SECRET &&
    process.env.SITESPARK_OAUTH_BASE_URL &&
    process.env.APP_BASE_URL
  );
}

function redirectUri(): string {
  return `${appBaseUrl()}/api/connectors/sitespark/callback`;
}

export function buildSiteSparkAuthUrl(userId: string): string {
  const state = jwt.sign({ userId, purpose: "sitespark_connector_state" }, process.env.JWT_SECRET!, { expiresIn: "10m" });
  const params = new URLSearchParams({
    client_id: process.env.SITESPARK_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: "code",
    state,
  });
  return `${process.env.SITESPARK_OAUTH_BASE_URL}/oauth/authorize?${params.toString()}`;
}

async function exchangeCodeForToken(code: string): Promise<string> {
  const response = await fetch(`${process.env.SITESPARK_OAUTH_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: process.env.SITESPARK_CLIENT_ID!,
      client_secret: process.env.SITESPARK_CLIENT_SECRET!,
      redirect_uri: redirectUri(),
    }),
  });
  if (!response.ok) throw new Error(`SiteSpark token exchange failed: ${response.status} ${await response.text()}`);
  const json = (await response.json()) as { access_token: string };
  return json.access_token;
}

async function fetchSiteSparkIdentity(accessToken: string): Promise<string> {
  const response = await fetch(`${process.env.SITESPARK_OAUTH_BASE_URL}/api/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) return "SiteSpark account";
  const json = (await response.json()) as { username?: string; email?: string };
  return json.username ?? json.email ?? "SiteSpark account";
}

export function isSiteSparkApiConfigured(): boolean {
  return !!(process.env.SITESPARK_API_BASE_URL && process.env.SITESPARK_API_KEY);
}

/** Real per-user check: does this specific user have a connected SiteSpark account with a usable token? Same lookup routes/projects.ts's manual export already did inline — pulled out here so Smart Build (routes/chat.ts) can reuse it instead of duplicating the query. */
export async function isSiteSparkConnected(userId: string): Promise<{ connected: true; accessToken: string } | { connected: false }> {
  const [connector] = await db
    .select()
    .from(connectors)
    .where(and(eq(connectors.userId, userId), eq(connectors.provider, "sitespark"), eq(connectors.status, "connected")));
  return connector?.accessToken ? { connected: true, accessToken: connector.accessToken } : { connected: false };
}

export interface SiteSparkFile {
  path: string;
  content: string;
}

export interface SiteSparkImportResult {
  siteId: string;
  url: string;
}

/**
 * Pushes a NexaAi Project's real generated files into SiteSpark as one
 * site, real files in, real site out — no local zipping/hosting, SiteSpark
 * does the actual build/hosting on its own side. `externalRef` is the
 * NexaAi project's own id: SiteSpark's import endpoint should key on it so
 * re-exporting the same project updates that project's existing SiteSpark
 * site instead of creating a new one every time.
 *
 * Expected contract (build this in your SiteSpark app):
 *   POST {SITESPARK_API_BASE_URL}/api/v1/sites/import
 *   Authorization: Bearer <the OAuth access_token from this same connector>
 *   X-Api-Key: <SITESPARK_API_KEY — identifies NexaAi itself as the calling app>
 *   Body: { "externalRef": string, "name": string, "files": [{ "path": string, "content": string }] }
 *   200 response: { "siteId": string, "url": string }
 *   Any 4xx/5xx is surfaced to the NexaAi user verbatim — never silently retried as a success.
 */
export async function pushProjectToSiteSpark(
  accessToken: string,
  params: { externalRef: string; name: string; files: SiteSparkFile[] },
): Promise<SiteSparkImportResult> {
  if (!isSiteSparkApiConfigured()) {
    throw new Error("SITESPARK_API_BASE_URL / SITESPARK_API_KEY aren't both set — SiteSpark's site-import endpoint hasn't been configured yet.");
  }
  const response = await fetch(`${process.env.SITESPARK_API_BASE_URL}/api/v1/sites/import`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-Api-Key": process.env.SITESPARK_API_KEY!,
    },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    throw new Error(`SiteSpark rejected the import: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as SiteSparkImportResult;
}

function htmlPage(title: string, message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:-apple-system,sans-serif;background:#05040f;color:#f4f2ff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{background:#12102a;border:1px solid rgba(140,130,255,.18);border-radius:20px;padding:32px;max-width:360px;text-align:center}</style>
</head><body><div class="card"><h2>${title}</h2><p>${message}</p></div></body></html>`;
}

/** Mounted at /api/connectors/sitespark/callback — SiteSpark's own OAuth redirect target, once it exists. */
export const siteSparkConnectorCallbackRouter = Router();

siteSparkConnectorCallbackRouter.get("/", async (req, res) => {
  const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
  if (error) return res.status(400).send(htmlPage("Connection cancelled", "You can close this tab and return to NexaAi."));
  if (!code || !state) return res.status(400).send(htmlPage("Something went wrong", "Missing code or state from SiteSpark."));

  let userId: string;
  try {
    const payload = jwt.verify(state, process.env.JWT_SECRET!) as { userId: string; purpose: string };
    if (payload.purpose !== "sitespark_connector_state") throw new Error("bad state purpose");
    userId = payload.userId;
  } catch {
    return res.status(400).send(htmlPage("Link expired", "This connection link expired or is invalid — go back to NexaAi and try again."));
  }

  try {
    const accessToken = await exchangeCodeForToken(code);
    const label = await fetchSiteSparkIdentity(accessToken);

    const values = { status: "connected" as const, externalAccountLabel: label, accessToken, connectedAt: new Date() };
    const [existing] = await db.select().from(connectors).where(and(eq(connectors.userId, userId), eq(connectors.provider, "sitespark")));
    if (existing) {
      await db.update(connectors).set(values).where(eq(connectors.id, existing.id));
    } else {
      await db.insert(connectors).values({ userId, provider: "sitespark", ...values });
    }

    res.send(htmlPage("Connected!", `NexaAi is now linked to ${label} on SiteSpark. You can close this tab and return to the app.`));
  } catch (err) {
    res.status(500).send(htmlPage("Connection failed", err instanceof Error ? err.message : "Please try again."));
  }
});
