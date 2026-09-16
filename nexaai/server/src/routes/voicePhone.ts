// Real phone-call voice chat: an inbound call to a user's own Twilio number
// reaches this router as a webhook, and every leg of the conversation —
// speech-to-text, reasoning, text-to-speech — runs through the exact same
// real pipeline as the in-app VoiceChatScreen (routes/voice.ts), just driven
// by Twilio's own webhooks/TwiML instead of app-side file uploads.
//
// Twilio does its own speech-to-text for phone calls (the <Gather
// input="speech"> verb below) — no need to run our own Whisper transcription
// for this path. Every response here charges real credits the same way an
// app voice turn does; a caller who's out of credit is told so and the call
// ends, not silently pretended to answer.

import { Router } from "express";
import express from "express";
import { eq, and, asc } from "drizzle-orm";
import { db } from "../db";
import { voiceConversations, voiceTurns, users } from "@shared/schema";
import { findUserIdByTwilioNumber, verifyTwilioSignature } from "../lib/connectors/twilio";
import { spendCredits } from "../lib/credits";
import { synthesizeSpeech, isTextToSpeechConfigured } from "../lib/voice/textToSpeech";
import { askGemini, isGeminiConfigured } from "../lib/geminiModel";
import { askModel } from "../lib/modelRouter";
import { PLAN_DEFINITIONS } from "../lib/plans";
import { voiceTurnCreditCostCents } from "./voice";
import { appBaseUrl } from "../lib/appBaseUrl";

export const voicePhoneRouter = Router();
voicePhoneRouter.use(express.urlencoded({ extended: false }));

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function sayTwiml(text: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${escapeXml(text)}</Say><Hangup/></Response>`;
}

function absoluteAudioUrl(relativeUrl: string): string {
  return `${appBaseUrl() ?? ""}${relativeUrl}`;
}

/** Real check of Twilio's X-Twilio-Signature header — refuses any request that didn't genuinely come from Twilio. */
function requireValidTwilioSignature(req: express.Request, authToken: string): boolean {
  const fullUrl = `${appBaseUrl() ?? ""}${req.originalUrl}`;
  return verifyTwilioSignature(authToken, fullUrl, req.body as Record<string, string>, req.header("X-Twilio-Signature"));
}

// Twilio hits this the moment someone calls the connected number.
voicePhoneRouter.post("/incoming", async (req, res) => {
  res.type("text/xml");
  try {
    const toNumber = req.body.To as string | undefined;
    const callSid = req.body.CallSid as string | undefined;
    if (!toNumber || !callSid) return res.send(sayTwiml("Sorry, something went wrong receiving this call."));

    const owner = await findUserIdByTwilioNumber(toNumber);
    if (!owner) return res.send(sayTwiml("This number isn't connected to a NexaAi account anymore. Goodbye."));
    if (!requireValidTwilioSignature(req, owner.authToken)) return res.status(403).send(sayTwiml("Couldn't verify this call."));

    const [user] = await db.select().from(users).where(eq(users.id, owner.userId));
    if (!user) return res.send(sayTwiml("This number isn't connected to a NexaAi account anymore. Goodbye."));

    const spend = await spendCredits(db, user.id, voiceTurnCreditCostCents(user), "voice:phone_greeting");
    if (!spend.allowed) return res.send(sayTwiml(`Hi, this is ${user.displayName}'s NexaAi assistant. This account is out of credit right now, so I can't take calls. Goodbye.`));

    const [conversation] = await db
      .insert(voiceConversations)
      .values({ userId: user.id, title: `Call from ${req.body.From ?? "unknown"}`, channel: "phone", externalCallSid: callSid })
      .returning();

    const greetingInstruction =
      `[You just picked up a real phone call from a caller reaching ${user.displayName}'s NexaAi number. Greet them warmly, ` +
      "mention briefly that they're speaking with NexaAi, and ask what they'd like help with. Keep it to 1-2 short, natural " +
      "sentences, and genuinely vary your exact wording each time rather than reusing a stock line.]";

    const replyText = isGeminiConfigured()
      ? (await askGemini({ userMessage: greetingInstruction, history: [], mode: "voice" })).text
      : (
          await askModel({
            plan: PLAN_DEFINITIONS[user.planTier],
            answerCount: 1,
            userMessage: greetingInstruction,
            history: [],
            mode: "voice",
            focusMode: "quick",
          })
        ).text;

    let replyAudioUrl: string | null = null;
    if (isTextToSpeechConfigured()) {
      const synthesized = await synthesizeSpeech(replyText, user.voiceCharacterId);
      replyAudioUrl = synthesized.url;
    }

    await db.insert(voiceTurns).values({ conversationId: conversation.id, userId: user.id, incomingAudioUrl: null, transcript: null, replyText, replyAudioUrl });

    const gatherAction = `/api/voice-phone/gather?conversationId=${conversation.id}`;
    const voiceLine = replyAudioUrl ? `<Play>${escapeXml(absoluteAudioUrl(replyAudioUrl))}</Play>` : `<Say>${escapeXml(replyText)}</Say>`;
    res.send(
      `<?xml version="1.0" encoding="UTF-8"?><Response>${voiceLine}<Gather input="speech" action="${gatherAction}" method="POST" speechTimeout="auto" actionOnEmptyResult="true"/></Response>`,
    );
  } catch (e) {
    console.error("voice-phone incoming failed", e);
    res.send(sayTwiml("Sorry, something went wrong. Goodbye."));
  }
});

// Twilio hits this once it's transcribed what the caller said (its own
// speech-to-text — see this file's header for why we don't run Whisper here).
voicePhoneRouter.post("/gather", async (req, res) => {
  res.type("text/xml");
  const conversationId = req.query.conversationId as string | undefined;
  try {
    if (!conversationId) return res.send(sayTwiml("Sorry, I lost track of this call. Goodbye."));

    const [conversation] = await db.select().from(voiceConversations).where(eq(voiceConversations.id, conversationId));
    if (!conversation) return res.send(sayTwiml("Sorry, I lost track of this call. Goodbye."));

    const [user] = await db.select().from(users).where(eq(users.id, conversation.userId));
    if (!user) return res.send(sayTwiml("Sorry, something went wrong. Goodbye."));

    const owner = await findUserIdByTwilioNumber(req.body.To as string);
    if (!owner || !requireValidTwilioSignature(req, owner.authToken)) return res.status(403).send(sayTwiml("Couldn't verify this call."));

    const transcript = (req.body.SpeechResult as string | undefined)?.trim();
    const gatherAction = `/api/voice-phone/gather?conversationId=${conversation.id}`;

    if (!transcript) {
      // Silence, or Twilio didn't catch it — re-prompt instead of ending the call.
      res.send(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, I didn't catch that.</Say><Gather input="speech" action="${gatherAction}" method="POST" speechTimeout="auto" actionOnEmptyResult="true"/></Response>`,
      );
      return;
    }

    // A caller who signs off ends the call cleanly instead of getting
    // charged for one more turn asking "anything else?". A substring check,
    // not an exact match — real speech-to-text output rarely comes back as
    // just the bare word ("bye"), it's "okay, thanks, bye" or similar.
    if (/\b(bye|goodbye|good bye|hang up)\b/i.test(transcript)) {
      await db.update(voiceConversations).set({ endedAt: new Date() }).where(eq(voiceConversations.id, conversation.id));
      return res.send(sayTwiml("Thanks for calling. Goodbye!"));
    }

    const spend = await spendCredits(db, user.id, voiceTurnCreditCostCents(user), "voice:phone_turn");
    if (!spend.allowed) {
      await db.update(voiceConversations).set({ endedAt: new Date() }).where(eq(voiceConversations.id, conversation.id));
      return res.send(sayTwiml("This account just ran out of credit, so I have to end the call here. Goodbye."));
    }

    const priorTurns = await db.select().from(voiceTurns).where(eq(voiceTurns.conversationId, conversation.id)).orderBy(asc(voiceTurns.createdAt)).limit(10);
    const history = priorTurns.flatMap((t) =>
      t.transcript !== null
        ? [{ role: "user" as const, content: t.transcript }, { role: "assistant" as const, content: t.replyText }]
        : [{ role: "assistant" as const, content: t.replyText }],
    );

    const replyText = isGeminiConfigured()
      ? (await askGemini({ userMessage: transcript, history, mode: "voice" })).text
      : (
          await askModel({
            plan: PLAN_DEFINITIONS[user.planTier],
            answerCount: 1,
            userMessage: transcript,
            history,
            mode: "voice",
            focusMode: "quick",
          })
        ).text;

    let replyAudioUrl: string | null = null;
    if (isTextToSpeechConfigured()) {
      const synthesized = await synthesizeSpeech(replyText, user.voiceCharacterId);
      replyAudioUrl = synthesized.url;
    }

    await db.insert(voiceTurns).values({ conversationId: conversation.id, userId: user.id, incomingAudioUrl: null, transcript, replyText, replyAudioUrl });

    const voiceLine = replyAudioUrl ? `<Play>${escapeXml(absoluteAudioUrl(replyAudioUrl))}</Play>` : `<Say>${escapeXml(replyText)}</Say>`;
    res.send(
      `<?xml version="1.0" encoding="UTF-8"?><Response>${voiceLine}<Gather input="speech" action="${gatherAction}" method="POST" speechTimeout="auto" actionOnEmptyResult="true"/></Response>`,
    );
  } catch (e) {
    console.error("voice-phone gather failed", e);
    res.send(sayTwiml("Sorry, something went wrong on my end. Goodbye."));
  }
});

// Twilio's call-status callback (configured alongside the Voice webhook) —
// marks the conversation ended the moment the call actually hangs up,
// even if the caller hung up mid-<Gather> without saying goodbye.
voicePhoneRouter.post("/status", async (req, res) => {
  try {
    const callSid = req.body.CallSid as string | undefined;
    const callStatus = req.body.CallStatus as string | undefined;
    if (callSid && (callStatus === "completed" || callStatus === "failed" || callStatus === "busy" || callStatus === "no-answer")) {
      await db.update(voiceConversations).set({ endedAt: new Date() }).where(and(eq(voiceConversations.externalCallSid, callSid), eq(voiceConversations.channel, "phone")));
    }
  } catch (e) {
    console.error("voice-phone status callback failed", e);
  }
  res.sendStatus(204);
});
