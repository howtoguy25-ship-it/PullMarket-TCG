import { Router } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { users } from "@shared/schema";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { getCreditBalanceCents, grantCredits } from "../lib/credits";
import { CREDIT_PACKS } from "../lib/plans";
import { paddleProvider } from "../lib/payments/paddle";

export const creditsRouter = Router();
creditsRouter.use(requireAuth);

creditsRouter.get("/", async (req: AuthedRequest, res) => {
  const balanceCents = await getCreditBalanceCents(db, req.userId!);
  res.json({ balanceCents, packs: CREDIT_PACKS });
});

const checkoutSchema = z.object({
  packLabel: z.enum(["$35", "$80", "$115", "$175"]).optional(),
  customAmountCents: z.number().int().min(500).max(100000).optional(),
});

// Website credit top-up flow (see /website): creates a Paddle hosted
// checkout link. The iOS app instead uses StoreKit directly on-device — see
// lib/payments/appleIap.ts for why the flows differ.
creditsRouter.post("/checkout", async (req: AuthedRequest, res) => {
  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (!parsed.data.packLabel && !parsed.data.customAmountCents) {
    return res.status(400).json({ error: "Provide packLabel or customAmountCents" });
  }

  const [user] = await db.select().from(users).where(eq(users.id, req.userId!));
  if (!user) return res.status(404).json({ error: "User not found" });

  const pack = parsed.data.packLabel
    ? CREDIT_PACKS.find((p) => p.label === parsed.data.packLabel)!
    : { label: "Custom", priceCents: parsed.data.customAmountCents!, bonusCents: 0 };

  try {
    const checkout = await paddleProvider.createCreditCheckout({
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

// Called by the Paddle webhook once a transaction completes (see
// routes/webhooks/paddle.ts) — kept separate so it's easy to unit test.
export async function fulfillCreditPurchase(userId: string, priceCents: number, bonusCents: number, packLabel: string, providerReference: string) {
  await grantCredits(db, userId, priceCents + bonusCents, {
    kind: "purchase",
    packLabel,
    paymentProvider: "paddle",
    providerReference,
    note: bonusCents > 0 ? `Includes $${(bonusCents / 100).toFixed(2)} bonus` : undefined,
  });
}
