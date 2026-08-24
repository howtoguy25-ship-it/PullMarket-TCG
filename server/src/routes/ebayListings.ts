import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { ebayListings } from "@shared/schema";
import { and, desc, eq, gte, ilike, lte, inArray } from "drizzle-orm";
import { toAffiliateUrl, isEbayConfigured, isEpnConfigured } from "../lib/ebay";
import { getUsdToAudRate } from "../lib/fx";

const router = Router();

// Real eBay-sourced cards, kept separate from this marketplace's own user
// listings at the storage level (see ebayListings in shared/schema.ts) —
// this endpoint is what lets the client interleave the two at render time.
router.get("/", async (req, res) => {
  if (!isEbayConfigured()) {
    return res.status(503).json({ message: "eBay listings aren't configured yet. Set EBAY_APP_ID/EBAY_CERT_ID (see .env.example)." });
  }

  const querySchema = z.object({
    q: z.string().optional(),
    franchise: z.string().optional(), // comma-separated: "pokemon,one_piece"
    minPrice: z.coerce.number().optional(),
    maxPrice: z.coerce.number().optional(),
    limit: z.coerce.number().min(1).max(100).default(50),
    offset: z.coerce.number().min(0).default(0),
  });
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: "Invalid query" });
  const { q, franchise, minPrice, maxPrice, limit, offset } = parsed.data;

  const conditions = [];
  if (q) conditions.push(ilike(ebayListings.title, `%${q}%`));
  if (franchise) {
    const list = franchise.split(",").filter(Boolean);
    if (list.length > 0) conditions.push(inArray(ebayListings.franchise, list));
  }
  if (minPrice !== undefined) conditions.push(gte(ebayListings.priceCents, Math.round(minPrice * 100)));
  if (maxPrice !== undefined) conditions.push(lte(ebayListings.priceCents, Math.round(maxPrice * 100)));

  const [rows, usdToAud] = await Promise.all([
    db
      .select()
      .from(ebayListings)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(ebayListings.lastSeenAt))
      .limit(limit)
      .offset(offset),
    getUsdToAudRate().catch(() => null),
  ]);

  res.json({
    listings: rows.map((r) => ({
      id: r.id,
      ebayItemId: r.ebayItemId,
      title: r.title,
      franchise: r.franchise,
      priceCents: r.priceCents,
      priceAudCents: usdToAud && r.currency === "USD" ? Math.round(r.priceCents * usdToAud) : null,
      currency: r.currency,
      condition: r.condition,
      imageUrl: r.imageUrl,
      affiliateUrl: toAffiliateUrl(r.itemWebUrl),
      sellerUsername: r.sellerUsername,
      source: "ebay" as const,
    })),
    epnActive: isEpnConfigured(),
  });
});

export default router;
