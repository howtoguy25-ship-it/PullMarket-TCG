import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { listings, listingImages, users, favorites, franchiseSubscriptions } from "@shared/schema";
import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { authenticateToken } from "../middleware/auth";
import { upload, saveUploadedFile } from "../lib/upload";
import { CONDITIONS, FRANCHISES } from "@shared/schema";
import { detectFranchise } from "@shared/validation";
import { notifyUsers } from "../lib/notify";

const router = Router();

function listingWithSellerAndImages() {
  return {
    id: listings.id,
    sellerId: listings.sellerId,
    title: listings.title,
    description: listings.description,
    franchise: listings.franchise,
    priceCents: listings.priceCents,
    condition: listings.condition,
    quantityTotal: listings.quantityTotal,
    quantityAvailable: listings.quantityAvailable,
    status: listings.status,
    viewCount: listings.viewCount,
    favoriteCount: listings.favoriteCount,
    createdAt: listings.createdAt,
    updatedAt: listings.updatedAt,
  };
}

export async function attachImagesAndSellers(rows: (typeof listings.$inferSelect)[]) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const sellerIds = Array.from(new Set(rows.map((r) => r.sellerId)));
  const [images, sellers] = await Promise.all([
    db.select().from(listingImages).where(inArray(listingImages.listingId, ids)).orderBy(listingImages.position),
    db.select({ id: users.id, username: users.username, avatarUrl: users.avatarUrl }).from(users).where(inArray(users.id, sellerIds)),
  ]);
  const imagesByListing = new Map<string, typeof images>();
  for (const img of images) {
    const arr = imagesByListing.get(img.listingId) ?? [];
    arr.push(img);
    imagesByListing.set(img.listingId, arr);
  }
  const sellerById = new Map(sellers.map((s) => [s.id, s]));
  return rows.map((r) => ({
    ...r,
    images: (imagesByListing.get(r.id) ?? []).map((i) => i.url),
    seller: sellerById.get(r.sellerId) ?? null,
  }));
}

// ── Homepage / marketplace feed with search + multi-select filters ───────
router.get("/", async (req, res) => {
  const querySchema = z.object({
    q: z.string().optional(),
    franchise: z.string().optional(), // comma-separated: "pokemon,one_piece"
    condition: z.string().optional(), // comma-separated
    minPrice: z.coerce.number().optional(),
    maxPrice: z.coerce.number().optional(),
    sellerId: z.string().optional(),
    limit: z.coerce.number().min(1).max(100).default(50),
    offset: z.coerce.number().min(0).default(0),
  });
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: "Invalid query" });
  const { q, franchise, condition, minPrice, maxPrice, sellerId, limit, offset } = parsed.data;

  const conditions = [eq(listings.status, "active")];
  if (q) conditions.push(ilike(listings.title, `%${q}%`));
  if (sellerId) conditions.push(eq(listings.sellerId, sellerId));
  if (franchise) {
    const list = franchise.split(",").filter(Boolean);
    if (list.length > 0) {
      conditions.push(
        or(...list.map((f) => (f === "both" ? eq(listings.franchise, "both") : or(eq(listings.franchise, f), eq(listings.franchise, "both")))))!,
      );
    }
  }
  if (condition) {
    const list = condition.split(",").filter(Boolean);
    if (list.length > 0) conditions.push(inArray(listings.condition, list));
  }
  if (minPrice !== undefined) conditions.push(gte(listings.priceCents, Math.round(minPrice * 100)));
  if (maxPrice !== undefined) conditions.push(lte(listings.priceCents, Math.round(maxPrice * 100)));

  const rows = await db
    .select()
    .from(listings)
    .where(and(...conditions))
    .orderBy(desc(listings.createdAt))
    .limit(limit)
    .offset(offset);

  res.json(await attachImagesAndSellers(rows));
});

router.get("/conditions", (_req, res) => res.json(CONDITIONS));
router.get("/franchises", (_req, res) => res.json(FRANCHISES));

router.get("/:id", async (req, res) => {
  const [listing] = await db.select().from(listings).where(eq(listings.id, req.params.id));
  if (!listing) return res.status(404).json({ message: "Listing not found" });

  await db.update(listings).set({ viewCount: sql`${listings.viewCount} + 1` }).where(eq(listings.id, listing.id));

  const [withDetails] = await attachImagesAndSellers([listing]);
  res.json(withDetails);
});

// ── Create listing (multipart: fields + up to 6 images) ──────────────────
router.post("/", authenticateToken, upload.array("images", 6), async (req, res) => {
  if (req.user!.identityVerificationStatus !== "verified") {
    return res.status(403).json({ message: "Verify your identity before listing a card for sale." });
  }

  const bodySchema = z.object({
    title: z.string().min(3).max(120),
    description: z.string().max(2000).default(""),
    priceCents: z.coerce.number().int().min(50).max(100_000_00),
    condition: z.enum(CONDITIONS),
    quantityTotal: z.coerce.number().int().min(1).max(999).default(1),
  });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid listing" });
  const { title, description, priceCents, condition, quantityTotal } = parsed.data;

  const franchise = detectFranchise(title, description);
  if (!franchise) {
    return res.status(400).json({
      message: 'The title or description must mention "Pokémon" or "One Piece" so buyers can find it.',
    });
  }

  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) {
    return res.status(400).json({ message: "Add at least one photo of the card" });
  }

  const [listing] = await db
    .insert(listings)
    .values({
      sellerId: req.user!.id,
      title,
      description,
      franchise,
      priceCents,
      condition,
      quantityTotal,
      quantityAvailable: quantityTotal,
    })
    .returning();

  const urls = await Promise.all(files.map((f) => saveUploadedFile(f)));
  await db.insert(listingImages).values(
    urls.map((url, i) => ({
      listingId: listing.id,
      url,
      position: i,
    })),
  );

  // Notify anyone subscribed to "new card" alerts for this franchise.
  const franchisesToNotify = franchise === "both" ? ["pokemon", "one_piece"] : [franchise];
  const subscribers = await db
    .select({ userId: franchiseSubscriptions.userId })
    .from(franchiseSubscriptions)
    .where(and(inArray(franchiseSubscriptions.franchise, franchisesToNotify), sql`${franchiseSubscriptions.userId} != ${req.user!.id}`));
  if (subscribers.length > 0) {
    await notifyUsers(
      subscribers.map((s) => s.userId),
      { type: "new_listing_match", title: "New card matching your filters", body: `${title} just listed for $${(priceCents / 100).toFixed(2)}`, data: { listingId: listing.id } },
    );
  }

  const [withDetails] = await attachImagesAndSellers([listing]);
  res.status(201).json(withDetails);
});

router.patch("/:id", authenticateToken, async (req, res) => {
  const [listing] = await db.select().from(listings).where(eq(listings.id, req.params.id));
  if (!listing) return res.status(404).json({ message: "Listing not found" });
  if (listing.sellerId !== req.user!.id) return res.status(403).json({ message: "Not your listing" });

  const bodySchema = z.object({
    priceCents: z.coerce.number().int().min(50).optional(),
    description: z.string().max(2000).optional(),
    quantityAvailable: z.coerce.number().int().min(0).optional(),
    status: z.enum(["active", "sold_out", "removed"]).optional(),
  });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid update" });

  const [updated] = await db.update(listings).set({ ...parsed.data, updatedAt: new Date() }).where(eq(listings.id, listing.id)).returning();
  const [withDetails] = await attachImagesAndSellers([updated]);
  res.json(withDetails);
});

router.delete("/:id", authenticateToken, async (req, res) => {
  const [listing] = await db.select().from(listings).where(eq(listings.id, req.params.id));
  if (!listing) return res.status(404).json({ message: "Listing not found" });
  if (listing.sellerId !== req.user!.id) return res.status(403).json({ message: "Not your listing" });
  await db.update(listings).set({ status: "removed", updatedAt: new Date() }).where(eq(listings.id, listing.id));
  res.json({ status: "removed" });
});

// ── "New cards" alert subscriptions (multi-select franchise filters) ─────
router.get("/subscriptions/mine", authenticateToken, async (req, res) => {
  const rows = await db.select().from(franchiseSubscriptions).where(eq(franchiseSubscriptions.userId, req.user!.id));
  res.json(rows.map((r) => r.franchise));
});

router.put("/subscriptions/mine", authenticateToken, async (req, res) => {
  const schema = z.object({ franchises: z.array(z.enum(FRANCHISES)) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid request" });

  await db.delete(franchiseSubscriptions).where(eq(franchiseSubscriptions.userId, req.user!.id));
  if (parsed.data.franchises.length > 0) {
    await db.insert(franchiseSubscriptions).values(parsed.data.franchises.map((f) => ({ userId: req.user!.id, franchise: f })));
  }
  res.json({ franchises: parsed.data.franchises });
});

export default router;
