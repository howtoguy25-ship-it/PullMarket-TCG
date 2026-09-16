import { Router } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { users } from "@shared/schema";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { PLAN_DEFINITIONS, FOCUS_MODE_DEFINITIONS, ANSWER_MODE_DEFINITIONS, CREDIT_PACKS, USAGE_WINDOW_HOURS } from "../lib/plans";
import { getUsageStatus } from "../middleware/usage";
import { syncExpiredPlan } from "../lib/planExpiry";
import { paddleProvider } from "../lib/payments/paddle";
import { stripeProvider } from "../lib/payments/stripe";
import { verifyAppleTransaction, isAppleTransactionActive, planTierForAppleProductId, isAppleIapConfigured, applePlanProductId } from "../lib/payments/appleIap";

export const plansRouter = Router();

plansRouter.get("/", (_req, res) => {
  // usageWindowHours is included so public pages (e.g. website/pricing.html)
  // can state the real rolling-window cap ("45 messages / 5 hrs") without
  // hardcoding USAGE_WINDOW_HOURS as a separate guess.
  res.json({ plans: Object.values(PLAN_DEFINITIONS), usageWindowHours: USAGE_WINDOW_HOURS, appleIapConfigured: isAppleIapConfigured() });
});

plansRouter.get("/focus-modes", (_req, res) => {
  res.json({ focusModes: Object.values(FOCUS_MODE_DEFINITIONS) });
});

plansRouter.get("/answer-modes", (_req, res) => {
  res.json({ answerModes: Object.values(ANSWER_MODE_DEFINITIONS) });
});

// Public (no auth) — the real credit-pack prices, same source of truth
// credits.ts's authed listing uses. Exists so a public page (e.g.
// website/pricing.html) can show real numbers without a login wall.
plansRouter.get("/credit-packs", (_req, res) => {
  res.json({ packs: CREDIT_PACKS });
});

// Real current-window usage for the Plans screen's own usage display —
// the same numbers routes/chat.ts's checkUsageWindow enforces, not a
// separately-computed estimate.
plansRouter.get("/usage", requireAuth, async (req: AuthedRequest, res) => {
  await syncExpiredPlan(req.userId!);
  const [user] = await db.select().from(users).where(eq(users.id, req.userId!));
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json(await getUsageStatus(req.userId!, user.planTier));
});

// Downgrading to the free tier never needs a payment check, so it's the
// only thing left on the old free-flip /switch endpoint. Upgrading to
// Pro/Max now always goes through a real payment: POST /checkout (Paddle,
// web/Android) or POST /apple/verify (StoreKit, iOS) below.
const switchSchema = z.object({ tier: z.literal("beginner") });
plansRouter.post("/switch", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = switchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "upgrade_requires_payment",
      message: "Upgrading to Pro or Max requires a real subscription purchase — use POST /api/plans/checkout (web) or the in-app Apple purchase (iOS), not this endpoint.",
    });
  }

  const [existing] = await db.select().from(users).where(eq(users.id, req.userId!));
  if (!existing) return res.status(404).json({ error: "User not found" });

  // A downgrade should also actually stop the recurring charge, not just
  // flip the local flag — cancel whichever provider is on file.
  if (existing.planStripeSubscriptionId && stripeProvider.isConfigured()) {
    try {
      await stripeProvider.cancelSubscription(existing.planStripeSubscriptionId);
    } catch (err: any) {
      return res.status(502).json({ error: "cancel_failed", message: err.message ?? "Failed to cancel the subscription with Stripe." });
    }
  } else if (existing.planPaddleSubscriptionId && paddleProvider.isConfigured()) {
    try {
      await paddleProvider.cancelSubscription(existing.planPaddleSubscriptionId);
    } catch (err: any) {
      return res.status(502).json({ error: "cancel_failed", message: err.message ?? "Failed to cancel the subscription with Paddle." });
    }
  } else if (existing.planAppleOriginalTransactionId) {
    // Apple subscriptions can only be cancelled by the subscriber themselves
    // in their own Apple ID settings — there's no server-side cancel API for
    // an app to call on a user's behalf. Downgrading here stops NexaAi from
    // treating them as Pro/Max, but the actual renewal (and the charge) has
    // to be turned off on the App Store side.
    return res.status(409).json({
      error: "apple_subscription_active",
      message: "Your subscription was purchased through the App Store. Cancel it in iPhone Settings > [your name] > Subscriptions to stop future charges — NexaAi can't cancel an Apple subscription for you.",
    });
  }

  const [user] = await db
    .update(users)
    .set({ planTier: "beginner", planSource: null, planPaddleSubscriptionId: null, planStripeSubscriptionId: null, planCurrentPeriodEnd: null })
    .where(eq(users.id, req.userId!))
    .returning();
  res.json({ planTier: user.planTier });
});

// Website/Android Pro-Max upgrade flow: creates a real Stripe hosted
// checkout link for a recurring subscription — see lib/payments/stripe.ts.
const checkoutSchema = z.object({ tier: z.enum(["pro", "max"]) });
plansRouter.post("/checkout", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const [user] = await db.select().from(users).where(eq(users.id, req.userId!));
  if (!user) return res.status(404).json({ error: "User not found" });

  try {
    const checkout = await stripeProvider.createSubscriptionCheckout({
      userId: user.id,
      userEmail: user.email,
      tier: parsed.data.tier,
    });
    res.json(checkout);
  } catch (err: any) {
    if (err.code === "PAYMENT_PROVIDER_NOT_CONFIGURED") {
      return res.status(503).json({ error: "payment_provider_not_configured", message: err.message });
    }
    throw err;
  }
});

// iOS Pro/Max purchase flow: the device buys the subscription directly
// through StoreKit (see client/src/lib/applePurchase.ts), then hands the
// resulting signed transaction here to be cryptographically verified
// against Apple's own root cert (see lib/payments/appleIap.ts) before
// NexaAi trusts it and upgrades the account. This is the real Guideline
// 3.1.1-compliant path — no web checkout is shown inside the iOS app.
const appleVerifySchema = z.object({ signedTransactionInfo: z.string().min(1) });
plansRouter.post("/apple/verify", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = appleVerifySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  let payload;
  try {
    payload = await verifyAppleTransaction(parsed.data.signedTransactionInfo);
  } catch (err: any) {
    return res.status(400).json({ error: "verification_failed", message: err.message ?? "Could not verify this transaction with Apple." });
  }

  const tier = payload.productId ? planTierForAppleProductId(payload.productId) : null;
  if (!tier) {
    return res.status(400).json({ error: "unknown_product", message: `Product ${payload.productId} isn't a recognized plan.` });
  }
  if (!isAppleTransactionActive(payload)) {
    return res.status(400).json({ error: "transaction_inactive", message: "This subscription isn't currently active." });
  }

  const [user] = await db
    .update(users)
    .set({
      planTier: tier,
      planSource: "apple",
      planAppleOriginalTransactionId: String(payload.originalTransactionId),
      planPaddleSubscriptionId: null,
      planStripeSubscriptionId: null,
      planCurrentPeriodEnd: payload.expiresDate ? new Date(payload.expiresDate) : null,
    })
    .where(eq(users.id, req.userId!))
    .returning();
  res.json({ planTier: user.planTier });
});

// Lets the client show the right StoreKit product id to purchase for a tier
// without hardcoding it — mirrors credits.ts's equivalent for packs.
plansRouter.get("/apple/product-ids", requireAuth, async (_req: AuthedRequest, res) => {
  res.json({ pro: applePlanProductId("pro") ?? null, max: applePlanProductId("max") ?? null });
});
