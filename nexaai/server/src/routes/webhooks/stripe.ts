import { Router } from "express";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { users } from "@shared/schema";
import { CREDIT_PACKS, type PlanTier } from "../../lib/plans";
import { fulfillCreditPurchase } from "../credits";

export const stripeWebhookRouter = Router();

// Verifies Stripe's real webhook signature (HMAC-SHA256 of "timestamp.body"
// using your Stripe endpoint's signing secret) before trusting the
// payload. Set STRIPE_WEBHOOK_SECRET from Stripe Dashboard -> Developers ->
// Webhooks -> (your endpoint) -> Signing secret.
function verifySignature(rawBody: string, signatureHeader: string | undefined): boolean {
  if (!process.env.STRIPE_WEBHOOK_SECRET || !signatureHeader) return false;
  const parts = Object.fromEntries(signatureHeader.split(",").map((kv) => kv.split("=") as [string, string]));
  if (!parts.t || !parts.v1) return false;
  const expected = crypto
    .createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET)
    .update(`${parts.t}.${rawBody}`)
    .digest("hex");
  try {
    // timingSafeEqual throws (rather than returning false) when the two
    // buffers differ in length — a malformed/truncated v1 would otherwise
    // crash this into a 500 instead of the clean 401 a bad signature
    // should get. Same real bug this repo already found and fixed once in
    // webhooks/paddle.ts's own verifySignature.
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
  } catch {
    return false;
  }
}

interface StripeEvent {
  type: string;
  data: {
    object: {
      id: string;
      mode?: "payment" | "subscription" | "setup";
      amount_total?: number;
      customer?: string;
      subscription?: string;
      metadata?: { nexaaiUserId?: string; packLabel?: string; planTier?: PlanTier; source?: string };
      status?: string;
      current_period_end?: number;
    };
  };
}

stripeWebhookRouter.post("/", async (req, res) => {
  // Same real bug class already found and fixed in webhooks/paddle.ts:
  // JSON.stringify(req.body) would re-serialize the already-parsed
  // payload, which is not guaranteed to byte-match what Stripe actually
  // signed. req.rawBody is the exact bytes (see index.ts's express.json
  // verify hook).
  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
  if (!rawBody || !verifySignature(rawBody.toString("utf8"), req.header("Stripe-Signature"))) {
    return res.status(401).json({ error: "Invalid or missing Stripe-Signature" });
  }

  const event = req.body as StripeEvent;
  const obj = event.data.object;

  if (event.type === "checkout.session.completed" && obj.mode === "payment" && obj.metadata?.nexaaiUserId && obj.metadata.packLabel) {
    // Credit-pack (or custom-amount) purchases are one-time Checkout
    // Sessions, not subscriptions. Use the real amount actually charged
    // (amount_total), never re-derived from CREDIT_PACKS by packLabel —
    // a custom top-up amount has no CREDIT_PACKS entry and would silently
    // fulfill for $0 if re-derived that way.
    const userId = obj.metadata.nexaaiUserId;
    const packLabel = obj.metadata.packLabel;
    const pack = CREDIT_PACKS.find((p) => p.label === packLabel);
    await fulfillCreditPurchase(userId, obj.amount_total ?? 0, pack?.bonusCents ?? 0, packLabel, obj.id, "stripe");

    if (obj.customer) {
      await db.update(users).set({ stripeCustomerId: obj.customer }).where(eq(users.id, userId));
    }
  }

  if (event.type === "checkout.session.completed" && obj.mode === "subscription" && obj.metadata?.nexaaiUserId && obj.metadata.planTier) {
    await db
      .update(users)
      .set({
        planTier: obj.metadata.planTier,
        planSource: "stripe",
        planStripeSubscriptionId: obj.subscription ?? null,
        planPaddleSubscriptionId: null,
        stripeCustomerId: obj.customer ?? undefined,
      })
      .where(eq(users.id, obj.metadata.nexaaiUserId));
  }

  // Real payment_intent.succeeded — used ONLY for the off-session
  // auto-recharge charge (lib/autoRecharge.ts fires a PaymentIntent
  // directly, with no Checkout Session involved), gated on metadata.source
  // so a normal Checkout-driven purchase's own payment_intent.succeeded
  // (which carries no such metadata) is never double-fulfilled here.
  if (event.type === "payment_intent.succeeded" && obj.metadata?.source === "auto_recharge" && obj.metadata.nexaaiUserId && obj.metadata.packLabel) {
    const userId = obj.metadata.nexaaiUserId;
    const packLabel = obj.metadata.packLabel;
    const pack = CREDIT_PACKS.find((p) => p.label === packLabel);
    await fulfillCreditPurchase(userId, obj.amount_total ?? 0, pack?.bonusCents ?? 0, packLabel, obj.id, "stripe");
    await db.update(users).set({ autoRechargeInFlightAt: null }).where(eq(users.id, userId));
  }

  // Subscription lifecycle — createSubscriptionCheckout (lib/payments/
  // stripe.ts) stamps subscription_data.metadata with nexaaiUserId +
  // planTier so these events (fired long after the Checkout Session
  // itself is gone) can still be tied back to the right user.
  const metadata = obj.metadata;
  if (metadata?.nexaaiUserId && metadata.planTier && (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated")) {
    if (obj.status === "active" || obj.status === "trialing") {
      await db
        .update(users)
        .set({
          planTier: metadata.planTier,
          planSource: "stripe",
          planStripeSubscriptionId: obj.id,
          planPaddleSubscriptionId: null,
          planAppleOriginalTransactionId: null,
          planCurrentPeriodEnd: obj.current_period_end ? new Date(obj.current_period_end * 1000) : null,
        })
        .where(eq(users.id, metadata.nexaaiUserId));
    } else if (obj.status === "canceled" || obj.status === "unpaid" || obj.status === "incomplete_expired") {
      await db
        .update(users)
        .set({ planTier: "beginner", planSource: null, planStripeSubscriptionId: null, planCurrentPeriodEnd: null })
        .where(eq(users.id, metadata.nexaaiUserId));
    }
  }
  if (metadata?.nexaaiUserId && event.type === "customer.subscription.deleted") {
    await db
      .update(users)
      .set({ planTier: "beginner", planSource: null, planStripeSubscriptionId: null, planCurrentPeriodEnd: null })
      .where(eq(users.id, metadata.nexaaiUserId));
  }

  res.json({ received: true });
});
