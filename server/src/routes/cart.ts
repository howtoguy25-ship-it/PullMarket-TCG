import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { cartItems, listings, listingImages, users } from "@shared/schema";
import { and, eq, inArray } from "drizzle-orm";
import { authenticateToken } from "../middleware/auth";
import { getPlatformFeeCents } from "../lib/stripeClient";

const router = Router();
router.use(authenticateToken);

async function getCartWithDetails(userId: string) {
  const rows = await db
    .select({ cartItem: cartItems, listing: listings })
    .from(cartItems)
    .innerJoin(listings, eq(cartItems.listingId, listings.id))
    .where(eq(cartItems.userId, userId));

  const ids = rows.map((r) => r.listing.id);
  const sellerIds = Array.from(new Set(rows.map((r) => r.listing.sellerId)));
  const [images, sellers] = ids.length
    ? await Promise.all([
        db.select().from(listingImages).where(inArray(listingImages.listingId, ids)).orderBy(listingImages.position),
        db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, sellerIds)),
      ])
    : [[], []];
  const firstImageByListing = new Map<string, string>();
  for (const img of images) if (!firstImageByListing.has(img.listingId)) firstImageByListing.set(img.listingId, img.url);
  const sellerById = new Map(sellers.map((s) => [s.id, s]));

  const items = rows.map((r) => ({
    id: r.cartItem.id,
    listingId: r.listing.id,
    title: r.listing.title,
    priceCents: r.listing.priceCents,
    quantity: r.cartItem.quantity,
    quantityAvailable: r.listing.quantityAvailable,
    image: firstImageByListing.get(r.listing.id) ?? null,
    seller: sellerById.get(r.listing.sellerId) ?? null,
    status: r.listing.status,
  }));

  // Group by seller since checkout splits into one order (and one $ fee) per seller.
  const bySeller = new Map<string, typeof items>();
  for (const item of items) {
    const key = item.seller?.id ?? "unknown";
    const arr = bySeller.get(key) ?? [];
    arr.push(item);
    bySeller.set(key, arr);
  }
  const platformFeeCents = getPlatformFeeCents();
  const groups = Array.from(bySeller.entries()).map(([sellerId, sellerItems]) => {
    const subtotalCents = sellerItems.reduce((sum, i) => sum + i.priceCents * i.quantity, 0);
    return {
      sellerId,
      seller: sellerItems[0].seller,
      items: sellerItems,
      subtotalCents,
      platformFeeCents,
      totalCents: subtotalCents + platformFeeCents,
    };
  });

  return { items, groups, grandTotalCents: groups.reduce((s, g) => s + g.totalCents, 0) };
}

router.get("/", async (req, res) => {
  res.json(await getCartWithDetails(req.user!.id));
});

router.post("/", async (req, res) => {
  const schema = z.object({ listingId: z.string(), quantity: z.coerce.number().int().min(1).max(99).default(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid request" });
  const { listingId, quantity } = parsed.data;

  const [listing] = await db.select().from(listings).where(eq(listings.id, listingId));
  if (!listing || listing.status !== "active") return res.status(404).json({ message: "Listing not available" });
  if (listing.sellerId === req.user!.id) return res.status(400).json({ message: "You can't buy your own listing" });

  const [existing] = await db
    .select()
    .from(cartItems)
    .where(and(eq(cartItems.userId, req.user!.id), eq(cartItems.listingId, listingId)));

  const desiredQty = Math.min((existing?.quantity ?? 0) + quantity, listing.quantityAvailable);

  if (existing) {
    await db.update(cartItems).set({ quantity: desiredQty, updatedAt: new Date() }).where(eq(cartItems.id, existing.id));
  } else {
    await db.insert(cartItems).values({ userId: req.user!.id, listingId, quantity: Math.min(quantity, listing.quantityAvailable) });
  }

  res.json(await getCartWithDetails(req.user!.id));
});

router.patch("/:itemId", async (req, res) => {
  const schema = z.object({ quantity: z.coerce.number().int().min(1).max(99) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid request" });

  const [item] = await db.select().from(cartItems).where(eq(cartItems.id, req.params.itemId));
  if (!item || item.userId !== req.user!.id) return res.status(404).json({ message: "Not found" });

  const [listing] = await db.select().from(listings).where(eq(listings.id, item.listingId));
  const cappedQty = Math.min(parsed.data.quantity, listing?.quantityAvailable ?? parsed.data.quantity);

  await db.update(cartItems).set({ quantity: cappedQty, updatedAt: new Date() }).where(eq(cartItems.id, item.id));
  res.json(await getCartWithDetails(req.user!.id));
});

router.delete("/:itemId", async (req, res) => {
  const [item] = await db.select().from(cartItems).where(eq(cartItems.id, req.params.itemId));
  if (!item || item.userId !== req.user!.id) return res.status(404).json({ message: "Not found" });
  await db.delete(cartItems).where(eq(cartItems.id, item.id));
  res.json(await getCartWithDetails(req.user!.id));
});

export { getCartWithDetails };
export default router;
