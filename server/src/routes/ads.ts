import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { authenticateToken } from "../middleware/auth";
import { getStripe, getOrCreateRemoveAdsPriceId, isStripeConfigured } from "../lib/stripeClient";
import { REMOVE_ADS_PRICE_CENTS } from "@shared/validation";
import { verifyAppleTransaction, isAppleTransactionActive, isAppleRemoveAdsConfigured, getAppleRemoveAdsProductId } from "../lib/appleSubscription";

const router = Router();
router.use(authenticateToken);

router.get("/status", async (req, res) => {
  res.json({ adsRemoved: req.user!.adsRemoved, priceCents: REMOVE_ADS_PRICE_CENTS });
});

// ── Stripe-hosted one-time checkout (web) ─────────────────────────────────
router.post("/remove/checkout", async (req, res) => {
  if (!isStripeConfigured()) {
    return res.status(503).json({ message: "Payments aren't configured yet. Set STRIPE_SECRET_KEY (see .env.example)." });
  }
  if (req.user!.adsRemoved) {
    return res.status(400).json({ message: "Ads are already removed on this account." });
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

  const priceId = await getOrCreateRemoveAdsPriceId();
  const baseUrl = process.env.APP_BASE_URL || "http://localhost:5050";
  const target = parsed.data.returnUrl ?? `${baseUrl}/remove-ads-return`;
  const separator = target.includes("?") ? "&" : "?";

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    payment_intent_data: { metadata: { userId: req.user!.id, kind: "remove_ads" } },
    metadata: { userId: req.user!.id, kind: "remove_ads" },
    success_url: `${target}${separator}status=success`,
    cancel_url: `${target}${separator}status=cancelled`,
  });

  res.json({ url: session.url });
});

// ── Apple IAP: verify a StoreKit non-consumable purchase (iOS) ───────────
router.post("/remove/apple/verify", async (req, res) => {
  if (!isAppleRemoveAdsConfigured()) {
    return res.status(503).json({ message: "Apple IAP for Remove Ads isn't configured yet." });
  }
  const schema = z.object({ jws: z.string() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid request" });

  let transaction;
  try {
    transaction = await verifyAppleTransaction(parsed.data.jws);
  } catch (err) {
    console.error("Apple Remove Ads transaction verification failed:", err);
    return res.status(400).json({ message: "Couldn't verify this purchase with Apple." });
  }

  if (transaction.productId !== getAppleRemoveAdsProductId()) {
    return res.status(400).json({ message: "This purchase doesn't match the Remove Ads product." });
  }
  if (!transaction.originalTransactionId) {
    return res.status(400).json({ message: "Invalid transaction — missing transaction id." });
  }

  const active = isAppleTransactionActive(transaction);
  await db
    .update(users)
    .set({
      adsRemoved: active,
      adsRemovedSource: "apple",
      adsRemovedAppleOriginalTransactionId: transaction.originalTransactionId,
    })
    .where(eq(users.id, req.user!.id));

  res.json({ adsRemoved: active });
});

export default router;
