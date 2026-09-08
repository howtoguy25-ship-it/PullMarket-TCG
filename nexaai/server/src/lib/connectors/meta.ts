// Real Meta connector setup for the agent builder's live-send capability.
//
// Two different real onboarding shapes, because that's how Meta's own
// platforms actually work — this isn't a simplification on my part:
//
// - Instagram: a real OAuth 2.0 "Facebook Login for Business" flow. After
//   login, we discover which Facebook Page (and its linked Instagram
//   professional account) the user manages, and store that Page's own
//   access token — Instagram messaging is sent through the connected Page.
// - WhatsApp: WhatsApp Cloud API access is normally set up once in Meta
//   Business Suite, which hands you a permanent access token and a
//   phone_number_id directly — there's no consumer-facing OAuth redirect
//   for this outside Meta's gated "Embedded Signup" program (which needs
//   separate business verification). So this is a manual paste-your-
//   credentials flow instead of a redirect, which is the real, standard
//   way third-party apps integrate WhatsApp Cloud API without Embedded Signup.
//
// IMPORTANT: both of these only work with accounts you've added as
// Testers/Developers on your Meta app until Meta approves your App Review
// submission for `instagram_manage_messages` (Instagram) and
// `whatsapp_business_messaging` (WhatsApp) — that review is a real external
// process outside this code's control.

import { Router } from "express";
import jwt from "jsonwebtoken";
import { eq, and } from "drizzle-orm";
import { db } from "../../db";
import { connectors } from "@shared/schema";

const GRAPH_VERSION = "v19.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export function isMetaConfigured(): boolean {
  return !!(process.env.META_APP_ID && process.env.META_APP_SECRET && process.env.APP_BASE_URL);
}

function redirectUri(): string {
  return `${process.env.APP_BASE_URL}/api/connectors/meta/callback`;
}

const INSTAGRAM_SCOPES = ["instagram_basic", "instagram_manage_messages", "pages_show_list", "pages_messaging"].join(",");

export function buildInstagramAuthUrl(userId: string): string {
  const state = jwt.sign({ userId, purpose: "meta_connector_state" }, process.env.JWT_SECRET!, { expiresIn: "10m" });
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID!,
    redirect_uri: redirectUri(),
    state,
    scope: INSTAGRAM_SCOPES,
    response_type: "code",
  });
  return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params.toString()}`;
}

async function exchangeCodeForUserToken(code: string): Promise<string> {
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID!,
    redirect_uri: redirectUri(),
    client_secret: process.env.META_APP_SECRET!,
    code,
  });
  const response = await fetch(`${GRAPH_BASE}/oauth/access_token?${params.toString()}`);
  if (!response.ok) throw new Error(`Meta token exchange failed: ${response.status} ${await response.text()}`);
  const json = (await response.json()) as { access_token: string };
  return json.access_token;
}

async function exchangeForLongLivedToken(shortLivedToken: string): Promise<string> {
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: process.env.META_APP_ID!,
    client_secret: process.env.META_APP_SECRET!,
    fb_exchange_token: shortLivedToken,
  });
  const response = await fetch(`${GRAPH_BASE}/oauth/access_token?${params.toString()}`);
  if (!response.ok) throw new Error(`Meta long-lived token exchange failed: ${response.status} ${await response.text()}`);
  const json = (await response.json()) as { access_token: string };
  return json.access_token;
}

interface PageWithInstagram {
  pageId: string;
  pageName: string;
  pageAccessToken: string;
  igUserId: string | null;
  igUsername: string | null;
}

/** Finds the first Facebook Page (of pages this user manages) that has a linked Instagram professional account. */
async function findConnectedInstagramPage(userAccessToken: string): Promise<PageWithInstagram | null> {
  const pagesResponse = await fetch(`${GRAPH_BASE}/me/accounts?access_token=${encodeURIComponent(userAccessToken)}`);
  if (!pagesResponse.ok) throw new Error(`Failed to list Facebook Pages: ${pagesResponse.status} ${await pagesResponse.text()}`);
  const pagesJson = (await pagesResponse.json()) as { data: { id: string; name: string; access_token: string }[] };

  for (const page of pagesJson.data ?? []) {
    const igResponse = await fetch(
      `${GRAPH_BASE}/${page.id}?fields=instagram_business_account{id,username}&access_token=${encodeURIComponent(page.access_token)}`,
    );
    if (!igResponse.ok) continue;
    const igJson = (await igResponse.json()) as { instagram_business_account?: { id: string; username: string } };
    if (igJson.instagram_business_account) {
      return {
        pageId: page.id,
        pageName: page.name,
        pageAccessToken: page.access_token,
        igUserId: igJson.instagram_business_account.id,
        igUsername: igJson.instagram_business_account.username,
      };
    }
  }
  return null;
}

function htmlPage(title: string, message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:-apple-system,sans-serif;background:#05040f;color:#f4f2ff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{background:#12102a;border:1px solid rgba(140,130,255,.18);border-radius:20px;padding:32px;max-width:380px;text-align:center}</style>
</head><body><div class="card"><h2>${title}</h2><p>${message}</p></div></body></html>`;
}

/** Mounted at /api/connectors/meta/callback — Meta's own OAuth redirect target. */
export const metaConnectorCallbackRouter = Router();

metaConnectorCallbackRouter.get("/", async (req, res) => {
  const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
  if (error) return res.status(400).send(htmlPage("Connection cancelled", "You can close this tab and return to NexaAi."));
  if (!code || !state) return res.status(400).send(htmlPage("Something went wrong", "Missing code or state from Meta."));

  let userId: string;
  try {
    const payload = jwt.verify(state, process.env.JWT_SECRET!) as { userId: string; purpose: string };
    if (payload.purpose !== "meta_connector_state") throw new Error("bad state purpose");
    userId = payload.userId;
  } catch {
    return res.status(400).send(htmlPage("Link expired", "This connection link expired or is invalid — go back to NexaAi and try again."));
  }

  try {
    const shortLived = await exchangeCodeForUserToken(code);
    const longLived = await exchangeForLongLivedToken(shortLived);
    const page = await findConnectedInstagramPage(longLived);

    if (!page || !page.igUserId) {
      return res
        .status(400)
        .send(
          htmlPage(
            "No Instagram account found",
            "We couldn't find a Facebook Page you manage with a linked Instagram professional account. Connect your Instagram to a Facebook Page in Meta Business Suite first, then try again.",
          ),
        );
    }

    const values = {
      status: "connected" as const,
      externalAccountLabel: page.igUsername ? `@${page.igUsername}` : page.pageName,
      accessToken: page.pageAccessToken,
      providerMetadata: { pageId: page.pageId, igUserId: page.igUserId },
      connectedAt: new Date(),
    };
    const [existing] = await db.select().from(connectors).where(and(eq(connectors.userId, userId), eq(connectors.provider, "instagram")));
    if (existing) {
      await db.update(connectors).set(values).where(eq(connectors.id, existing.id));
    } else {
      await db.insert(connectors).values({ userId, provider: "instagram", ...values });
    }

    res.send(htmlPage("Connected!", `NexaAi can now reply as ${values.externalAccountLabel}. You can close this tab and return to the app.`));
  } catch (err) {
    res.status(500).send(htmlPage("Connection failed", err instanceof Error ? err.message : "Please try again."));
  }
});

/** Manual WhatsApp Cloud API connection — see file header for why this isn't an OAuth redirect. */
export async function connectWhatsAppManually(
  userId: string,
  accessToken: string,
  phoneNumberId: string,
  businessName: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const verifyResponse = await fetch(`${GRAPH_BASE}/${phoneNumberId}?access_token=${encodeURIComponent(accessToken)}`);
  if (!verifyResponse.ok) {
    return { ok: false, message: `Couldn't verify that phone number ID with the given access token: ${await verifyResponse.text()}` };
  }

  const values = {
    status: "connected" as const,
    externalAccountLabel: businessName,
    accessToken,
    providerMetadata: { phoneNumberId },
    connectedAt: new Date(),
  };
  const [existing] = await db.select().from(connectors).where(and(eq(connectors.userId, userId), eq(connectors.provider, "whatsapp")));
  if (existing) {
    await db.update(connectors).set(values).where(eq(connectors.id, existing.id));
  } else {
    await db.insert(connectors).values({ userId, provider: "whatsapp", ...values });
  }
  return { ok: true };
}
