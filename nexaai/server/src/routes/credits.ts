import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { creditDisputes, users } from "@shared/schema";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { getCreditBalanceCents, grantCredits } from "../lib/credits";
import { reviewDispute } from "../lib/creditDisputes";
import { CREDIT_PACKS } from "../lib/plans";
import { stripeProvider } from "../lib/payments/stripe";
import { verifyAppleTransaction, isAppleTransactionActive, creditPackForAppleProductId, isAppleIapConfigured, appleCreditPackProductId } from "../lib/payments/appleIap";

export const creditsRouter = Router();
creditsRouter.use(requireAuth);

creditsRouter.get("/", async (req: AuthedRequest, res) => {
  const balanceCents = await getCreditBalanceCents(db, req.userId!);
  res.json({ balanceCents, packs: CREDIT_PACKS, appleIapConfigured: isAppleIapConfigured() });
});

// Lets the client show the right StoreKit product id per pack without
// hardcoding it — mirrors plans.ts's /apple/product-ids.
creditsRouter.get("/apple/product-ids", async (_req: AuthedRequest, res) => {
  const ids: Record<string, string | null> = {};
  for (const pack of CREDIT_PACKS) ids[pack.label] = appleCreditPackProductId(pack.label) ?? null;
  res.json({ productIds: ids });
});

const checkoutSchema = z.object({
  packLabel: z.enum(["$35", "$80", "$115", "$175"]).optional(),
  customAmountCents: z.number().int().min(500, "Minimum top-up is $5.00.").max(100000, "Maximum top-up is $1,000.00.").optional(),
});

// Website credit top-up flow (see /website): creates a Stripe hosted
// checkout link, either for a fixed pack or a custom amount (real $5
// minimum, enforced by checkoutSchema below). The iOS app instead uses
// StoreKit directly on-device — see lib/payments/appleIap.ts for why the
// flows differ.
creditsRouter.post("/checkout", async (req: AuthedRequest, res) => {
  const parsed = checkoutSchema.safeParse(req.body);
  // A real, human-readable message (the client's api() helper surfaces
  // body.message directly as the thrown Error's message) — the raw
  // flatten() object below is kept for programmatic callers, but by itself
  // stringifies to a useless "[object Object]" for anyone showing it.
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten(), message: parsed.error.issues[0]?.message ?? "Invalid request." });
  if (!parsed.data.packLabel && !parsed.data.customAmountCents) {
    return res.status(400).json({ error: "Provide packLabel or customAmountCents" });
  }

  const [user] = await db.select().from(users).where(eq(users.id, req.userId!));
  if (!user) return res.status(404).json({ error: "User not found" });

  const pack = parsed.data.packLabel
    ? CREDIT_PACKS.find((p) => p.label === parsed.data.packLabel)!
    : { label: "Custom", priceCents: parsed.data.customAmountCents!, bonusCents: 0 };

  try {
    const checkout = await stripeProvider.createCreditCheckout({
      userId: user.id,
      userEmail: user.email,
      priceCents: pack.priceCents,
      packLabel: pack.label,
    });
    res.json(checkout);
  } catch (err: any) {
    if (err.code === "PAYMENT_PROVIDER_NOT_CONFIGURED") {
      return res.status(503).json({ error: "payment_provider_not_configured", message: err.message });
    }
    throw err;
  }
});

// iOS credit-pack purchase flow: the device buys a consumable IAP through
// StoreKit, then hands the resulting signed transaction here to be
// cryptographically verified before crediting the account — the same real
// verify-then-fulfill pattern as plans.ts's /apple/verify, but the
// grantCredits call (not a plan-tier update) is the fulfillment here.
const appleVerifySchema = z.object({ signedTransactionInfo: z.string().min(1) });
creditsRouter.post("/apple/verify", async (req: AuthedRequest, res) => {
  const parsed = appleVerifySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  let payload;
  try {
    payload = await verifyAppleTransaction(parsed.data.signedTransactionInfo);
  } catch (err: any) {
    return res.status(400).json({ error: "verification_failed", message: err.message ?? "Could not verify this transaction with Apple." });
  }

  const packLabel = payload.productId ? creditPackForAppleProductId(payload.productId) : null;
  if (!packLabel) {
    return res.status(400).json({ error: "unknown_product", message: `Product ${payload.productId} isn't a recognized credit pack.` });
  }
  if (!isAppleTransactionActive(payload)) {
    return res.status(400).json({ error: "transaction_inactive", message: "This purchase isn't valid (refunded or revoked)." });
  }
  if (!payload.transactionId) {
    return res.status(400).json({ error: "verification_failed", message: "Apple's transaction payload had no transaction id." });
  }

  const pack = CREDIT_PACKS.find((p) => p.label === packLabel)!;
  await grantCredits(db, req.userId!, pack.priceCents + pack.bonusCents, {
    kind: "purchase",
    packLabel: pack.label,
    paymentProvider: "apple",
    // Apple's own transactionId, not originalTransactionId — each consumable
    // repurchase gets a fresh transactionId, which is exactly the dedup key
    // grantCredits needs so the same purchase is never granted twice while
    // still letting a genuine repurchase of the same pack through.
    providerReference: payload.transactionId,
    note: pack.bonusCents > 0 ? `Includes $${(pack.bonusCents / 100).toFixed(2)} bonus` : undefined,
  });

  const balanceCents = await getCreditBalanceCents(db, req.userId!);
  res.json({ balanceCents });
});

// Called by the Stripe/Paddle webhook once a transaction completes (see
// routes/webhooks/stripe.ts, routes/webhooks/paddle.ts) — kept separate so
// it's easy to unit test. priceCents must be the actual amount charged
// (e.g. Stripe's checkout.session.amount_total), not re-derived from
// CREDIT_PACKS by packLabel — a custom top-up amount (routes/credits.ts)
// has no CREDIT_PACKS entry, so re-deriving would silently credit $0.
export async function fulfillCreditPurchase(
  userId: string,
  priceCents: number,
  bonusCents: number,
  packLabel: string,
  providerReference: string,
  paymentProvider: "stripe" | "paddle" = "stripe",
) {
  await grantCredits(db, userId, priceCents + bonusCents, {
    kind: "purchase",
    packLabel,
    paymentProvider,
    providerReference,
    note: bonusCents > 0 ? `Includes $${(bonusCents / 100).toFixed(2)} bonus` : undefined,
  });
}

// Real "report an issue with this reply" — no money refunds (see terms.html),
// but a genuine, AI-reviewed CREDIT refund when the charge itself was a real
// technical/billing error. See lib/creditDisputes.ts for exactly what this
// does and doesn't look at (never the actual message/reply content).
const disputeSchema = z.object({
  assistantMessageId: z.string().uuid(),
  description: z.string().min(1).max(1000),
});
creditsRouter.post("/disputes", async (req: AuthedRequest, res) => {
  const parsed = disputeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const outcome = await reviewDispute(db, req.userId!, parsed.data.assistantMessageId, parsed.data.description);
  if (!outcome.ok) return res.status(404).json({ error: outcome.error });

  const balanceCents = await getCreditBalanceCents(db, req.userId!);
  res.json({ status: outcome.status, reasoning: outcome.reasoning, refundedCents: outcome.refundedCents, balanceCents });
});

// The user's own dispute history — real transparency into past reports and
// their real outcomes, not just a fire-and-forget action.
creditsRouter.get("/disputes", async (req: AuthedRequest, res) => {
  const rows = await db.select().from(creditDisputes).where(eq(creditDisputes.userId, req.userId!)).orderBy(desc(creditDisputes.createdAt)).limit(50);
  res.json({ disputes: rows });
});
