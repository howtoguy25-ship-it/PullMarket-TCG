// Real Slack Events API receiver — mirrors routes/webhooks/meta.ts's shape:
// verify the request is genuinely from Slack, match the inbound DM to the
// NexaAi user who connected that workspace, draft a real reply, then send
// it (autoSend) or queue it for approval, exactly like Instagram/WhatsApp/
// Messenger.

import { Router } from "express";
import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { agents, connectors, users } from "@shared/schema";
import { isSlackConfigured } from "../../lib/connectors/slack";
import { runAgentTurn, type AgentConfig } from "../../lib/agents/agentRunner";
import { resolveCapabilities } from "../../lib/capabilities";

export const slackWebhookRouter = Router();

// Slack signs every request with v0=HMAC_SHA256(signing_secret, "v0:<timestamp>:<raw body>") —
// the timestamp is included to prevent replay attacks older than 5 minutes.
function verifySlackSignature(req: import("express").Request): boolean {
  const signature = req.header("x-slack-signature");
  const timestamp = req.header("x-slack-request-timestamp");
  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
  if (!signature || !timestamp || !rawBody || !process.env.SLACK_SIGNING_SECRET) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 60 * 5) return false; // stale request

  const base = `v0:${timestamp}:${rawBody.toString("utf8")}`;
  const expected = "v0=" + crypto.createHmac("sha256", process.env.SLACK_SIGNING_SECRET).update(base).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

interface SlackEventBody {
  type: string; // "url_verification" | "event_callback"
  challenge?: string;
  team_id?: string;
  event?: {
    type: string; // "message"
    channel_type?: string; // "im" for a direct message
    channel: string;
    user?: string;
    bot_id?: string;
    text?: string;
    subtype?: string;
  };
}

slackWebhookRouter.post("/", async (req, res) => {
  if (!isSlackConfigured()) return res.sendStatus(404);

  const body = req.body as SlackEventBody;

  // The one-time handshake Slack performs when you register the Request
  // URL in Event Subscriptions — echo the challenge back, unsigned check
  // isn't needed here since there's nothing sensitive in a challenge echo,
  // but every other event below still requires a valid signature.
  if (body.type === "url_verification") return res.json({ challenge: body.challenge });

  if (!verifySlackSignature(req)) return res.sendStatus(401);
  res.sendStatus(200); // ack Slack first; everything below is best-effort processing

  const event = body.event;
  if (!event || event.type !== "message" || event.channel_type !== "im") return;
  if (event.bot_id || event.subtype || !event.text || !event.user || !body.team_id) return; // ignore bot echoes/edits/joins

  try {
    await handleIncomingDm(body.team_id, event.channel, event.user, event.text);
  } catch (err) {
    console.error("slack webhook processing failed:", err);
  }
});

async function handleIncomingDm(teamId: string, channelId: string, senderUserId: string, text: string) {
  const connectorRows = await db.select().from(connectors).where(and(eq(connectors.provider, "slack"), eq(connectors.status, "connected")));
  const owner = connectorRows.find((c) => (c.providerMetadata as { teamId?: string }).teamId === teamId);
  if (!owner) return; // no NexaAi user has connected this workspace

  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.userId, owner.userId), eq(agents.kind, "slack_dm"), eq(agents.isActive, true)));
  if (!agent) return; // owner hasn't activated a Slack agent

  // Re-check live, the same as every other platform — an agent can stay
  // isActive after Agent Builder gets turned off in Capabilities.
  const [ownerUser] = await db.select().from(users).where(eq(users.id, owner.userId));
  if (!ownerUser || !resolveCapabilities(ownerUser.capabilities).agentBuilder) return;

  await runAgentTurn({
    agentId: agent.id,
    agentKind: agent.kind,
    config: agent.config as AgentConfig,
    userId: owner.userId,
    platform: "slack",
    externalConversationId: channelId,
    incomingMessage: text,
  });
}
