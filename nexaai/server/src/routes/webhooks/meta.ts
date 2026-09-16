import { Router } from "express";
import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { agents, connectors, users } from "@shared/schema";
import { isMetaConfigured } from "../../lib/connectors/meta";
import { runAgentTurn, type AgentConfig } from "../../lib/agents/agentRunner";
import { resolveCapabilities } from "../../lib/capabilities";
import { startOrExtendHumanTakeover } from "../../lib/agents/humanTakeover";

export const metaWebhookRouter = Router();

// --- Verification handshake (GET) ---------------------------------------
// Meta calls this once when you register the webhook URL in your app's
// dashboard, to prove you control this endpoint.
metaWebhookRouter.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.META_WEBHOOK_VERIFY_TOKEN && process.env.META_WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

function verifySignature(req: import("express").Request): boolean {
  const signature = req.header("x-hub-signature-256");
  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
  if (!signature || !rawBody || !process.env.META_APP_SECRET) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", process.env.META_APP_SECRET).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

interface IncomingMessage {
  platform: "instagram" | "whatsapp" | "facebook_messenger";
  /** Which of our connected accounts received it — IG business account ID, Page ID, or our WhatsApp phone_number_id. */
  recipientExternalId: string;
  /** Who sent it — IGSID for Instagram, PSID for Messenger, phone number for WhatsApp. */
  senderExternalId: string;
  text: string;
}

function extractIncomingMessages(body: any): IncomingMessage[] {
  const out: IncomingMessage[] = [];

  if (body.object === "instagram" || body.object === "page") {
    // Instagram DMs and Facebook Page Messenger deliver the identical
    // entry[].messaging[] envelope shape — only the top-level object type
    // (and which id-space sender/recipient live in) differs.
    const platform = body.object === "instagram" ? "instagram" : "facebook_messenger";
    for (const entry of body.entry ?? []) {
      for (const event of entry.messaging ?? []) {
        if (event.message?.is_echo) continue; // handled separately by extractEchoEvents
        if (event.message?.text && event.sender?.id && event.recipient?.id) {
          out.push({ platform, recipientExternalId: event.recipient.id, senderExternalId: event.sender.id, text: event.message.text });
        }
      }
    }
  } else if (body.object === "whatsapp_business_account") {
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const phoneNumberId = change.value?.metadata?.phone_number_id;
        for (const message of change.value?.messages ?? []) {
          if (message.text?.body && message.from && phoneNumberId) {
            out.push({ platform: "whatsapp", recipientExternalId: phoneNumberId, senderExternalId: message.from, text: message.text.body });
          }
        }
      }
    }
  }
  return out;
}

interface EchoEvent {
  platform: "instagram" | "facebook_messenger";
  /** The Page/IG account this was sent from — same id-space as IncomingMessage.recipientExternalId. */
  ownerExternalId: string;
  /** Which external customer's thread this was sent into. */
  conversationExternalId: string;
  /** Meta's own app id this send came through — present on every echo. */
  appId: string | null;
}

// Real "the account owner replied through their own Page/IG inbox" signal —
// requires subscribing this webhook to the `message_echoes` field in the
// Meta App dashboard (Webhooks -> Messenger/Instagram -> message_echoes),
// an external setup step this code can't do for you. When subscribed, Meta
// sends one of these for EVERY message sent from the Page's identity,
// including NexaAi's own auto-sends — app_id is how we tell them apart:
// ours carries our own META_APP_ID, a human typing in the native inbox
// doesn't (Meta's own client has a different app id, or none at all).
function extractEchoEvents(body: any): EchoEvent[] {
  const out: EchoEvent[] = [];
  if (body.object !== "instagram" && body.object !== "page") return out;
  const platform = body.object === "instagram" ? "instagram" : "facebook_messenger";
  for (const entry of body.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      if (!event.message?.is_echo || !event.sender?.id || !event.recipient?.id) continue;
      out.push({
        platform,
        ownerExternalId: event.sender.id, // the Page/IG account itself, on an echo
        conversationExternalId: event.recipient.id, // the external customer this went to
        appId: event.message.app_id ? String(event.message.app_id) : null,
      });
    }
  }
  return out;
}

// --- Real inbound events (POST) ------------------------------------------
// NOTE: this responds only after generating the draft (and, for autoSend
// agents, actually sending it) — a couple of awaited network calls, fine
// for this scaffold's scale but worth moving to an async queue (ack Meta
// immediately, process in the background) before high real traffic, since
// Meta expects a fast response and may retry/disable the webhook if it
// times out repeatedly.
metaWebhookRouter.post("/", async (req, res) => {
  if (!isMetaConfigured()) return res.sendStatus(404);
  if (!verifySignature(req)) return res.sendStatus(401);

  res.sendStatus(200); // ack Meta first; everything below is best-effort processing
  const incoming = extractIncomingMessages(req.body);
  const echoes = extractEchoEvents(req.body);

  for (const msg of incoming) {
    try {
      await handleIncomingMessage(msg);
    } catch (err) {
      console.error("meta webhook processing failed:", err);
    }
  }
  for (const echo of echoes) {
    try {
      await handleEchoEvent(echo);
    } catch (err) {
      console.error("meta echo processing failed:", err);
    }
  }
});

async function findAgentForOwnerPlatform(
  platform: "instagram" | "whatsapp" | "facebook_messenger",
  ownerExternalId: string,
): Promise<{ owner: typeof connectors.$inferSelect; agent: typeof agents.$inferSelect } | null> {
  const connectorRows = await db.select().from(connectors).where(and(eq(connectors.provider, platform), eq(connectors.status, "connected")));
  const owner = connectorRows.find((c) => {
    const meta = c.providerMetadata as { igUserId?: string; pageId?: string; phoneNumberId?: string };
    if (platform === "instagram") return meta.igUserId === ownerExternalId;
    if (platform === "facebook_messenger") return meta.pageId === ownerExternalId;
    return meta.phoneNumberId === ownerExternalId;
  });
  if (!owner) return null; // no NexaAi user has connected the account this event was for

  const agentKind = platform === "instagram" ? "instagram_dm" : platform === "facebook_messenger" ? "facebook_messenger_dm" : "whatsapp_autoresponder";
  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.userId, owner.userId), eq(agents.kind, agentKind), eq(agents.isActive, true)));
  if (!agent) return null; // owner hasn't activated an agent for this platform
  return { owner, agent };
}

async function handleIncomingMessage(msg: IncomingMessage) {
  const found = await findAgentForOwnerPlatform(msg.platform, msg.recipientExternalId);
  if (!found) return;
  const { owner, agent } = found;

  // The real "is this feature on" check — an agent can stay `isActive: true`
  // in the DB after its owner turns Agent Builder off in Capabilities, so
  // this has to be checked here (where a reply would actually be sent), not
  // just where the agent was created/activated.
  const [ownerUser] = await db.select().from(users).where(eq(users.id, owner.userId));
  if (!ownerUser || !resolveCapabilities(ownerUser.capabilities).agentBuilder) return;

  await runAgentTurn({
    agentId: agent.id,
    agentKind: agent.kind,
    config: agent.config as AgentConfig,
    userId: owner.userId,
    platform: msg.platform,
    externalConversationId: msg.senderExternalId,
    incomingMessage: msg.text,
  });
}

async function handleEchoEvent(echo: EchoEvent) {
  if (echo.appId && echo.appId === process.env.META_APP_ID) return; // our own auto-send, not a human reply
  const found = await findAgentForOwnerPlatform(echo.platform, echo.ownerExternalId);
  if (!found) return;
  // A real human — the account owner or a teammate — just replied to this
  // exact customer through the Page/IG app's own native inbox. Silence
  // NexaAi's own replies on this one conversation for a real 5 minutes,
  // refreshed on every further echo, so it doesn't talk over them.
  await startOrExtendHumanTakeover(found.agent.id, echo.conversationExternalId);
}
