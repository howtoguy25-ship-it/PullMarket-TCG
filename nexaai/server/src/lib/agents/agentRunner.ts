// Custom agent builder — lets a user describe an automation ("reply to
// Instagram DMs asking about pricing with our price list", "auto-respond on
// WhatsApp after hours") and NexaAi drafts + (once wired to real platform
// credentials) runs it.
//
// What's real here: `dryRunAgent` genuinely calls Claude to generate the
// reply an agent *would* send for a given incoming message, using the
// agent's own config (persona/instructions) as the system prompt. That's
// useful today for testing an agent's behavior risk-free.
//
// What needs your own accounts before it can actually message anyone:
//   - Instagram DM automation: a Meta Developer app with the
//     `instagram_manage_messages` permission (requires Meta App Review),
//     a connected Instagram professional account, and a webhook subscription
//     for `messages` — see developers.facebook.com/docs/messenger-platform/instagram.
//   - WhatsApp autoresponder: WhatsApp Business Platform (Cloud API) access,
//     a verified business, and a permanent access token — see
//     developers.facebook.com/docs/whatsapp/cloud-api.
// Once you have those, `sendPlatformMessage` below is where the real
// `fetch()` call to Meta's Graph API goes; it's left as a clearly-marked
// stub because it can't be tested without your own approved app.

import type { AgentKind } from "@shared/schema";
import { askNexaAi } from "../anthropic";
import { PLAN_DEFINITIONS } from "../plans";

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

/** Stub — see file header. Throws until you plug in real Meta Graph API credentials. */
export async function sendPlatformMessage(_kind: AgentKind, _recipientId: string, _text: string): Promise<never> {
  throw Object.assign(new Error("sendPlatformMessage is not implemented — connect your Meta Graph API credentials first."), {
    code: "AGENT_PLATFORM_NOT_CONFIGURED",
  });
}
