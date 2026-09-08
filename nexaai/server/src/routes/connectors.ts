import { Router } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { connectorProviderEnum, connectors, type ConnectorProvider } from "@shared/schema";
import { db } from "../db";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { buildGoogleAuthUrl, isGoogleConnectorConfigured } from "../lib/connectors/google";
import { buildInstagramAuthUrl, connectWhatsAppManually, isMetaConfigured } from "../lib/connectors/meta";
import { buildSiteSparkAuthUrl, isSiteSparkConnectorConfigured } from "../lib/connectors/sitespark";
import { buildGitHubAuthUrl, isGitHubConnectorConfigured } from "../lib/connectors/github";
import { buildVercelAuthUrl, isVercelConnectorConfigured } from "../lib/connectors/vercel";
import { buildNetlifyAuthUrl, isNetlifyConnectorConfigured } from "../lib/connectors/netlify";
import { buildStripeAuthUrl, isStripeConnectorConfigured } from "../lib/connectors/stripe";
import { connectNamecheapManually } from "../lib/connectors/namecheap";

export const connectorsRouter = Router();
connectorsRouter.use(requireAuth);

const PROVIDER_META: Record<ConnectorProvider, { label: string; description: string; icon: string }> = {
  google: { label: "Google", description: "Calendar events feed into NexaAi's answers and reminders.", icon: "google" },
  notion: { label: "Notion", description: "Let NexaAi read your workspace pages for context.", icon: "notion" },
  slack: { label: "Slack", description: "Let an agent post drafts into a Slack channel.", icon: "slack" },
  instagram: { label: "Instagram", description: "Powers the Instagram DM auto-reply agent — real send, once connected.", icon: "instagram" },
  whatsapp: { label: "WhatsApp", description: "Powers the WhatsApp autoresponder agent — real send, once connected.", icon: "whatsapp" },
  sitespark: { label: "SiteSpark", description: "Connect your SiteSpark account so NexaAi can build websites through it, if you want.", icon: "sitespark" },
  github: { label: "GitHub", description: "Push a Project's generated code to a real repo you own.", icon: "github" },
  vercel: { label: "Vercel", description: "Deploy a Project's generated site live with one click.", icon: "vercel" },
  netlify: { label: "Netlify", description: "Deploy a Project's generated site live with one click.", icon: "netlify" },
  stripe: { label: "Stripe", description: "Wire real payments/checkout into a site you build.", icon: "stripe" },
  namecheap: { label: "Namecheap", description: "Manage a custom domain for a site you build.", icon: "namecheap" },
};

// How the client should prompt the user to connect each provider.
const CONNECT_METHOD: Record<ConnectorProvider, "oauth" | "manual_entry"> = {
  google: "oauth",
  notion: "oauth",
  slack: "oauth",
  instagram: "oauth",
  whatsapp: "manual_entry", // see lib/connectors/meta.ts's header for why
  sitespark: "oauth",
  github: "oauth",
  vercel: "oauth",
  netlify: "oauth",
  stripe: "oauth",
  namecheap: "manual_entry", // see lib/connectors/namecheap.ts's header for why
};

function isConfigured(provider: ConnectorProvider): boolean {
  if (provider === "google") return isGoogleConnectorConfigured();
  if (provider === "instagram" || provider === "whatsapp") return isMetaConfigured();
  if (provider === "sitespark") return isSiteSparkConnectorConfigured();
  if (provider === "github") return isGitHubConnectorConfigured();
  if (provider === "vercel") return isVercelConnectorConfigured();
  if (provider === "netlify") return isNetlifyConnectorConfigured();
  if (provider === "stripe") return isStripeConnectorConfigured();
  if (provider === "namecheap") return true; // manual entry — "configured" just means the UI is ready to accept credentials
  // Notion/Slack: real UI, honest stub — see each's env var name below,
  // same "not configured" pattern as Paddle/Apple IAP.
  return false;
}

const NOT_CONFIGURED_HINT: Record<ConnectorProvider, string> = {
  google: "Set GOOGLE_CONNECTOR_CLIENT_ID / GOOGLE_CONNECTOR_CLIENT_SECRET / APP_BASE_URL.",
  notion: "Set NOTION_CLIENT_ID / NOTION_CLIENT_SECRET (create an integration at notion.so/my-integrations).",
  slack: "Set SLACK_CLIENT_ID / SLACK_CLIENT_SECRET (create an app at api.slack.com/apps).",
  instagram: "Set META_APP_ID / META_APP_SECRET / APP_BASE_URL (create a Meta Developer app with Instagram messaging access).",
  whatsapp: "Set META_APP_ID / META_APP_SECRET / APP_BASE_URL (create a Meta Developer app with WhatsApp Cloud API access).",
  sitespark: "Set SITESPARK_CLIENT_ID / SITESPARK_CLIENT_SECRET / SITESPARK_OAUTH_BASE_URL / APP_BASE_URL — needs OAuth endpoints built in your SiteSpark app first.",
  github: "Set GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET / APP_BASE_URL (create an OAuth App at github.com/settings/developers).",
  vercel: "Set VERCEL_CLIENT_ID / VERCEL_CLIENT_SECRET / VERCEL_INTEGRATION_SLUG / APP_BASE_URL (create an Integration in Vercel's dashboard).",
  netlify: "Set NETLIFY_CLIENT_ID / NETLIFY_CLIENT_SECRET / APP_BASE_URL (create an OAuth App at app.netlify.com/user/applications).",
  stripe: "Set STRIPE_CLIENT_ID / STRIPE_SECRET_KEY / APP_BASE_URL (enable Connect OAuth in your Stripe dashboard).",
  namecheap: "Nothing to configure server-side — enter your Namecheap API key, username, and whitelisted IP in the app.",
};

connectorsRouter.get("/", async (req: AuthedRequest, res) => {
  const rows = await db.select().from(connectors).where(eq(connectors.userId, req.userId!));
  const byProvider = new Map(rows.map((r) => [r.provider, r]));

  const list = connectorProviderEnum.enumValues.map((provider) => {
    const stored = byProvider.get(provider);
    const configured = isConfigured(provider);
    return {
      provider,
      ...PROVIDER_META[provider],
      connectMethod: CONNECT_METHOD[provider],
      status: stored?.status === "connected" ? "connected" : configured ? "disconnected" : "not_configured",
      externalAccountLabel: stored?.externalAccountLabel ?? null,
      connectedAt: stored?.connectedAt ?? null,
      notConfiguredHint: configured ? null : NOT_CONFIGURED_HINT[provider],
    };
  });

  res.json({ connectors: list });
});

connectorsRouter.post("/:provider/connect", async (req: AuthedRequest, res) => {
  const provider = req.params.provider as ConnectorProvider;
  if (!connectorProviderEnum.enumValues.includes(provider)) return res.status(404).json({ error: "Unknown connector" });

  if (!isConfigured(provider)) {
    return res.status(503).json({
      error: "connector_not_configured",
      message: `${PROVIDER_META[provider].label} isn't set up yet — ${NOT_CONFIGURED_HINT[provider]}`,
    });
  }

  if (provider === "google") return res.json({ authUrl: buildGoogleAuthUrl(req.userId!) });
  if (provider === "instagram") return res.json({ authUrl: buildInstagramAuthUrl(req.userId!) });
  if (provider === "whatsapp") return res.json({ manualEntry: true });
  if (provider === "sitespark") return res.json({ authUrl: buildSiteSparkAuthUrl(req.userId!) });
  if (provider === "github") return res.json({ authUrl: buildGitHubAuthUrl(req.userId!) });
  if (provider === "vercel") return res.json({ authUrl: buildVercelAuthUrl(req.userId!) });
  if (provider === "netlify") return res.json({ authUrl: buildNetlifyAuthUrl(req.userId!) });
  if (provider === "stripe") return res.json({ authUrl: buildStripeAuthUrl(req.userId!) });
  if (provider === "namecheap") return res.json({ manualEntry: true });

  // Notion/Slack report as not_configured above before reaching here.
  res.status(501).json({ error: "not_implemented" });
});

const whatsappManualSchema = z.object({
  accessToken: z.string().min(1),
  phoneNumberId: z.string().min(1),
  businessName: z.string().min(1).max(120),
});
connectorsRouter.post("/whatsapp/manual", async (req: AuthedRequest, res) => {
  if (!isMetaConfigured()) {
    return res.status(503).json({ error: "connector_not_configured", message: NOT_CONFIGURED_HINT.whatsapp });
  }
  const parsed = whatsappManualSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const result = await connectWhatsAppManually(req.userId!, parsed.data.accessToken, parsed.data.phoneNumberId, parsed.data.businessName);
  if (!result.ok) return res.status(400).json({ error: "verification_failed", message: result.message });
  res.status(201).json({ connected: true });
});

const namecheapManualSchema = z.object({
  apiUser: z.string().min(1),
  apiKey: z.string().min(1),
  clientIp: z.string().min(1),
});
connectorsRouter.post("/namecheap/manual", async (req: AuthedRequest, res) => {
  const parsed = namecheapManualSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const result = await connectNamecheapManually(req.userId!, parsed.data.apiUser, parsed.data.apiKey, parsed.data.clientIp);
  if (!result.ok) return res.status(400).json({ error: "verification_failed", message: result.message });
  res.status(201).json({ connected: true });
});

connectorsRouter.delete("/:provider", async (req: AuthedRequest, res) => {
  const provider = req.params.provider as ConnectorProvider;
  if (!connectorProviderEnum.enumValues.includes(provider)) return res.status(404).json({ error: "Unknown connector" });

  await db
    .update(connectors)
    .set({ status: "disconnected", accessToken: null, refreshToken: null, tokenExpiresAt: null, connectedAt: null, providerMetadata: {} })
    .where(and(eq(connectors.userId, req.userId!), eq(connectors.provider, provider)));
  res.status(204).end();
});
