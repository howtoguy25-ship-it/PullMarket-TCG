import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { listings, users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { authenticateToken } from "../middleware/auth";
import { getStripe, isStripeConfigured } from "../lib/stripeClient";
import { BOOST_TIERS, boostPriceCentsForUser, formatBoostDuration, isActivePro, isBoostDiscountEligible, getBoostTierByAppleProductId } from "@shared/validation";
import { verifyAppleTransaction } from "../lib/appleSubscription";
import { applyListingBoost } from "../lib/boostApply";

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

// ── Start a real Stripe Checkout for boosting a listing — either the
// seller boosting their own, or any other signed-in user paying to
// promote someone else's listing (see the "Promote this listing" prompt
// on ListingDetailScreen). The boost only actually applies once the
// webhook confirms payment (see routes/webhook.ts markListingBoosted). ──
router.post("/listings/:id/checkout", async (req, res) => {
  if (!isStripeConfigured()) {
    return res.status(503).json({ message: "Payments aren't configured yet. Set STRIPE_SECRET_KEY (see .env.example)." });
  }

  const [listing] = await db.select().from(listings).where(eq(listings.id, req.params.id));
  if (!listing) return res.status(404).json({ message: "Listing not found" });
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

// ── Apple IAP: verify a StoreKit consumable purchase (iOS) ───────────────
// Apple's own price tiers are fixed per product, so unlike the Stripe path
// there's no Pro discount to apply here — an iOS boost purchase is always
// full price (see BoostListingScreen, which hides the discount toggle on
// iOS for the same reason).
router.post("/listings/:id/apple/verify", async (req, res) => {
  const [listing] = await db.select().from(listings).where(eq(listings.id, req.params.id));
  if (!listing) return res.status(404).json({ message: "Listing not found" });
  if (listing.status !== "active" && listing.status !== "sold_out") {
    return res.status(400).json({ message: "This listing can't be boosted right now." });
  }

  const schema = z.object({ jws: z.string() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid request" });

  let transaction;
  try {
    transaction = await verifyAppleTransaction(parsed.data.jws);
  } catch (err) {
    console.error("Apple boost transaction verification failed:", err);
    return res.status(400).json({ message: "Couldn't verify this purchase with Apple." });
  }

  const tier = transaction.productId ? getBoostTierByAppleProductId(transaction.productId) : undefined;
  if (!tier) return res.status(400).json({ message: "This purchase doesn't match a known boost tier." });
  if (!transaction.transactionId) return res.status(400).json({ message: "Invalid transaction — missing transaction id." });

  // Apple reports price in milliunits (thousandths of a currency unit);
  // cents = milliunits / 10. Falls back to the tier's own list price if
  // Apple didn't include one (older transaction shapes sometimes omit it).
  const priceCentsPaid = typeof transaction.price === "number" ? Math.round(transaction.price / 10) : tier.priceCents;

  await applyListingBoost({
    userId: req.user!.id,
    listingId: listing.id,
    tierId: tier.id,
    priceCentsPaid,
    proDiscountApplied: false,
    appleTransactionId: transaction.transactionId,
  });

  res.json({ boosted: true });
});

// ── Real-time status for the "manage your boost" card — active/paused/
// finished/never-boosted, and exactly what actions are valid right now. ──
router.get("/listings/:id/status", async (req, res) => {
  const [listing] = await db
    .select({ sellerId: listings.sellerId, boostedUntil: listings.boostedUntil, boostPaused: listings.boostPaused, boostPausedRemainingMs: listings.boostPausedRemainingMs })
    .from(listings)
    .where(eq(listings.id, req.params.id));
  if (!listing) return res.status(404).json({ message: "Listing not found" });

  const isOwner = listing.sellerId === req.user!.id;
  const now = Date.now();
  const isActive = !listing.boostPaused && !!listing.boostedUntil && listing.boostedUntil.getTime() > now;
  const isPaused = listing.boostPaused && (listing.boostPausedRemainingMs ?? 0) > 0;

  res.json({
    isOwner,
    isBoosted: isActive,
    boostedUntil: isActive ? listing.boostedUntil : null,
    isPaused,
    remainingMs: isPaused ? listing.boostPausedRemainingMs : isActive ? listing.boostedUntil!.getTime() - now : 0,
    canPause: isOwner && isActive,
    canResume: isOwner && isPaused,
    canCancel: isOwner && (isActive || isPaused),
  });
});

// ── Pause: freezes exactly the time remaining, and immediately stops the
// listing from being treated as boosted (no sponsored placement) until
// resumed. Only the listing's own seller can pause it, regardless of who
// actually paid for the boost — it's their listing's placement. ─────────
router.post("/listings/:id/pause", async (req, res) => {
  const [listing] = await db.select({ sellerId: listings.sellerId, boostedUntil: listings.boostedUntil, boostPaused: listings.boostPaused }).from(listings).where(eq(listings.id, req.params.id));
  if (!listing) return res.status(404).json({ message: "Listing not found" });
  if (listing.sellerId !== req.user!.id) return res.status(403).json({ message: "Not your listing" });

  const now = Date.now();
  if (listing.boostPaused) return res.status(400).json({ message: "This boost is already paused." });
  if (!listing.boostedUntil || listing.boostedUntil.getTime() <= now) {
    return res.status(400).json({ message: "This listing isn't currently boosted." });
  }

  const remainingMs = listing.boostedUntil.getTime() - now;
  await db.update(listings).set({ boostedUntil: null, boostPaused: true, boostPausedRemainingMs: remainingMs, updatedAt: new Date() }).where(eq(listings.id, req.params.id));

  res.json({ paused: true, remainingMs });
});

// ── Resume: picks the boost back up with exactly the time it had left. ──
router.post("/listings/:id/resume", async (req, res) => {
  const [listing] = await db
    .select({ sellerId: listings.sellerId, boostPaused: listings.boostPaused, boostPausedRemainingMs: listings.boostPausedRemainingMs })
    .from(listings)
    .where(eq(listings.id, req.params.id));
  if (!listing) return res.status(404).json({ message: "Listing not found" });
  if (listing.sellerId !== req.user!.id) return res.status(403).json({ message: "Not your listing" });
  if (!listing.boostPaused || !listing.boostPausedRemainingMs || listing.boostPausedRemainingMs <= 0) {
    return res.status(400).json({ message: "This boost isn't paused, or its time already ran out." });
  }

  const boostedUntil = new Date(Date.now() + listing.boostPausedRemainingMs);
  await db.update(listings).set({ boostedUntil, boostPaused: false, boostPausedRemainingMs: null, updatedAt: new Date() }).where(eq(listings.id, req.params.id));

  res.json({ resumed: true, boostedUntil });
});

// ── Cancel: a hard, permanent stop — unlike pause, this isn't resumable.
// No refund is issued (the boost time already purchased simply ends
// early); real money-back handling would need a genuine per-case decision
// this endpoint deliberately doesn't make on its own. ────────────────────
router.post("/listings/:id/cancel", async (req, res) => {
  const [listing] = await db
    .select({ sellerId: listings.sellerId, boostedUntil: listings.boostedUntil, boostPaused: listings.boostPaused, boostPausedRemainingMs: listings.boostPausedRemainingMs })
    .from(listings)
    .where(eq(listings.id, req.params.id));
  if (!listing) return res.status(404).json({ message: "Listing not found" });
  if (listing.sellerId !== req.user!.id) return res.status(403).json({ message: "Not your listing" });

  const now = Date.now();
  const isActive = !listing.boostPaused && !!listing.boostedUntil && listing.boostedUntil.getTime() > now;
  const isPaused = listing.boostPaused && (listing.boostPausedRemainingMs ?? 0) > 0;
  if (!isActive && !isPaused) return res.status(400).json({ message: "This listing isn't currently boosted." });

  await db.update(listings).set({ boostedUntil: null, boostPaused: false, boostPausedRemainingMs: null, updatedAt: new Date() }).where(eq(listings.id, req.params.id));

  res.json({ cancelled: true });
});

export default router;
