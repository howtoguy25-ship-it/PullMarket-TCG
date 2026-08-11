import { Router } from "express";
import { db } from "../db";
import { orders, listings, orderItems } from "@shared/schema";
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

  await db
    .update(orders)
    .set({
      status: "paid",
      stripePaymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id,
      shippingDeadline,
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

export default router;
