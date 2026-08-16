import { db } from "../db";
import { orders, reports } from "@shared/schema";
import { and, eq, isNull, lte } from "drizzle-orm";
import { notifyUser } from "./notify";

const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly

/** A paid order whose seller blows past the shipping deadline doesn't get
 * auto-refunded here — that's a real money movement and deserves a human
 * look, not a background job's judgment call. What this sweep actually
 * does: files a real incident report into the existing Owner Panel queue
 * (the same queue user reports and AI-moderation flags land in) so the
 * owner can act, and notifies both sides so nobody's left guessing. Runs
 * on a plain interval since this is a long-lived Express process, not a
 * serverless function — same pattern as lib/autoUnlist.ts. */
export async function sweepOverdueShipments(): Promise<void> {
  const overdue = await db
    .select({ id: orders.id, buyerId: orders.buyerId, sellerId: orders.sellerId, shippingDeadline: orders.shippingDeadline })
    .from(orders)
    .where(and(eq(orders.status, "paid"), lte(orders.shippingDeadline, new Date()), isNull(orders.shippingOverdueFlaggedAt)));

  if (overdue.length === 0) return;

  await db
    .update(orders)
    .set({ shippingOverdueFlaggedAt: new Date() })
    .where(and(eq(orders.status, "paid"), lte(orders.shippingDeadline, new Date()), isNull(orders.shippingOverdueFlaggedAt)));

  await Promise.all(
    overdue.map((order) =>
      db.insert(reports).values({
        source: "system",
        orderId: order.id,
        reportedUserId: order.sellerId,
        reason: "missed_shipping_deadline",
        description: `This order was paid for and its shipping deadline (${order.shippingDeadline?.toISOString() ?? "unknown"}) has passed with no tracking number entered. Auto-filed by the shipping-deadline sweep.`,
      }),
    ),
  );

  await Promise.all(
    overdue.flatMap((order) => [
      notifyUser(order.sellerId, {
        type: "shipping_deadline_missed",
        title: "You missed the shipping deadline",
        body: "One of your orders is now overdue for shipping. Ship it and enter tracking right away — this has been flagged for review.",
        data: { orderId: order.id },
      }),
      notifyUser(order.buyerId, {
        type: "shipping_deadline_missed",
        title: "Your order is overdue for shipping",
        body: "The seller hasn't shipped your order by the deadline. We've flagged it for review — you can also request a refund from the order page.",
        data: { orderId: order.id },
      }),
    ]),
  );
}

export function startShippingDeadlineScheduler(): void {
  sweepOverdueShipments().catch((err) => console.error("Shipping-deadline sweep failed:", err));
  setInterval(() => {
    sweepOverdueShipments().catch((err) => console.error("Shipping-deadline sweep failed:", err));
  }, SWEEP_INTERVAL_MS);
}
