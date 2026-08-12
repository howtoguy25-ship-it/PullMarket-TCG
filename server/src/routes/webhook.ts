import { Router } from "express";
import { db } from "../db";
import { orders, listings, orderItems, users } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { getStripe } from "../lib/stripeClient";
import { addBusinessDays } from "@shared/validation";
import { SHIPPING_DEADLINE_BUSINESS_DAYS } from "@shared/validation";
import Stripe from "stripe";
import { notifyUser } from "../lib/notify";

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
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.orderId;
      if (orderId) await markOrderPaid(orderId, session);
    } else if (event.type.startsWith("identity.verification_session.")) {
      const session = event.data.object as Stripe.Identity.VerificationSession;
      await handleIdentitySessionEvent(event.type, session);
    }
  } catch (err) {
    console.error("Webhook handling failed:", err);
    return res.status(500).json({ error: "Webhook handling failed" });
  }

  res.json({ received: true });
});

async function markOrderPaid(orderId: string, session: Stripe.Checkout.Session) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order || order.status !== "pending_payment") return;

  const shippingDeadline = addBusinessDays(new Date(), SHIPPING_DEADLINE_BUSINESS_DAYS);

  const shipping = session.shipping_details;
  const addr = shipping?.address;

  await db
    .update(orders)
    .set({
      status: "paid",
      stripePaymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id,
      shippingDeadline,
      shippingName: shipping?.name ?? null,
      shippingPhone: session.customer_details?.phone ?? null,
      shippingLine1: addr?.line1 ?? null,
      shippingLine2: addr?.line2 ?? null,
      shippingCity: addr?.city ?? null,
      shippingState: addr?.state ?? null,
      shippingPostalCode: addr?.postal_code ?? null,
      shippingCountry: addr?.country ?? null,
      updatedAt: new Date(),
    })
    .where(eq(orders.id, orderId));

  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  for (const item of items) {
    if (item.listingId) {
      await db
        .update(listings)
        .set({ quantityAvailable: sql`GREATEST(${listings.quantityAvailable} - ${item.quantity}, 0)` })
        .where(eq(listings.id, item.listingId));
    }
  }
  const stillInStock = await db.select().from(listings).where(eq(listings.id, items[0]?.listingId ?? ""));
  for (const l of stillInStock) {
    if (l.quantityAvailable <= 0) await db.update(listings).set({ status: "sold_out" }).where(eq(listings.id, l.id));
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

export default router;
