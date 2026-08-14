import { db } from "../db";
import { listings, listingBoosts } from "@shared/schema";
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

  const [listing] = await db.select({ boostedUntil: listings.boostedUntil }).from(listings).where(eq(listings.id, listingId));
  if (!listing) return;

  const now = new Date();
  const base = listing.boostedUntil && listing.boostedUntil.getTime() > now.getTime() ? listing.boostedUntil : now;
  const newBoostedUntil = new Date(base.getTime() + tier.durationHours * 60 * 60 * 1000);

  await db.update(listings).set({ boostedUntil: newBoostedUntil, updatedAt: now }).where(eq(listings.id, listingId));

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

  await notifyUser(userId, {
    type: "listing_boosted",
    title: "Your listing is boosted!",
    body: `Your listing is now pinned to the top of the marketplace for ${formatBoostDuration(tier.durationHours)}.`,
    data: { listingId },
  });
}
