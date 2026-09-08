// Custom agent builder — lets a user describe an automation ("reply to
// Instagram DMs asking about pricing with our price list", "auto-respond on
// WhatsApp after hours") and NexaAi drafts + (once connected) runs it for real.
//
// `dryRunAgent` genuinely calls Claude to generate the reply an agent
// *would* send for a given incoming message — useful for testing an
// agent's behavior risk-free before it's ever connected to a real account.
//
// `sendPlatformMessage` genuinely sends through Meta's Graph API (see
// lib/agents/metaGraph.ts) once the business has connected that platform
// (Settings -> Connectors — see lib/connectors/meta.ts). It still needs
// your own Meta Developer app credentials and, for real (non-tester)
// recipients, Meta's App Review approval of `instagram_manage_messages` /
// `whatsapp_business_messaging` — that review is an external process this
// code can't shortcut.

import { eq, and } from "drizzle-orm";
import type { AgentKind, ConnectorProvider } from "@shared/schema";
import { connectors } from "@shared/schema";
import { db } from "../../db";
import { askNexaAi } from "../anthropic";
import { PLAN_DEFINITIONS } from "../plans";
import { sendInstagramMessage, sendWhatsAppMessage } from "./metaGraph";

export interface AgentConfig {
  instructions: string; // what the agent should do, in the user's own words
  autoSend: boolean; // if false, drafts are queued for the user to approve
}

export async function dryRunAgent(kind: AgentKind, config: AgentConfig, incomingMessage: string): Promise<string> {
  const platformLabel: Record<AgentKind, string> = {
    instagram_dm: "an Instagram DM",
    whatsapp_autoresponder: "a WhatsApp message",
    generic_webhook: "an incoming webhook event",
    custom: "a message",
  };

  const result = await askNexaAi({
    plan: PLAN_DEFINITIONS.pro,
    answerCount: 1,
    focusMode: "quick",
    userMessage:
      `You are drafting an automated reply to ${platformLabel[kind]} on behalf of a business. ` +
      `The business's instructions for this agent: "${config.instructions}".\n\n` +
      `Incoming message: "${incomingMessage}"\n\nDraft the reply only — no extra commentary.`,
    history: [],
    mode: "chat",
  });
  return result.text;
}

const KIND_TO_PLATFORM: Partial<Record<AgentKind, ConnectorProvider>> = {
  instagram_dm: "instagram",
  whatsapp_autoresponder: "whatsapp",
};

/** Real send — looks up the business's connected account for this platform and calls Meta's Graph API. */
export async function sendPlatformMessage(userId: string, kind: AgentKind, recipientId: string, text: string): Promise<void> {
  const platform = KIND_TO_PLATFORM[kind];
  if (!platform) {
    throw Object.assign(new Error(`Agent kind "${kind}" has no platform to send through.`), { code: "AGENT_PLATFORM_NOT_CONFIGURED" });
  }

  const [connector] = await db
    .select()
    .from(connectors)
    .where(and(eq(connectors.userId, userId), eq(connectors.provider, platform)));
  if (!connector || connector.status !== "connected" || !connector.accessToken) {
    throw Object.assign(new Error(`${platform} isn't connected yet — connect it in Settings -> Connectors first.`), {
      code: "AGENT_PLATFORM_NOT_CONFIGURED",
    });
  }

  if (platform === "instagram") {
    await sendInstagramMessage(connector.accessToken, recipientId, text);
  } else if (platform === "whatsapp") {
    const phoneNumberId = (connector.providerMetadata as { phoneNumberId?: string })?.phoneNumberId;
    if (!phoneNumberId) throw new Error("WhatsApp connector is missing its phone_number_id — reconnect it in Settings -> Connectors.");
    await sendWhatsAppMessage(connector.accessToken, phoneNumberId, recipientId, text);
  }
}
