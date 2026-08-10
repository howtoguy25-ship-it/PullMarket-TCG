import { Router } from "express";
import { db } from "../db";
import { favorites, listings, listingImages, users } from "@shared/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { authenticateToken } from "../middleware/auth";

const router = Router();
router.use(authenticateToken);

router.get("/", async (req, res) => {
  const rows = await db
    .select({ listing: listings })
    .from(favorites)
    .innerJoin(listings, eq(favorites.listingId, listings.id))
    .where(eq(favorites.userId, req.user!.id));

  const listingRows = rows.map((r) => r.listing);
  const ids = listingRows.map((l) => l.id);
  const sellerIds = Array.from(new Set(listingRows.map((l) => l.sellerId)));
  const [images, sellers] = ids.length
    ? await Promise.all([
        db.select().from(listingImages).where(inArray(listingImages.listingId, ids)).orderBy(listingImages.position),
        db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, sellerIds)),
      ])
    : [[], []];
  const imagesByListing = new Map<string, typeof images>();
  for (const img of images) {
    const arr = imagesByListing.get(img.listingId) ?? [];
    arr.push(img);
    imagesByListing.set(img.listingId, arr);
  }
  const sellerById = new Map(sellers.map((s) => [s.id, s]));

  res.json(
    listingRows.map((l) => ({
      ...l,
      images: (imagesByListing.get(l.id) ?? []).map((i) => i.url),
      seller: sellerById.get(l.sellerId) ?? null,
    })),
  );
});

router.post("/:listingId", async (req, res) => {
  const { listingId } = req.params;
  const [listing] = await db.select().from(listings).where(eq(listings.id, listingId));
  if (!listing) return res.status(404).json({ message: "Listing not found" });

  const [existing] = await db
    .select()
    .from(favorites)
    .where(and(eq(favorites.userId, req.user!.id), eq(favorites.listingId, listingId)));

  if (existing) {
    await db.delete(favorites).where(and(eq(favorites.userId, req.user!.id), eq(favorites.listingId, listingId)));
    await db.update(listings).set({ favoriteCount: sql`GREATEST(${listings.favoriteCount} - 1, 0)` }).where(eq(listings.id, listingId));
    return res.json({ favorited: false });
  }

  await db.insert(favorites).values({ userId: req.user!.id, listingId });
  await db.update(listings).set({ favoriteCount: sql`${listings.favoriteCount} + 1` }).where(eq(listings.id, listingId));
  res.json({ favorited: true });
});

export default router;
