import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { listings, users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { authenticateToken } from "../middleware/auth";
import { getStripe, isStripeConfigured } from "../lib/stripeClient";
import { BOOST_TIERS, boostPriceCentsForUser, formatBoostDuration, isActivePro, isBoostDiscountEligible } from "@shared/validation";

const router = Router();
router.use(authenticateToken);

// Parses the "apply my Pro discount" toggle from a query/body value that
// may arrive as a real boolean (JSON body) or a string (query param) —
// defaults to on (true) whenever it's simply absent, since opting IN to a
// discount you're eligible for is the sane default; only an explicit
// "false" turns it off.
function parseApplyDiscount(value: unknown): boolean {
  return value !== "false" && value !== false;
}

// ── Tier list, priced for the requesting user. Pro subscribers get 15% off
// tiers of 2 days ($45) or longer — shorter tiers always stay full price —
// and can flip that discount off for themselves with a real toggle (see
// applyDiscount below), not just a cosmetic label. ────────────────────────
router.get("/tiers", async (req, res) => {
  const isPro = isActivePro(req.user!);
  const applyDiscountToggle = parseApplyDiscount(req.query.applyDiscount);
  res.json({
    isPro,
    applyDiscount: applyDiscountToggle,
    tiers: BOOST_TIERS.map((t) => {
      const discountEligible = isBoostDiscountEligible(t);
      const discountApplied = isPro && discountEligible && applyDiscountToggle;
      return {
        id: t.id,
        durationHours: t.durationHours,
        label: formatBoostDuration(t.durationHours),
        priceCents: t.priceCents,
        discountEligible,
        finalPriceCents: boostPriceCentsForUser(t, discountApplied),
      };
    }),
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

  const schema = z.object({ tierId: z.string(), returnUrl: z.string().optional(), applyDiscount: z.boolean().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid request" });

  const tier = BOOST_TIERS.find((t) => t.id === parsed.data.tierId);
  if (!tier) return res.status(400).json({ message: "Unknown boost tier" });

  // Never trust a client-computed price — recompute the same eligibility +
  // toggle decision the /tiers endpoint made, server-side, from real state.
  const isPro = isActivePro(req.user!);
  const applyDiscountToggle = parseApplyDiscount(parsed.data.applyDiscount ?? true);
  const discountApplied = isPro && isBoostDiscountEligible(tier) && applyDiscountToggle;
  const finalPriceCents = boostPriceCentsForUser(tier, discountApplied);

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
    payment_intent_data: { metadata: { userId: req.user!.id, kind: "listing_boost", listingId: listing.id, tierId: tier.id, proDiscountApplied: String(discountApplied) } },
    metadata: { userId: req.user!.id, kind: "listing_boost", listingId: listing.id, tierId: tier.id, proDiscountApplied: String(discountApplied) },
    success_url: `${target}${separator}status=success`,
    cancel_url: `${target}${separator}status=cancelled`,
  });

  res.json({ url: session.url });
});

export default router;
