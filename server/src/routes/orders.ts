import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { orders, orderItems, users, notifications } from "@shared/schema";
import { COURIERS } from "@shared/schema";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { authenticateToken } from "../middleware/auth";
import { isValidTrackingNumber } from "@shared/validation";
import { getStripe, isStripeConfigured } from "../lib/stripeClient";

const router = Router();
router.use(authenticateToken);

async function withItemsAndParties(orderRows: (typeof orders.$inferSelect)[]) {
  if (orderRows.length === 0) return [];
  const ids = orderRows.map((o) => o.id);
  const userIds = Array.from(new Set(orderRows.flatMap((o) => [o.buyerId, o.sellerId])));
  const [items, people] = await Promise.all([
    db.select().from(orderItems).where(inArray(orderItems.orderId, ids)),
    db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, userIds)),
  ]);
  const itemsByOrder = new Map<string, typeof items>();
  for (const it of items) {
    const arr = itemsByOrder.get(it.orderId) ?? [];
    arr.push(it);
    itemsByOrder.set(it.orderId, arr);
  }
  const personById = new Map(people.map((p) => [p.id, p]));
  return orderRows.map((o) => ({
    ...o,
    items: itemsByOrder.get(o.id) ?? [],
    buyer: personById.get(o.buyerId) ?? null,
    seller: personById.get(o.sellerId) ?? null,
  }));
}

router.get("/mine", async (req, res) => {
  const role = (req.query.role as string) === "seller" ? "seller" : req.query.role === "buyer" ? "buyer" : "all";
  const filter =
    role === "buyer"
      ? eq(orders.buyerId, req.user!.id)
      : role === "seller"
        ? eq(orders.sellerId, req.user!.id)
        : or(eq(orders.buyerId, req.user!.id), eq(orders.sellerId, req.user!.id));

  const rows = await db.select().from(orders).where(filter).orderBy(desc(orders.createdAt));
  res.json(await withItemsAndParties(rows));
});

async function getOwnedOrder(orderId: string, userId: string) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) return null;
  if (order.buyerId !== userId && order.sellerId !== userId) return "forbidden" as const;
  return order;
}

router.get("/:id", async (req, res) => {
  const order = await getOwnedOrder(req.params.id, req.user!.id);
  if (order === null) return res.status(404).json({ message: "Order not found" });
  if (order === "forbidden") return res.status(403).json({ message: "Not your order" });
  const [withDetails] = await withItemsAndParties([order]);
  res.json(withDetails);
});

// ── Seller: add/update tracking info (before shipping or to correct it) ──
router.patch("/:id/tracking", async (req, res) => {
  const schema = z.object({
    courier: z.enum(COURIERS).optional(),
    trackingNumber: z.string().min(1),
    boxSizeLabel: z.string().max(60).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid request" });

  const order = await getOwnedOrder(req.params.id, req.user!.id);
  if (order === null) return res.status(404).json({ message: "Order not found" });
  if (order === "forbidden" || order.sellerId !== req.user!.id) return res.status(403).json({ message: "Only the seller can add tracking" });
  if (order.status === "refunded" || order.status === "cancelled") return res.status(400).json({ message: "This order can't be updated" });

  const courier = parsed.data.courier ?? "other";
  if (!isValidTrackingNumber(courier, parsed.data.trackingNumber)) {
    return res.status(400).json({ message: `That doesn't look like a real ${courier} tracking number. Double-check and try again.` });
  }

  const [updated] = await db
    .update(orders)
    .set({ courier, trackingNumber: parsed.data.trackingNumber.trim(), boxSizeLabel: parsed.data.boxSizeLabel, updatedAt: new Date() })
    .where(eq(orders.id, order.id))
    .returning();

  res.json(updated);
});

// ── Seller: mark as shipped (requires a valid tracking number) ───────────
router.post("/:id/ship", async (req, res) => {
  const schema = z.object({
    courier: z.enum(COURIERS).optional(),
    trackingNumber: z.string().min(1).optional(),
    boxSizeLabel: z.string().max(60).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid request" });

  const order = await getOwnedOrder(req.params.id, req.user!.id);
  if (order === null) return res.status(404).json({ message: "Order not found" });
  if (order === "forbidden" || order.sellerId !== req.user!.id) return res.status(403).json({ message: "Only the seller can mark this shipped" });
  if (order.status !== "paid") return res.status(400).json({ message: "Only a paid, unshipped order can be marked shipped" });

  const trackingNumber = (parsed.data.trackingNumber ?? order.trackingNumber ?? "").trim();
  const courier = parsed.data.courier ?? (order.courier as (typeof COURIERS)[number] | null) ?? "other";

  if (!trackingNumber) {
    return res.status(400).json({ message: "A tracking number is required before you can mark this order as shipped." });
  }
  if (!isValidTrackingNumber(courier, trackingNumber)) {
    return res.status(400).json({ message: `That doesn't look like a real ${courier} tracking number. Double-check and try again.` });
  }

  const [updated] = await db
    .update(orders)
    .set({
      status: "shipped",
      courier,
      trackingNumber,
      boxSizeLabel: parsed.data.boxSizeLabel ?? order.boxSizeLabel,
      shippedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(orders.id, order.id))
    .returning();

  await db.insert(notifications).values({
    userId: order.buyerId,
    type: "shipped",
    title: "Your order has shipped!",
    body: `Tracking: ${trackingNumber} (${courier.replace("_", " ")}). Expect delivery in 1-5 business days.`,
    data: { orderId: order.id, courier, trackingNumber },
  });

  res.json(updated);
});

// ── Buyer: confirm delivery ────────────────────────────────────────────
router.post("/:id/mark-delivered", async (req, res) => {
  const order = await getOwnedOrder(req.params.id, req.user!.id);
  if (order === null) return res.status(404).json({ message: "Order not found" });
  if (order === "forbidden" || order.buyerId !== req.user!.id) return res.status(403).json({ message: "Only the buyer can confirm delivery" });
  if (order.status !== "shipped") return res.status(400).json({ message: "Order hasn't been marked shipped yet" });

  const [updated] = await db.update(orders).set({ status: "delivered", deliveredAt: new Date(), updatedAt: new Date() }).where(eq(orders.id, order.id)).returning();

  await db.insert(notifications).values({
    userId: order.sellerId,
    type: "delivered",
    title: "Delivery confirmed",
    body: `The buyer confirmed they received their order.`,
    data: { orderId: order.id },
  });

  res.json(updated);
});

// ── Buyer: request a refund (only while the order hasn't shipped yet) ────
router.post("/:id/refund", async (req, res) => {
  const schema = z.object({ reason: z.string().min(3).max(500) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Tell us why you're requesting a refund" });

  const order = await getOwnedOrder(req.params.id, req.user!.id);
  if (order === null) return res.status(404).json({ message: "Order not found" });
  if (order === "forbidden" || order.buyerId !== req.user!.id) return res.status(403).json({ message: "Only the buyer can request a refund" });
  if (order.status !== "paid") {
    return res.status(400).json({
      message:
        order.status === "pending_payment"
          ? "This order hasn't been paid yet"
          : "Refunds are only available before the seller ships the order",
    });
  }

  await db.update(orders).set({ status: "refund_requested", refundRequestedAt: new Date(), refundReason: parsed.data.reason }).where(eq(orders.id, order.id));

  if (!isStripeConfigured() || !order.stripePaymentIntentId) {
    return res.status(202).json({
      message: "Refund requested. Payments aren't fully configured yet, so an owner needs to process this refund manually.",
      status: "refund_requested",
    });
  }

  try {
    const stripe = getStripe();
    await stripe.refunds.create({ payment_intent: order.stripePaymentIntentId, reverse_transfer: true });
    const [updated] = await db.update(orders).set({ status: "refunded", refundedAt: new Date(), updatedAt: new Date() }).where(eq(orders.id, order.id)).returning();

    await db.insert(notifications).values([
      { userId: order.buyerId, type: "refund", title: "Refund issued", body: "Your refund has been processed and should appear in 5-10 business days.", data: { orderId: order.id } },
      { userId: order.sellerId, type: "refund", title: "Order refunded", body: `The buyer was refunded for order ${order.id.slice(0, 8)}.`, data: { orderId: order.id } },
    ]);

    res.json(updated);
  } catch (err) {
    console.error("Refund failed:", err);
    res.status(500).json({ message: "Refund could not be processed automatically — an owner will review it." });
  }
});

export default router;
