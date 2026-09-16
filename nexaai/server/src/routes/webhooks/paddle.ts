import { Router } from "express";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { users } from "@shared/schema";
import { CREDIT_PACKS, type PlanTier } from "../../lib/plans";
import { fulfillCreditPurchase } from "../credits";

export const paddleWebhookRouter = Router();

// Verifies Paddle's webhook signature (HMAC-SHA256 of "ts:body" using your
// Paddle notification secret) before trusting the payload — same shape as
// verifying a real Stripe webhook signature. Set PADDLE_WEBHOOK_SECRET from
// Paddle Dashboard -> Developer Tools -> Notifications.
function verifySignature(rawBody: string, signatureHeader: string | undefined): boolean {
  if (!process.env.PADDLE_WEBHOOK_SECRET || !signatureHeader) return false;
  const parts = Object.fromEntries(signatureHeader.split(";").map((kv) => kv.split("=") as [string, string]));
  if (!parts.ts || !parts.h1) return false;
  const expected = crypto
    .createHmac("sha256", process.env.PADDLE_WEBHOOK_SECRET)
    .update(`${parts.ts}:${rawBody}`)
    .digest("hex");
  try {
    // timingSafeEqual throws (rather than returning false) when the two
    // buffers differ in length — a malformed/truncated h1 would otherwise
    // crash this into a 500 instead of the clean 401 a bad signature
    // should get. Same guard webhooks/meta.ts's own verifySignature uses.
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.h1));
  } catch {
    return false;
  }
}

paddleWebhookRouter.post("/", async (req, res) => {
  // Real bug this replaces: `JSON.stringify(req.body)` re-serializes the
  // already-parsed object, which is NOT guaranteed to byte-match what
  // Paddle actually sent (key order, number formatting, spacing can all
  // differ) — so the HMAC below would almost never match Paddle's real
  // signature, meaning every genuine webhook got rejected as invalid.
  // `req.rawBody` is the exact bytes Paddle signed (see index.ts's
  // express.json `verify` hook — the same mechanism webhooks/meta.ts uses
  // for its own signature check).
  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
  if (!rawBody || !verifySignature(rawBody.toString("utf8"), req.header("Paddle-Signature"))) {
    return res.status(401).json({ error: "Invalid or missing Paddle-Signature" });
  }

  const event = req.body as {
    event_type: string;
    data: {
      id: string;
      status?: string;
      customer_id?: string;
      custom_data?: { nexaaiUserId?: string; packLabel?: string; planTier?: PlanTier; source?: string };
      current_billing_period?: { ends_at?: string };
    };
  };

  if (event.event_type === "transaction.completed" && event.data.custom_data?.nexaaiUserId && event.data.custom_data.packLabel) {
    // Credit-pack purchases are one-time transactions, not subscriptions —
    // only handle this when custom_data actually carries a packLabel
    // (createCreditCheckout sets it; createSubscriptionCheckout doesn't).
    const userId = event.data.custom_data.nexaaiUserId;
    const packLabel = event.data.custom_data.packLabel;
    const pack = CREDIT_PACKS.find((p) => p.label === packLabel);
    await fulfillCreditPurchase(userId, pack?.priceCents ?? 0, pack?.bonusCents ?? 0, packLabel, event.data.id, "paddle");

    // The auto-recharge attempt that requested this transaction (lib/
    // autoRecharge.ts) is done — release its claim so the next low-balance
    // spend can trigger a fresh one instead of waiting out the cooldown.
    if (event.data.custom_data.source === "auto_recharge") {
      await db.update(users).set({ autoRechargeInFlightAt: null }).where(eq(users.id, userId));
    }
  }

  // Real off-session auto-recharge (lib/autoRecharge.ts) needs a saved
  // payment method to charge later — Paddle only exposes that as
  // customer_id, captured off whichever real transaction completes first.
  if (event.event_type === "transaction.completed" && event.data.custom_data?.nexaaiUserId && event.data.customer_id) {
    await db.update(users).set({ paddleCustomerId: event.data.customer_id }).where(eq(users.id, event.data.custom_data.nexaaiUserId));
  }

  // Subscription lifecycle — createSubscriptionCheckout (lib/payments/
  // paddle.ts) stamps custom_data with nexaaiUserId + planTier so these
  // events can be tied back to the right user without a lookup table.
  const { nexaaiUserId, planTier } = event.data.custom_data ?? {};
  if (nexaaiUserId && planTier && (event.event_type === "subscription.created" || event.event_type === "subscription.activated" || event.event_type === "subscription.updated")) {
    if (event.data.status === "active" || event.data.status === "trialing") {
      await db
        .update(users)
        .set({
          planTier,
          planSource: "paddle",
          planPaddleSubscriptionId: event.data.id,
          planAppleOriginalTransactionId: null,
          planCurrentPeriodEnd: event.data.current_billing_period?.ends_at ? new Date(event.data.current_billing_period.ends_at) : null,
        })
        .where(eq(users.id, nexaaiUserId));
    } else if (event.data.status === "canceled" || event.data.status === "paused") {
      await db
        .update(users)
        .set({ planTier: "beginner", planSource: null, planPaddleSubscriptionId: null, planCurrentPeriodEnd: null })
        .where(eq(users.id, nexaaiUserId));
    }
  }
  if (nexaaiUserId && event.event_type === "subscription.canceled") {
    await db
      .update(users)
      .set({ planTier: "beginner", planSource: null, planPaddleSubscriptionId: null, planCurrentPeriodEnd: null })
      .where(eq(users.id, nexaaiUserId));
  }

  res.json({ received: true });
});
