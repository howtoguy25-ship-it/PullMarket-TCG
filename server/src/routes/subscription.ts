import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { authenticateToken } from "../middleware/auth";
import { getStripe, getOrCreateProPriceId, isStripeConfigured } from "../lib/stripeClient";
import { isActivePro, PRO_SUBSCRIPTION_PRICE_CENTS } from "@shared/validation";
import { verifyAppleTransaction, isAppleTransactionActive, isAppleIapConfigured, getAppleIapProductId } from "../lib/appleSubscription";

const router = Router();
router.use(authenticateToken);

router.get("/status", async (req, res) => {
  const u = req.user!;
  res.json({
    active: isActivePro(u),
    proStatus: u.proStatus,
    proSource: u.proSource,
    proCurrentPeriodEnd: u.proCurrentPeriodEnd,
    proCancelAtPeriodEnd: u.proCancelAtPeriodEnd,
    priceCents: PRO_SUBSCRIPTION_PRICE_CENTS,
  });
});

// ── Stripe-hosted subscription checkout (web only — see SubscriptionScreen,
// the native app deliberately has no purchase flow here per Apple's IAP
// requirement for digital in-app perks) ────────────────────────────────
router.post("/checkout", async (req, res) => {
  if (!isStripeConfigured()) {
    return res.status(503).json({ message: "Payments aren't configured yet. Set STRIPE_SECRET_KEY (see .env.example)." });
  }
  if (isActivePro(req.user!)) {
    return res.status(400).json({ message: "You already have an active Pro membership." });
  }

  const schema = z.object({ returnUrl: z.string().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid request" });

  const stripe = getStripe();
  let customerId = req.user!.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({ email: req.user!.email ?? undefined, metadata: { userId: req.user!.id } });
    customerId = customer.id;
    await db.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, req.user!.id));
  }

  const priceId = await getOrCreateProPriceId();
  const baseUrl = process.env.APP_BASE_URL || "http://localhost:5050";
  const target = parsed.data.returnUrl ?? `${baseUrl}/subscription-return`;
  const separator = target.includes("?") ? "&" : "?";

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: { metadata: { userId: req.user!.id } },
    metadata: { userId: req.user!.id },
    success_url: `${target}${separator}status=success`,
    cancel_url: `${target}${separator}status=cancelled`,
  });

  res.json({ url: session.url });
});

// ── Stripe billing portal — manage payment method / cancel (web) ─────────
router.post("/portal", async (req, res) => {
  if (!isStripeConfigured()) {
    return res.status(503).json({ message: "Payments aren't configured yet." });
  }
  if (req.user!.proSource === "apple") {
    return res.status(400).json({ message: "This membership was purchased through the App Store — manage or cancel it from your iPhone's Settings > [your name] > Subscriptions." });
  }
  if (!req.user!.stripeCustomerId) {
    return res.status(400).json({ message: "No billing account found." });
  }

  const stripe = getStripe();
  const baseUrl = process.env.APP_BASE_URL || "http://localhost:5050";
  const portalSession = await stripe.billingPortal.sessions.create({
    customer: req.user!.stripeCustomerId,
    return_url: `${baseUrl}/`,
  });
  res.json({ url: portalSession.url });
});

// ── Apple IAP: verify a StoreKit purchase and activate Pro (iOS only —
// see SubscriptionScreen, which never runs a Stripe purchase flow on
// native per Apple's IAP requirement for digital in-app perks) ──────────
router.post("/apple/verify", async (req, res) => {
  if (!isAppleIapConfigured()) {
    return res.status(503).json({ message: "Apple IAP isn't configured yet." });
  }
  const schema = z.object({ jws: z.string() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid request" });

  let transaction;
  try {
    transaction = await verifyAppleTransaction(parsed.data.jws);
  } catch (err) {
    console.error("Apple transaction verification failed:", err);
    return res.status(400).json({ message: "Couldn't verify this purchase with Apple." });
  }

  if (transaction.productId !== getAppleIapProductId()) {
    return res.status(400).json({ message: "This purchase doesn't match the Pro subscription product." });
  }
  if (!transaction.originalTransactionId) {
    return res.status(400).json({ message: "Invalid transaction — missing transaction id." });
  }

  const active = isAppleTransactionActive(transaction);
  await db
    .update(users)
    .set({
      proStatus: active ? "active" : "canceled",
      proSource: "apple",
      proAppleOriginalTransactionId: transaction.originalTransactionId,
      proCurrentPeriodEnd: transaction.expiresDate ? new Date(transaction.expiresDate) : null,
    })
    .where(eq(users.id, req.user!.id));

  res.json({ active });
});

export default router;
