import { db } from "../db";
import { listings, listingBoosts, users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { getBoostTierById, formatBoostDuration } from "@shared/validation";
import { notifyUser } from "./notify";

interface ApplyListingBoostArgs {
  userId: string;
  listingId: string;
  tierId: string;
  priceCentsPaid: number;
  proDiscountApplied: boolean;
  // Exactly one of these identifies the payment that earned this boost, and
  // doubles as the idempotency key — a payment provider retrying/re-firing
  // its confirmation (Stripe's webhook fires checkout.session.completed AND
  // payment_intent.succeeded for the same purchase; a client could in theory
  // retry a stalled Apple verify call) must never stack the same paid boost
  // onto a listing twice.
  stripePaymentIntentId?: string | null;
  appleTransactionId?: string | null;
}

/** Extends (or starts) a listing's boostedUntil window and records the
 * purchase, shared by both the Stripe webhook and the Apple IAP verify
 * route so the two payment rails can never apply this differently. Multiple
 * boosts stack — a new purchase extends from whichever is later, the
 * listing's current boostedUntil or now, rather than overwriting it. */
export async function applyListingBoost(args: ApplyListingBoostArgs): Promise<void> {
  const { userId, listingId, tierId, priceCentsPaid, proDiscountApplied, stripePaymentIntentId, appleTransactionId } = args;
  const tier = getBoostTierById(tierId);
  if (!tier) return;

  if (stripePaymentIntentId) {
    const [existing] = await db.select({ id: listingBoosts.id }).from(listingBoosts).where(eq(listingBoosts.stripePaymentIntentId, stripePaymentIntentId));
    if (existing) return;
  }
  if (appleTransactionId) {
    const [existing] = await db.select({ id: listingBoosts.id }).from(listingBoosts).where(eq(listingBoosts.appleTransactionId, appleTransactionId));
    if (existing) return;
  }

  const [listing] = await db
    .select({ title: listings.title, sellerId: listings.sellerId, boostedUntil: listings.boostedUntil, boostPaused: listings.boostPaused, boostPausedRemainingMs: listings.boostPausedRemainingMs })
    .from(listings)
    .where(eq(listings.id, listingId));
  if (!listing) return;

  const now = new Date();
  const durationMs = tier.durationHours * 60 * 60 * 1000;

  // A listing the seller has explicitly paused stays paused through a new
  // purchase — it just adds the extra time to what's frozen, rather than
  // silently un-pausing a decision the seller made on purpose.
  if (listing.boostPaused) {
    const newRemainingMs = (listing.boostPausedRemainingMs ?? 0) + durationMs;
    await db.update(listings).set({ boostPausedRemainingMs: newRemainingMs, updatedAt: now }).where(eq(listings.id, listingId));
  } else {
    const base = listing.boostedUntil && listing.boostedUntil.getTime() > now.getTime() ? listing.boostedUntil : now;
    const newBoostedUntil = new Date(base.getTime() + durationMs);
    await db.update(listings).set({ boostedUntil: newBoostedUntil, updatedAt: now }).where(eq(listings.id, listingId));
  }

  await db.insert(listingBoosts).values({
    listingId,
    userId,
    tierId,
    durationHours: tier.durationHours,
    priceCentsPaid,
    proDiscountApplied,
    stripePaymentIntentId: stripePaymentIntentId ?? null,
    appleTransactionId: appleTransactionId ?? null,
  });

  const durationLabel = formatBoostDuration(tier.durationHours);
  const isSelfBoost = userId === listing.sellerId;

  if (isSelfBoost) {
    await notifyUser(userId, {
      type: "listing_boosted",
      title: "Your listing is boosted!",
      body: `"${listing.title}" is now pinned to the top of the marketplace for ${durationLabel}.`,
      data: { listingId },
    });
  } else {
    const [buyer] = await db.select({ username: users.username }).from(users).where(eq(users.id, userId));
    await notifyUser(listing.sellerId, {
      type: "listing_boosted",
      title: "Someone boosted your listing!",
      body: `@${buyer?.username ?? "A buyer"} paid to promote "${listing.title}" — it's pinned to the top of the marketplace for ${durationLabel}.`,
      data: { listingId },
    });
    await notifyUser(userId, {
      type: "listing_boosted",
      title: "You boosted a listing!",
      body: `"${listing.title}" is now pinned to the top of the marketplace for ${durationLabel} — thanks for helping a fellow collector out.`,
      data: { listingId },
    });
  }
}

/** Same boostedUntil math as applyListingBoost, but for a free grant the
 * app owner hands out from the Owner Panel — no payment record, no
 * idempotency key (each tap is a deliberate admin action), and a
 * notification that reads as a gift rather than "someone paid to promote
 * your listing." */
export async function applyOwnerFreeBoost(listingId: string, tierId: string): Promise<{ boostedUntil: Date } | null> {
  const tier = getBoostTierById(tierId);
  if (!tier) return null;

  const [listing] = await db
    .select({ title: listings.title, sellerId: listings.sellerId, boostedUntil: listings.boostedUntil, boostPaused: listings.boostPaused, boostPausedRemainingMs: listings.boostPausedRemainingMs })
    .from(listings)
    .where(eq(listings.id, listingId));
  if (!listing) return null;

  const now = new Date();
  const durationMs = tier.durationHours * 60 * 60 * 1000;
  let boostedUntil: Date;

  if (listing.boostPaused) {
    const newRemainingMs = (listing.boostPausedRemainingMs ?? 0) + durationMs;
    await db.update(listings).set({ boostPausedRemainingMs: newRemainingMs, updatedAt: now }).where(eq(listings.id, listingId));
    boostedUntil = new Date(now.getTime() + newRemainingMs);
  } else {
    const base = listing.boostedUntil && listing.boostedUntil.getTime() > now.getTime() ? listing.boostedUntil : now;
    boostedUntil = new Date(base.getTime() + durationMs);
    await db.update(listings).set({ boostedUntil, updatedAt: now }).where(eq(listings.id, listingId));
  }

  await db.insert(listingBoosts).values({
    listingId,
    userId: listing.sellerId,
    tierId,
    durationHours: tier.durationHours,
    priceCentsPaid: 0,
    proDiscountApplied: false,
  });

  const durationLabel = formatBoostDuration(tier.durationHours);
  await notifyUser(listing.sellerId, {
    type: "listing_boosted",
    title: "The PullMarket team boosted your listing!",
    body: `"${listing.title}" is now pinned to the top of the marketplace for ${durationLabel} — on us.`,
    data: { listingId },
  });

  return { boostedUntil };
}
