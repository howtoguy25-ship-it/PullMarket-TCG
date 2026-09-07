import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { connectorProviderEnum, connectors, type ConnectorProvider } from "@shared/schema";
import { db } from "../db";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { buildGoogleAuthUrl, isGoogleConnectorConfigured } from "../lib/connectors/google";

export const connectorsRouter = Router();
connectorsRouter.use(requireAuth);

const PROVIDER_META: Record<ConnectorProvider, { label: string; description: string; icon: string }> = {
  google: { label: "Google", description: "Calendar events feed into NexaAi's answers and reminders.", icon: "google" },
  notion: { label: "Notion", description: "Let NexaAi read your workspace pages for context.", icon: "notion" },
  slack: { label: "Slack", description: "Let an agent post drafts into a Slack channel.", icon: "slack" },
  instagram: { label: "Instagram", description: "Powers the Instagram DM auto-reply agent.", icon: "instagram" },
  whatsapp: { label: "WhatsApp", description: "Powers the WhatsApp autoresponder agent.", icon: "whatsapp" },
};

function isConfigured(provider: ConnectorProvider): boolean {
  if (provider === "google") return isGoogleConnectorConfigured();
  // Notion/Slack/Instagram/WhatsApp: real UI, honest stub — see each's env
  // var name below, same "not configured" pattern as Paddle/Apple IAP.
  return false;
}

const NOT_CONFIGURED_HINT: Record<ConnectorProvider, string> = {
  google: "Set GOOGLE_CONNECTOR_CLIENT_ID / GOOGLE_CONNECTOR_CLIENT_SECRET / APP_BASE_URL.",
  notion: "Set NOTION_CLIENT_ID / NOTION_CLIENT_SECRET (create an integration at notion.so/my-integrations).",
  slack: "Set SLACK_CLIENT_ID / SLACK_CLIENT_SECRET (create an app at api.slack.com/apps).",
  instagram: "Set META_APP_ID / META_APP_SECRET with Instagram Graph API access (developers.facebook.com).",
  whatsapp: "Set META_APP_ID / META_APP_SECRET with WhatsApp Cloud API access (developers.facebook.com).",
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

  if (provider === "google") {
    return res.json({ authUrl: buildGoogleAuthUrl(req.userId!) });
  }
  // Only Google is wired end-to-end today; other providers report as
  // not_configured above before reaching here.
  res.status(501).json({ error: "not_implemented" });
});

connectorsRouter.delete("/:provider", async (req: AuthedRequest, res) => {
  const provider = req.params.provider as ConnectorProvider;
  if (!connectorProviderEnum.enumValues.includes(provider)) return res.status(404).json({ error: "Unknown connector" });

  await db
    .update(connectors)
    .set({ status: "disconnected", accessToken: null, refreshToken: null, tokenExpiresAt: null, connectedAt: null })
    .where(and(eq(connectors.userId, req.userId!), eq(connectors.provider, provider)));
  res.status(204).end();
});
