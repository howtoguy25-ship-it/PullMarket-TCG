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
import { connectors, agentPendingDrafts } from "@shared/schema";
import { db } from "../../db";
import { askNexaAi } from "../anthropic";
import { PLAN_DEFINITIONS } from "../plans";
import { sendInstagramMessage, sendWhatsAppMessage, sendFacebookMessage } from "./metaGraph";
import { sendSlackMessage } from "./slackApi";
import { sendXDirectMessage } from "./xApi";
import { isAgentPaused, isHumanTakeoverActive } from "./humanTakeover";
import { getOwnerSettings } from "../ownerSettings";

export interface SampleReply {
  text: string;
  category: "welcome" | "faq";
}

export interface AgentConfig {
  instructions: string; // what the agent should do, in the user's own words
  // How it should actually sound while doing that — a distinct field from
  // instructions on purpose: "answer pricing questions with our price
  // list" is WHAT to do, "warm and casual, short sentences, the occasional
  // emoji" is HOW to say it. Optional — falls back to a plain, neutral
  // human-agent voice when left blank.
  tone?: string;
  autoSend: boolean; // if false, drafts are queued for the user to approve
  // Up to 5 example replies the business approved while building this
  // agent — real few-shot examples fed into every draft below, not just
  // decoration. Each is tagged "welcome" (a greeting/opener) or "faq" (an
  // answer to an expected question) by classifyReplyExample.
  sampleReplies?: SampleReply[];
  // Only set for kind === "generic_webhook" — the token a caller must
  // present (in the URL) to POST to this agent's real inbound webhook.
  // See routes/webhooks/agent.ts.
  webhookToken?: string;
}

const PLATFORM_LABEL: Record<AgentKind, string> = {
  instagram_dm: "an Instagram DM",
  whatsapp_autoresponder: "a WhatsApp message",
  facebook_messenger_dm: "a Facebook Messenger message",
  slack_dm: "a Slack direct message",
  x_dm: "an X (Twitter) direct message",
  generic_webhook: "an incoming webhook event",
  custom: "a message",
};

function formatSampleReplies(sampleReplies: SampleReply[] | undefined): string {
  if (!sampleReplies?.length) return "";
  const lines = sampleReplies.map((s) => `- [${s.category}] "${s.text}"`).join("\n");
  return `\n\nExample replies this business already approved for this agent — match their tone and, where relevant, reuse their content:\n${lines}`;
}

export async function dryRunAgent(kind: AgentKind, config: AgentConfig, incomingMessage: string): Promise<string> {
  const result = await askNexaAi({
    plan: PLAN_DEFINITIONS.pro,
    answerCount: 1,
    focusMode: "quick",
    userMessage:
      `You are drafting an automated reply to ${PLATFORM_LABEL[kind]} on behalf of a business. This reply is sent ` +
      `as-is to a real customer's DM/chat — plain conversational text only, no markdown (no **bold**, no italic ` +
      `recap of their question, no numbered lists/headings): those render as literal symbols in a chat app, not ` +
      `formatting. Just write the message a human agent would actually send. ` +
      `The business's instructions for this agent (what to do/say): "${config.instructions}".` +
      `${config.tone ? ` How it should actually talk (tone/voice): "${config.tone}".` : ""}` +
      `${formatSampleReplies(config.sampleReplies)}\n\n` +
      `Incoming message: "${incomingMessage}"\n\nDraft the reply only — no extra commentary.`,
    history: [],
    mode: "chat",
  });
  return result.text;
}

// A real reply sent the instant a message arrives reads as an obvious bot —
// no human on Instagram/WhatsApp/Slack/X answers in under a second. This
// mirrors how an actual person paces a chat reply: a beat to notice/open
// the message, then time roughly proportional to how long the reply itself
// is (typing speed), with real randomness so it's never a suspiciously
// exact number. Capped so a customer is never left hanging too long.
const MIN_NOTICE_MS = 3_000;
const MAX_NOTICE_MS = 9_000;
const MS_PER_CHAR_MIN = 35;
const MS_PER_CHAR_MAX = 70;
const MAX_DELAY_MS = 45_000;

export function computeHumanReplyDelayMs(replyText: string): number {
  const notice = MIN_NOTICE_MS + Math.random() * (MAX_NOTICE_MS - MIN_NOTICE_MS);
  const perChar = MS_PER_CHAR_MIN + Math.random() * (MS_PER_CHAR_MAX - MS_PER_CHAR_MIN);
  const typing = Math.min(replyText.length, 400) * perChar; // cap the char count so a very long reply doesn't blow past MAX_DELAY_MS on its own
  return Math.min(Math.round(notice + typing), MAX_DELAY_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Real classification (not a keyword guess) — one short Claude call per sample reply the user adds. */
export async function classifyReplyExample(text: string): Promise<"welcome" | "faq"> {
  const result = await askNexaAi({
    plan: PLAN_DEFINITIONS.pro,
    answerCount: 1,
    focusMode: "quick",
    userMessage:
      `A business owner building a chat automation gave this as an example of a reply it should send: "${text}"\n\n` +
      `Classify it as exactly one word, lowercase, nothing else: "welcome" if it's an opening greeting/introduction sent ` +
      `to start a conversation, or "faq" if it's answering a specific expected question.`,
    history: [],
    mode: "chat",
  });
  return result.text.toLowerCase().includes("welcome") ? "welcome" : "faq";
}

// --- The Agent Builder's own AI assistant ---------------------------------
// A real conversation for a user who doesn't know what to write: NexaAi
// asks what the automation is for, and once it genuinely has enough,
// proposes real instructions + sample replies the user can accept with one
// tap. The suggestion is parsed out of a fenced ```suggestion block so the
// conversational text and the structured proposal stay cleanly separate.

const AGENT_ASSIST_INSTRUCTIONS =
  `You are NexaAi helping a business owner design a chat automation agent inside the Agent Builder. Reply in plain ` +
  `conversational prose only — no italic "what you asked" recap, no markdown headings, no numbered "Direct ` +
  `answer/Context/Reasoning/Steps" breakdown; just talk like a person helping them think it through. Have a short, ` +
  `real back-and-forth: ask what the agent is for, what platform, and what it should say — one or two questions at ` +
  `a time, never a long interrogation. Once you genuinely have enough to propose real instructions and up to 3 ` +
  `example replies, end your response with a fenced block, exactly in this shape:\n` +
  '```suggestion\n{"instructions": "...", "sampleReplies": ["...", "..."]}\n```\n' +
  `Only include that block once you're actually ready to propose it — otherwise just respond conversationally with ` +
  `your next question. Keep the conversational part brief (2-4 sentences), and never include the fenced block ` +
  `unless you mean to propose it right now.`;

export interface AssistResult {
  reply: string;
  suggestion: { instructions: string; sampleReplies: string[] } | null;
}

export async function assistWithAgentBuilder(
  message: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<AssistResult> {
  const result = await askNexaAi({
    plan: PLAN_DEFINITIONS.pro,
    answerCount: 1,
    focusMode: "quick",
    userMessage: `${AGENT_ASSIST_INSTRUCTIONS}\n\nThe business owner just said: "${message}"`,
    history,
    mode: "chat",
  });

  const match = result.text.match(/```suggestion\s*([\s\S]*?)```/);
  let suggestion: AssistResult["suggestion"] = null;
  if (match) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (typeof parsed.instructions === "string" && Array.isArray(parsed.sampleReplies)) {
        suggestion = {
          instructions: parsed.instructions,
          sampleReplies: parsed.sampleReplies.filter((s: unknown): s is string => typeof s === "string").slice(0, 5),
        };
      }
    } catch {
      // Malformed JSON from the model — fall through with no suggestion rather than break the conversation.
    }
  }
  const reply = match ? result.text.slice(0, match.index).trim() : result.text.trim();
  return { reply, suggestion };
}

const KIND_TO_PLATFORM: Partial<Record<AgentKind, ConnectorProvider>> = {
  instagram_dm: "instagram",
  whatsapp_autoresponder: "whatsapp",
  facebook_messenger_dm: "facebook_messenger",
  slack_dm: "slack",
  x_dm: "x",
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
  } else if (platform === "facebook_messenger") {
    await sendFacebookMessage(connector.accessToken, recipientId, text);
  } else if (platform === "whatsapp") {
    const phoneNumberId = (connector.providerMetadata as { phoneNumberId?: string })?.phoneNumberId;
    if (!phoneNumberId) throw new Error("WhatsApp connector is missing its phone_number_id — reconnect it in Settings -> Connectors.");
    await sendWhatsAppMessage(connector.accessToken, phoneNumberId, recipientId, text);
  } else if (platform === "slack") {
    await sendSlackMessage(connector.accessToken, recipientId, text);
  } else if (platform === "x") {
    await sendXDirectMessage(connector.accessToken, recipientId, text);
  }
}

export interface RunAgentTurnParams {
  agentId: string;
  agentKind: AgentKind;
  config: AgentConfig;
  userId: string;
  platform: ConnectorProvider;
  externalConversationId: string;
  incomingMessage: string;
}

/**
 * The one real place every platform's inbound handler (meta.ts, slack.ts,
 * xPoller.ts) funnels through, so isPaused / human-takeover / the human-like
 * send delay behave identically everywhere instead of being reimplemented
 * (and risking drift) per platform. Order matters:
 *   0. The owner panel's app-wide Agent Builder kill switch -> do nothing.
 *      Each webhook already re-checks the individual user's own
 *      capabilities.agentBuilder before calling this; this is the matching
 *      app-wide check, in the one place all of them funnel through, so an
 *      owner flipping it off actually silences every already-active agent
 *      immediately rather than only blocking new activations.
 *   1. isPaused / active takeover -> do nothing at all, not even a draft —
 *      the owner asked NexaAi to genuinely stay out of the way here.
 *   2. autoSend off -> draft only, queued for approval (unchanged behavior).
 *   3. autoSend on -> draft, wait a real human-paced delay, THEN re-check
 *      isPaused/takeover (the owner may have jumped in while we were
 *      "typing") before actually sending.
 */
export async function runAgentTurn(params: RunAgentTurnParams): Promise<void> {
  const { agentId, agentKind, config, userId, platform, externalConversationId, incomingMessage } = params;

  if (!(await getOwnerSettings()).agentBuilderEnabled) return;
  if ((await isAgentPaused(agentId)) || (await isHumanTakeoverActive(agentId, externalConversationId))) return;

  const draftReply = await dryRunAgent(agentKind, config, incomingMessage);

  if (!config.autoSend) {
    await db.insert(agentPendingDrafts).values({
      agentId,
      userId,
      platform,
      externalConversationId,
      incomingMessage,
      draftReply,
      status: "pending",
    });
    return;
  }

  await sleep(computeHumanReplyDelayMs(draftReply));

  if ((await isAgentPaused(agentId)) || (await isHumanTakeoverActive(agentId, externalConversationId))) {
    await db.insert(agentPendingDrafts).values({
      agentId,
      userId,
      platform,
      externalConversationId,
      incomingMessage,
      draftReply,
      status: "pending",
    });
    return;
  }

  await sendPlatformMessage(userId, agentKind, externalConversationId, draftReply);
  await db.insert(agentPendingDrafts).values({
    agentId,
    userId,
    platform,
    externalConversationId,
    incomingMessage,
    draftReply,
    status: "auto_sent",
    resolvedAt: new Date(),
  });
}
