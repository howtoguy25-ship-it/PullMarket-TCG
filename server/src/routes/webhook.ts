import { Router } from "express";
import { db } from "../db";
import { orders, listings, orderItems, users } from "@shared/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { getStripe } from "../lib/stripeClient";
import { addBusinessDays, getBoostTierById, boostPriceCentsForUser } from "@shared/validation";
import { SHIPPING_DEADLINE_BUSINESS_DAYS } from "@shared/validation";
import Stripe from "stripe";
import { notifyUser } from "../lib/notify";
import { applyListingBoost } from "../lib/boostApply";

const router = Router();

// Mounted with express.raw() in index.ts — must run BEFORE express.json().
router.post("/", async (req, res) => {
  const signature = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !webhookSecret) return res.status(400).json({ error: "Webhook not configured" });

  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body as Buffer, signature as string, webhookSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return res.status(400).json({ error: "Invalid signature" });
  }

  try {
    if (event.type === "checkout.session.completed") {
      // The web fallback (Stripe's hosted page) — the only path where the
      // buyer's address is collected by Stripe itself rather than the
      // app's own form, so it's copied over here before marking paid.
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.orderId;
      if (orderId) {
        await copyShippingFromCheckoutSession(orderId, session);
        await markOrderPaid(orderId);
      } else if (session.metadata?.kind === "remove_ads" && session.metadata.userId) {
        await markAdsRemoved(session.metadata.userId, session.payment_intent as string | null);
      } else if (session.metadata?.kind === "listing_boost" && session.metadata.listingId) {
        await markListingBoosted(session.metadata, session.payment_intent as string | null);
      }
    } else if (event.type === "payment_intent.succeeded") {
      // The custom in-app checkout (native) creates and confirms a
      // PaymentIntent directly — but note a Checkout Session ALSO creates
      // its own underlying PaymentIntent, so this fires for the web path
      // too, in either order relative to checkout.session.completed.
      // markOrderPaid is idempotent (only acts on a still-pending order),
      // and copyShippingFromCheckoutSession runs unconditionally whenever
      // its own event arrives, so handling both for the same order is
      // harmless regardless of delivery order. Same idempotency logic
      // applies to markAdsRemoved below.
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      const orderId = paymentIntent.metadata?.orderId;
      if (orderId) {
        await markOrderPaid(orderId);
      } else if (paymentIntent.metadata?.kind === "remove_ads" && paymentIntent.metadata.userId) {
        await markAdsRemoved(paymentIntent.metadata.userId, paymentIntent.id);
      } else if (paymentIntent.metadata?.kind === "listing_boost" && paymentIntent.metadata.listingId) {
        await markListingBoosted(paymentIntent.metadata, paymentIntent.id);
      }
    } else if (event.type.startsWith("identity.verification_session.")) {
      const session = event.data.object as Stripe.Identity.VerificationSession;
      await handleIdentitySessionEvent(event.type, session);
    } else if (event.type.startsWith("customer.subscription.")) {
      // Covers created/updated/deleted uniformly — Stripe's subscription
      // object's own `status` field already reflects the current state on
      // all three event types, including the moment it first goes active
      // (no separate handling of checkout.session.completed for
      // subscriptions needed: the Customer is created explicitly before
      // the Checkout Session in routes/subscription.ts, so there's no
      // "which customer is this" ambiguity to resolve there).
      const subscription = event.data.object as Stripe.Subscription;
      await handleProSubscriptionEvent(subscription);
    }
  } catch (err) {
    console.error("Webhook handling failed:", err);
    return res.status(500).json({ error: "Webhook handling failed" });
  }

  res.json({ received: true });
});

async function copyShippingFromCheckoutSession(orderId: string, session: Stripe.Checkout.Session) {
  const shipping = session.shipping_details;
  const addr = shipping?.address;
  if (!addr) return;
  await db
    .update(orders)
    .set({
      shippingName: shipping?.name ?? null,
      shippingPhone: session.customer_details?.phone ?? null,
      shippingLine1: addr.line1 ?? null,
      shippingLine2: addr.line2 ?? null,
      shippingCity: addr.city ?? null,
      shippingState: addr.state ?? null,
      shippingPostalCode: addr.postal_code ?? null,
      shippingCountry: addr.country ?? null,
    })
    .where(eq(orders.id, orderId));
}

async function markOrderPaid(orderId: string) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order || order.status !== "pending_payment") return;

  // For the custom in-app checkout, the shipping address is already on the
  // order (written when it was created — see routes/checkout.ts POST
  // /intent). For the web/Checkout Session path it's copied in by
  // copyShippingFromCheckoutSession above before this runs.
  const shippingDeadline = addBusinessDays(new Date(), SHIPPING_DEADLINE_BUSINESS_DAYS);

  await db
    .update(orders)
    .set({
      status: "paid",
      shippingDeadline,
      updatedAt: new Date(),
    })
    .where(eq(orders.id, orderId));

  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  const affectedListingIds = new Set<string>();
  for (const item of items) {
    if (item.listingId) {
      await db
        .update(listings)
        .set({ quantityAvailable: sql`GREATEST(${listings.quantityAvailable} - ${item.quantity}, 0)` })
        .where(eq(listings.id, item.listingId));
      affectedListingIds.add(item.listingId);
    }
  }
  if (affectedListingIds.size > 0) {
    const updatedListings = await db.select().from(listings).where(inArray(listings.id, Array.from(affectedListingIds)));
    for (const l of updatedListings) {
      if (l.quantityAvailable <= 0 && l.status !== "sold_out") {
        await db.update(listings).set({ status: "sold_out", soldOutAt: new Date() }).where(eq(listings.id, l.id));
      }
    }
  }

  await Promise.all([
    notifyUser(order.buyerId, {
      type: "purchase",
      title: "Order confirmed",
      body: `Your payment went through — the seller has ${SHIPPING_DEADLINE_BUSINESS_DAYS} business days to ship your order.`,
      data: { orderId },
    }),
    notifyUser(order.sellerId, {
      type: "sale",
      title: "You made a sale!",
      body: `Add tracking and mark the order as shipped within ${SHIPPING_DEADLINE_BUSINESS_DAYS} business days.`,
      data: { orderId },
    }),
  ]);
}

// ── Stripe Identity (seller KYC): the only place identityVerificationStatus
// ever moves out of "pending" — without this, a failed or abandoned check
// left a seller stuck showing "pending" forever with no way to retry. ─────
async function handleIdentitySessionEvent(eventType: string, session: Stripe.Identity.VerificationSession) {
  const userId = session.metadata?.userId;
  if (!userId) return;

  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user || user.identityVerificationSessionId !== session.id) return;

  if (eventType === "identity.verification_session.verified") {
    await db.update(users).set({ identityVerificationStatus: "verified", identityVerifiedAt: new Date() }).where(eq(users.id, userId));
    await notifyUser(userId, {
      type: "identity_verified",
      title: "You're verified!",
      body: "Your identity has been verified — you can now list cards for sale.",
    });
    return;
  }

  // "requires_input" fires both while a session is still awaiting the
  // user's first submission and after a failed check — session.last_error
  // is only set in the latter case, so that's what actually means "can't
  // be verified" and should be labeled as such.
  const failed = eventType === "identity.verification_session.canceled" || (eventType === "identity.verification_session.requires_input" && !!session.last_error);
  if (failed) {
    await db.update(users).set({ identityVerificationStatus: "failed" }).where(eq(users.id, userId));
    await notifyUser(userId, {
      type: "identity_failed",
      title: "Verification didn't go through",
      body: session.last_error?.reason || "We couldn't verify your identity. You can try again from your profile.",
    });
  }
}

async function markAdsRemoved(userId: string, stripePaymentIntentId: string | null) {
  await db
    .update(users)
    .set({ adsRemoved: true, adsRemovedSource: "stripe", adsRemovedStripePaymentIntentId: stripePaymentIntentId })
    .where(eq(users.id, userId));
}

// checkout.session.completed and payment_intent.succeeded both fire for the
// same purchase — unlike markAdsRemoved (idempotent by nature, it just sets
// a flag), applying a boost twice would double the duration, so the shared
// applyListingBoost (also used by the Apple IAP verify route in
// routes/boost.ts) guards explicitly by payment intent id.
async function markListingBoosted(metadata: Stripe.Metadata, stripePaymentIntentId: string | null) {
  const { userId, listingId, tierId, proDiscountApplied } = metadata;
  if (!userId || !listingId || !tierId) return;

  const tier = getBoostTierById(tierId);
  if (!tier) return;

  const wasProDiscount = proDiscountApplied === "true";
  await applyListingBoost({
    userId,
    listingId,
    tierId,
    priceCentsPaid: boostPriceCentsForUser(tier, wasProDiscount),
    proDiscountApplied: wasProDiscount,
    stripePaymentIntentId,
  });
}

// Maps Stripe's subscription lifecycle onto the three states the rest of
// the app cares about. 'trialing' counts as active (no trial is actually
// offered right now, but treating it as active is the correct behavior if
// one ever is); 'past_due'/'unpaid' surface as past_due rather than
// silently active or silently canceled, since neither is true — Stripe is
// still retrying the payment. Anything else (canceled, incomplete_expired,
// paused) is a real end state.
async function handleProSubscriptionEvent(subscription: Stripe.Subscription) {
  let userId = subscription.metadata?.userId;
  if (!userId) {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.stripeCustomerId, subscription.customer as string));
    userId = u?.id;
  }
  if (!userId) return;

  const mappedStatus = subscription.status === "active" || subscription.status === "trialing" ? "active" : subscription.status === "past_due" || subscription.status === "unpaid" ? "past_due" : "canceled";

  await db
    .update(users)
    .set({
      proStatus: mappedStatus,
      proSource: "stripe",
      proStripeSubscriptionId: subscription.id,
      proCurrentPeriodEnd: new Date(subscription.current_period_end * 1000),
      proCancelAtPeriodEnd: subscription.cancel_at_period_end,
    })
    .where(eq(users.id, userId));
}

export default router;
