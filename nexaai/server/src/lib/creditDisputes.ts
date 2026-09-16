// Real, AI-reviewed CREDIT refunds (never cash — see the Refunds section of
// terms.html for why: NexaAi doesn't do monetary refunds at all). A user
// reports a specific reply they believe was a real billing error; this
// module decides whether to automatically credit them back.
//
// Deliberately privacy-preserving: nothing here ever reads the actual
// message/reply content. It only ever sees real STRUCTURAL facts about the
// one disputed charge — was a reply generated, how long was it, what was
// charged versus the app's own real cost ceiling — plus the user's own
// free-text description of the problem. Two of the three checks below are
// fully deterministic (no AI call, no ambiguity); only the genuinely fuzzy
// middle case goes to a real, narrowly-bounded Claude call.
import Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, isNull, lt } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { chatSessions, creditDisputes, creditTransactions, messages } from "@shared/schema";
import { grantCredits } from "./credits";
import { GRACE_OVERAGE_CENTS } from "./plans";

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

const REVIEW_MODEL = "claude-haiku-4-5-20251001";

// The real, already-documented worst-case per-message cost this app's own
// formula should ever produce (see costModel.ts's header — the $1 grace
// overage is the deliberately-chosen bound on how wrong a single estimate
// can go). A charge above this is a real formula/bug-driven overcharge,
// not a matter of opinion — approved automatically, no AI judgment needed.
export const REALISTIC_MAX_CHARGE_CENTS = GRACE_OVERAGE_CENTS;

export type DisputeOutcome =
  | { ok: true; status: "approved" | "declined"; reasoning: string; refundedCents: number }
  | { ok: false; error: string };

const REVIEW_SYSTEM_PROMPT = `You are NexaAi's automated billing auditor, reviewing ONE specific credit charge a user has disputed.

You are shown ONLY structural facts about this exact charge — never the actual message or reply content. That's deliberate: you're a billing check, not a conversation-quality judge, and you have no way to fairly judge quality without reading it, which you're not shown.

Approve ONLY when the user's own description, together with the facts given, points to a plausible genuine technical or billing error (e.g. a charge that doesn't match what this kind of message should cost, a clearly broken/empty reply despite a charge, something the facts actually support).

Decline when the complaint is really about the QUALITY, correctness, tone, or helpfulness of the reply — that's not a billing error. Decline too whenever you're genuinely unsure; say so and suggest contacting support for a human review. Never approve just because the user is unhappy or insistent.

Reply in exactly this format, two lines, nothing else:
APPROVE or DECLINE
<one plain-language sentence a real user would understand, explaining why>`;

/**
 * Reviews a user's "report an issue" on one specific assistant reply.
 * `assistantMessageId` must be a real message this exact user owns.
 */
export async function reviewDispute(
  db: NodePgDatabase<Record<string, unknown>>,
  userId: string,
  assistantMessageId: string,
  description: string,
): Promise<DisputeOutcome> {
  const [assistantRow] = await db
    .select({ id: messages.id, role: messages.role, content: messages.content, sessionId: messages.sessionId, createdAt: messages.createdAt, sessionUserId: chatSessions.userId })
    .from(messages)
    .innerJoin(chatSessions, eq(messages.sessionId, chatSessions.id))
    .where(eq(messages.id, assistantMessageId));
  if (!assistantRow || assistantRow.sessionUserId !== userId) return { ok: false, error: "Message not found." };
  if (assistantRow.role !== "assistant") return { ok: false, error: "You can only report an issue with one of NexaAi's own replies." };

  // The real user message that triggered this reply — the charge in
  // question is linked to it, never to the reply itself.
  const [userMsgRow] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.sessionId, assistantRow.sessionId), eq(messages.role, "user"), lt(messages.createdAt, assistantRow.createdAt), isNull(messages.hiddenAt)))
    .orderBy(desc(messages.createdAt))
    .limit(1);
  if (!userMsgRow) return { ok: false, error: "Couldn't find the message this reply was charged for." };

  const [transaction] = await db
    .select()
    .from(creditTransactions)
    .where(and(eq(creditTransactions.messageId, userMsgRow.id), eq(creditTransactions.kind, "usage")))
    .orderBy(desc(creditTransactions.createdAt))
    .limit(1);
  if (!transaction) {
    return await recordDispute(db, userId, null, description, "declined", "We couldn't find a billing record for this message — it may be from before this feature existed. Contact support if you believe you were charged in error.", 0);
  }

  const chargedCents = Math.abs(transaction.amountCents);

  // Deterministic case A: no real reply exists for the charge in question.
  // Not actually reachable from the client's normal "report an issue on
  // this reply" flow (assistantMessageId already implies a reply exists) —
  // kept as a real, defensive check against direct API misuse or a future
  // caller that disputes by user-message id instead. The far more common
  // version of this (a charge with genuinely no reply at all) is already
  // auto-refunded the moment it happens — see routes/chat.ts's onFailure.
  if (!assistantRow.content.trim()) {
    await grantCredits(db, userId, chargedCents, { kind: "refund", providerReference: `dispute-noreply:${transaction.id}`, note: `Dispute approved — no reply content for message ${userMsgRow.id}` });
    return await recordDispute(db, userId, transaction.id, description, "approved", "No reply was actually generated for this charge, so it's been refunded automatically.", chargedCents);
  }

  // Deterministic case B: a real overcharge past the app's own documented
  // ceiling — a formula/bug problem, not a matter of opinion.
  if (chargedCents > REALISTIC_MAX_CHARGE_CENTS) {
    await grantCredits(db, userId, chargedCents, { kind: "refund", providerReference: `dispute-overcharge:${transaction.id}`, note: `Dispute approved — charge (${chargedCents}c) exceeded the real cost ceiling` });
    return await recordDispute(db, userId, transaction.id, description, "approved", `This charge ($${(chargedCents / 100).toFixed(2)}) was higher than any real message should ever cost, so it's been refunded automatically.`, chargedCents);
  }

  // Otherwise: a real, bounded Claude review — structural facts only.
  const [kind, focusModeOrEdit] = (transaction.note ?? "").split(":").slice(1);
  const anthropic = getClient();
  if (!anthropic) {
    return await recordDispute(db, userId, transaction.id, description, "declined", "Billing review isn't available right now — please contact support directly.", 0);
  }

  let verdictLine = "";
  let reasoningLine = "This charge matches what this kind of message normally costs, so it hasn't been refunded.";
  try {
    const response = await anthropic.messages.create({
      model: REVIEW_MODEL,
      max_tokens: 150,
      system: REVIEW_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content:
            `User's reported issue: "${description.slice(0, 500)}"\n\n` +
            `Real facts about this exact charge:\n` +
            `- Message type: ${kind || "unknown"}${focusModeOrEdit ? ` (mode: ${focusModeOrEdit})` : ""}\n` +
            `- Reply length: ${assistantRow.content.length} characters\n` +
            `- Amount charged: $${(chargedCents / 100).toFixed(2)}\n` +
            `- Charged at: ${transaction.createdAt.toISOString()}`,
        },
      ],
    });
    const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    verdictLine = (lines[0] ?? "").toUpperCase();
    if (lines[1]) reasoningLine = lines[1];
  } catch {
    return await recordDispute(db, userId, transaction.id, description, "declined", "We couldn't complete the billing review right now — please try again or contact support.", 0);
  }

  if (verdictLine.startsWith("APPROVE")) {
    await grantCredits(db, userId, chargedCents, { kind: "refund", providerReference: `dispute:${transaction.id}`, note: `Dispute approved: ${reasoningLine.slice(0, 200)}` });
    return await recordDispute(db, userId, transaction.id, description, "approved", reasoningLine, chargedCents);
  }
  return await recordDispute(db, userId, transaction.id, description, "declined", reasoningLine, 0);
}

async function recordDispute(
  db: NodePgDatabase<Record<string, unknown>>,
  userId: string,
  creditTransactionId: string | null,
  description: string,
  status: "approved" | "declined",
  reasoning: string,
  refundedCents: number,
): Promise<DisputeOutcome> {
  await db.insert(creditDisputes).values({ userId, creditTransactionId, description, status, reasoning, refundedCents });
  return { ok: true, status, reasoning, refundedCents };
}
