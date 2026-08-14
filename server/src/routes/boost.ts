import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { listings, users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { authenticateToken } from "../middleware/auth";
import { getStripe, isStripeConfigured } from "../lib/stripeClient";
import { BOOST_TIERS, boostPriceCentsForUser, formatBoostDuration, isActivePro } from "@shared/validation";

const router = Router();
router.use(authenticateToken);

// ── Tier list, priced for the requesting user (Pro gets 15% off) ─────────
router.get("/tiers", async (req, res) => {
  const isPro = isActivePro(req.user!);
  res.json({
    isPro,
    tiers: BOOST_TIERS.map((t) => ({
      id: t.id,
      durationHours: t.durationHours,
      label: formatBoostDuration(t.durationHours),
      priceCents: t.priceCents,
      finalPriceCents: boostPriceCentsForUser(t, isPro),
    })),
  });
});

// ── Start a real Stripe Checkout for boosting one of the seller's own
// listings — the boost only actually applies once the webhook confirms
// payment (see routes/webhook.ts markListingBoosted). ────────────────────
router.post("/listings/:id/checkout", async (req, res) => {
  if (!isStripeConfigured()) {
    return res.status(503).json({ message: "Payments aren't configured yet. Set STRIPE_SECRET_KEY (see .env.example)." });
  }

  const [listing] = await db.select().from(listings).where(eq(listings.id, req.params.id));
  if (!listing) return res.status(404).json({ message: "Listing not found" });
  if (listing.sellerId !== req.user!.id) return res.status(403).json({ message: "Not your listing" });
  if (listing.status !== "active" && listing.status !== "sold_out") {
    return res.status(400).json({ message: "This listing can't be boosted right now." });
  }

  const schema = z.object({ tierId: z.string(), returnUrl: z.string().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid request" });

  const tier = BOOST_TIERS.find((t) => t.id === parsed.data.tierId);
  if (!tier) return res.status(400).json({ message: "Unknown boost tier" });

  const isPro = isActivePro(req.user!);
  const finalPriceCents = boostPriceCentsForUser(tier, isPro);

  const stripe = getStripe();
  let customerId = req.user!.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({ email: req.user!.email ?? undefined, metadata: { userId: req.user!.id } });
    customerId = customer.id;
    await db.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, req.user!.id));
  }

  const baseUrl = process.env.APP_BASE_URL || "http://localhost:5050";
  const target = parsed.data.returnUrl ?? `${baseUrl}/boost-return`;
  const separator = target.includes("?") ? "&" : "?";
  const durationLabel = formatBoostDuration(tier.durationHours);

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: finalPriceCents,
          product_data: { name: `Boost listing — ${durationLabel}`, description: `"${listing.title}" pinned to the top of the marketplace feed for ${durationLabel}.` },
        },
        quantity: 1,
      },
    ],
    payment_intent_data: { metadata: { userId: req.user!.id, kind: "listing_boost", listingId: listing.id, tierId: tier.id, proDiscountApplied: String(isPro) } },
    metadata: { userId: req.user!.id, kind: "listing_boost", listingId: listing.id, tierId: tier.id, proDiscountApplied: String(isPro) },
    success_url: `${target}${separator}status=success`,
    cancel_url: `${target}${separator}status=cancelled`,
  });

  res.json({ url: session.url });
});

export default router;
