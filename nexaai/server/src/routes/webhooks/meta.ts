import { Router } from "express";
import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { agents, agentPendingDrafts, connectors } from "@shared/schema";
import { isMetaConfigured } from "../../lib/connectors/meta";
import { dryRunAgent, sendPlatformMessage, type AgentConfig } from "../../lib/agents/agentRunner";

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
  platform: "instagram" | "whatsapp";
  /** Which of our connected accounts received it — IG business account ID, or our WhatsApp phone_number_id. */
  recipientExternalId: string;
  /** Who sent it — IGSID for Instagram, phone number for WhatsApp. */
  senderExternalId: string;
  text: string;
}

function extractIncomingMessages(body: any): IncomingMessage[] {
  const out: IncomingMessage[] = [];

  if (body.object === "instagram") {
    for (const entry of body.entry ?? []) {
      for (const event of entry.messaging ?? []) {
        if (event.message?.text && event.sender?.id && event.recipient?.id) {
          out.push({ platform: "instagram", recipientExternalId: event.recipient.id, senderExternalId: event.sender.id, text: event.message.text });
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

  for (const msg of incoming) {
    try {
      await handleIncomingMessage(msg);
    } catch (err) {
      console.error("meta webhook processing failed:", err);
    }
  }
});

async function handleIncomingMessage(msg: IncomingMessage) {
  const connectorRows = await db
    .select()
    .from(connectors)
    .where(and(eq(connectors.provider, msg.platform), eq(connectors.status, "connected")));

  const owner = connectorRows.find((c) => {
    const meta = c.providerMetadata as { igUserId?: string; phoneNumberId?: string };
    return msg.platform === "instagram" ? meta.igUserId === msg.recipientExternalId : meta.phoneNumberId === msg.recipientExternalId;
  });
  if (!owner) return; // no NexaAi user has connected the account this message was sent to

  const agentKind = msg.platform === "instagram" ? "instagram_dm" : "whatsapp_autoresponder";
  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.userId, owner.userId), eq(agents.kind, agentKind), eq(agents.isActive, true)));
  if (!agent) return; // owner hasn't activated an agent for this platform

  const config = agent.config as AgentConfig;
  const draftReply = await dryRunAgent(agent.kind, config, msg.text);

  if (config.autoSend) {
    await sendPlatformMessage(owner.userId, agent.kind, msg.senderExternalId, draftReply);
    await db.insert(agentPendingDrafts).values({
      agentId: agent.id,
      userId: owner.userId,
      platform: msg.platform,
      externalConversationId: msg.senderExternalId,
      incomingMessage: msg.text,
      draftReply,
      status: "auto_sent",
      resolvedAt: new Date(),
    });
  } else {
    await db.insert(agentPendingDrafts).values({
      agentId: agent.id,
      userId: owner.userId,
      platform: msg.platform,
      externalConversationId: msg.senderExternalId,
      incomingMessage: msg.text,
      draftReply,
      status: "pending",
    });
  }
}
