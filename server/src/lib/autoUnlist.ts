import { db } from "../db";
import { listings } from "@shared/schema";
import { AUTO_UNLIST_OUT_OF_STOCK_DAYS } from "@shared/validation";
import { and, eq, lte, sql } from "drizzle-orm";
import { notifyUser } from "./notify";

const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly

/** Listings sitting sold-out for AUTO_UNLIST_OUT_OF_STOCK_DAYS with no
 * restock come off the marketplace on their own — this is a system action
 * (doesn't touch revisionCount), so the seller can still relist for free
 * once they restock. Runs on a plain interval since this is a long-lived
 * Express process, not a serverless function. */
export async function sweepOutOfStockListings(): Promise<void> {
  const cutoff = sql`NOW() - INTERVAL '${sql.raw(String(AUTO_UNLIST_OUT_OF_STOCK_DAYS))} days'`;
  const stale = await db
    .select({ id: listings.id, sellerId: listings.sellerId, title: listings.title })
    .from(listings)
    .where(and(eq(listings.status, "sold_out"), lte(listings.soldOutAt, cutoff)));

  if (stale.length === 0) return;

  await db
    .update(listings)
    .set({ status: "unlisted", updatedAt: new Date() })
    .where(and(eq(listings.status, "sold_out"), lte(listings.soldOutAt, cutoff)));

  await Promise.all(
    stale.map((l) =>
      notifyUser(l.sellerId, {
        type: "listing_auto_unlisted",
        title: "Listing unlisted",
        body: `"${l.title}" was out of stock for ${AUTO_UNLIST_OUT_OF_STOCK_DAYS} days, so it's been taken off the marketplace. Restock and relist anytime — it's free.`,
        data: { listingId: l.id },
      }),
    ),
  );
}

export function startAutoUnlistScheduler(): void {
  sweepOutOfStockListings().catch((err) => console.error("Auto-unlist sweep failed:", err));
  setInterval(() => {
    sweepOutOfStockListings().catch((err) => console.error("Auto-unlist sweep failed:", err));
  }, SWEEP_INTERVAL_MS);
}
