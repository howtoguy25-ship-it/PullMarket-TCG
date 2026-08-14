import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { listings, listingImages, users, favorites, franchiseSubscriptions, follows } from "@shared/schema";
import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { authenticateToken, optionalAuth } from "../middleware/auth";
import { upload, saveUploadedFile } from "../lib/upload";
import { CONDITIONS, FRANCHISES } from "@shared/schema";
import { detectFranchise, isActivePro, PRO_LISTING_BOOST_HOURS, LISTING_REVISION_LIMIT } from "@shared/validation";
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
    db.select({ id: users.id, username: users.username, avatarUrl: users.avatarUrl, proStatus: users.proStatus, proCurrentPeriodEnd: users.proCurrentPeriodEnd }).from(users).where(inArray(users.id, sellerIds)),
  ]);
  const imagesByListing = new Map<string, typeof images>();
  for (const img of images) {
    const arr = imagesByListing.get(img.listingId) ?? [];
    arr.push(img);
    imagesByListing.set(img.listingId, arr);
  }
  const sellerById = new Map(sellers.map((s) => [s.id, s]));
  const now = Date.now();
  return rows.map((r) => ({
    ...r,
    images: (imagesByListing.get(r.id) ?? []).map((i) => i.url),
    seller: sellerById.get(r.sellerId) ?? null,
    // Computed server-side (not just exposing the raw boostedUntil) so
    // clients never need their own clock-comparison logic to know whether
    // a listing is currently boosted.
    isBoosted: !!r.boostedUntil && new Date(r.boostedUntil).getTime() > now,
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

  // Two independent Pro perks layered into the sort, both live-evaluated
  // (never baked in at write time so they self-correct as boosts/
  // memberships expire):
  //  1. boostedUntil — a fixed 48h freshness window from when a Pro
  //     member's listing went up (set once at creation, see POST /).
  //  2. Search recognition — while actively typing a query, a listing
  //     from a *currently* active Pro member gets a small nudge among
  //     otherwise-equally-relevant matches. Text relevance (does the
  //     title actually start with what was typed) always wins first, so
  //     this never buries a better textual match — it only breaks ties.
  const qLower = q?.trim().toLowerCase();
  const orderByClauses = [
    ...(qLower ? [sql`CASE WHEN LOWER(${listings.title}) LIKE ${qLower + "%"} THEN 0 ELSE 1 END`] : []),
    sql`CASE WHEN ${listings.boostedUntil} IS NOT NULL AND ${listings.boostedUntil} > NOW() THEN 0 ELSE 1 END`,
    ...(qLower
      ? [
          sql`CASE WHEN EXISTS (SELECT 1 FROM ${users} WHERE ${users.id} = ${listings.sellerId} AND ${users.proStatus} = 'active' AND (${users.proCurrentPeriodEnd} IS NULL OR ${users.proCurrentPeriodEnd} > NOW())) THEN 0 ELSE 1 END`,
        ]
      : []),
    desc(listings.createdAt),
  ];

  const rows = await db
    .select()
    .from(listings)
    .where(and(...conditions))
    .orderBy(...orderByClauses)
    .limit(limit)
    .offset(offset);

  res.json(await attachImagesAndSellers(rows));
});

router.get("/conditions", (_req, res) => res.json(CONDITIONS));
router.get("/franchises", (_req, res) => res.json(FRANCHISES));

// ── A seller's own listings, every status included (used by the "My
// Listings" tab) ──────────────────────────────────────────────────────────
router.get("/mine", authenticateToken, async (req, res) => {
  const rows = await db
    .select()
    .from(listings)
    .where(and(eq(listings.sellerId, req.user!.id), sql`${listings.status} != 'deleted'`))
    .orderBy(desc(listings.createdAt));
  res.json(await attachImagesAndSellers(rows));
});

router.get("/:id", optionalAuth, async (req, res) => {
  const [listing] = await db.select().from(listings).where(eq(listings.id, req.params.id));
  if (!listing) return res.status(404).json({ message: "Listing not found" });

  // Unlisted/deleted listings are only visible to their own seller — hidden
  // from everyone else, not just the marketplace feed.
  const isOwner = req.user?.id === listing.sellerId;
  if ((listing.status === "unlisted" || listing.status === "deleted") && !isOwner) {
    return res.status(404).json({ message: "Listing not found" });
  }

  if (listing.status === "active") {
    await db.update(listings).set({ viewCount: sql`${listings.viewCount} + 1` }).where(eq(listings.id, listing.id));
  }

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
      // Pro-membership perk: a fixed one-time 48h head-start on the
      // homepage feed, starting now. Only granted if the seller was an
      // active Pro member at the moment they published — see isActivePro.
      boostedUntil: isActivePro(req.user!) ? new Date(Date.now() + PRO_LISTING_BOOST_HOURS * 60 * 60 * 1000) : null,
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

  // Notify this seller's followers too — a distinct notification from the
  // franchise-alert one above, so someone following a specific seller hears
  // about their new listing even if they're not subscribed to that franchise.
  const followerRows = await db.select({ userId: follows.followerId }).from(follows).where(eq(follows.followingId, req.user!.id));
  const notifiedAlready = new Set(subscribers.map((s) => s.userId));
  const followerIds = followerRows.map((f) => f.userId).filter((id) => !notifiedAlready.has(id));
  if (followerIds.length > 0) {
    await notifyUsers(followerIds, {
      type: "seller_new_listing",
      title: `@${req.user!.username} listed an item`,
      body: `You might wanna check this out: "${title}" for $${(priceCents / 100).toFixed(2)}`,
      data: { listingId: listing.id },
    });
  }

  const [withDetails] = await attachImagesAndSellers([listing]);
  res.status(201).json(withDetails);
});

// Fields that constitute a genuine "re-edit" of the listing's details, as
// opposed to bookkeeping (status flips handled by their own routes below).
const EDITABLE_FIELDS = ["title", "description", "priceCents", "condition", "quantityTotal"] as const;

router.patch("/:id", authenticateToken, async (req, res) => {
  const [listing] = await db.select().from(listings).where(eq(listings.id, req.params.id));
  if (!listing) return res.status(404).json({ message: "Listing not found" });
  if (listing.sellerId !== req.user!.id) return res.status(403).json({ message: "Not your listing" });
  if (listing.status === "removed" || listing.status === "deleted") {
    return res.status(400).json({ message: "This listing can no longer be changed." });
  }

  const bodySchema = z.object({
    title: z.string().min(3).max(120).optional(),
    priceCents: z.coerce.number().int().min(50).optional(),
    description: z.string().max(2000).optional(),
    condition: z.enum(CONDITIONS).optional(),
    quantityTotal: z.coerce.number().int().min(1).max(999).optional(),
    quantityAvailable: z.coerce.number().int().min(0).optional(),
    status: z.enum(["active", "sold_out"]).optional(),
  });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid update" });

  const isRealEdit = EDITABLE_FIELDS.some((f) => parsed.data[f] !== undefined && parsed.data[f] !== (listing as any)[f]);
  if (isRealEdit) {
    if (listing.revisionCount >= LISTING_REVISION_LIMIT) {
      return res.status(403).json({ message: `You've used your ${LISTING_REVISION_LIMIT} edits for this listing. Create a new listing instead.` });
    }
    if (parsed.data.title) {
      const franchise = detectFranchise(parsed.data.title, parsed.data.description ?? listing.description);
      if (!franchise) return res.status(400).json({ message: 'The title or description must mention "Pokémon" or "One Piece" so buyers can find it.' });
    }
  }

  const updates: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
  if (parsed.data.quantityTotal !== undefined && parsed.data.quantityAvailable === undefined) {
    // Bumping the total without an explicit available count keeps the same
    // available count, capped so it can never exceed the new total.
    updates.quantityAvailable = Math.min(listing.quantityAvailable, parsed.data.quantityTotal);
  }
  if (isRealEdit) updates.revisionCount = listing.revisionCount + 1;

  const [updated] = await db.update(listings).set(updates).where(eq(listings.id, listing.id)).returning();
  const [withDetails] = await attachImagesAndSellers([updated]);
  res.json(withDetails);
});

// ── Unlist: pull an active listing off the marketplace without deleting it,
// so the seller can relist it later. Counts against the revision limit. ───
router.post("/:id/unlist", authenticateToken, async (req, res) => {
  const [listing] = await db.select().from(listings).where(eq(listings.id, req.params.id));
  if (!listing) return res.status(404).json({ message: "Listing not found" });
  if (listing.sellerId !== req.user!.id) return res.status(403).json({ message: "Not your listing" });
  if (listing.status !== "active" && listing.status !== "sold_out") {
    return res.status(400).json({ message: "This listing isn't active." });
  }
  if (listing.revisionCount >= LISTING_REVISION_LIMIT) {
    return res.status(403).json({ message: `You've used your ${LISTING_REVISION_LIMIT} unlists/edits for this listing. Create a new listing instead.` });
  }

  const [updated] = await db
    .update(listings)
    .set({ status: "unlisted", revisionCount: listing.revisionCount + 1, updatedAt: new Date() })
    .where(eq(listings.id, listing.id))
    .returning();
  const [withDetails] = await attachImagesAndSellers([updated]);
  res.json(withDetails);
});

// ── Relist: bring an unlisted listing back to the marketplace. Free — it's
// undoing an unlist, not spending a new revision. ─────────────────────────
router.post("/:id/relist", authenticateToken, async (req, res) => {
  const [listing] = await db.select().from(listings).where(eq(listings.id, req.params.id));
  if (!listing) return res.status(404).json({ message: "Listing not found" });
  if (listing.sellerId !== req.user!.id) return res.status(403).json({ message: "Not your listing" });
  if (listing.status !== "unlisted") return res.status(400).json({ message: "This listing isn't unlisted." });

  const stillSoldOut = listing.quantityAvailable <= 0;
  const [updated] = await db
    .update(listings)
    .set({ status: stillSoldOut ? "sold_out" : "active", soldOutAt: stillSoldOut ? new Date() : null, updatedAt: new Date() })
    .where(eq(listings.id, listing.id))
    .returning();
  const [withDetails] = await attachImagesAndSellers([updated]);
  res.json(withDetails);
});

// ── Live stock update: the one thing a seller can change any number of
// times, no revision cap. Keeps buyers seeing accurate availability without
// forcing a seller to "spend" one of their limited edits just to restock or
// correct a count. ──────────────────────────────────────────────────────
router.patch("/:id/stock", authenticateToken, async (req, res) => {
  const [listing] = await db.select().from(listings).where(eq(listings.id, req.params.id));
  if (!listing) return res.status(404).json({ message: "Listing not found" });
  if (listing.sellerId !== req.user!.id) return res.status(403).json({ message: "Not your listing" });
  if (listing.status !== "active" && listing.status !== "sold_out") {
    return res.status(400).json({ message: "This listing isn't active." });
  }

  const schema = z.object({ quantityAvailable: z.coerce.number().int().min(0).max(999) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid quantity" });
  const { quantityAvailable } = parsed.data;

  const wasSoldOut = listing.status === "sold_out";
  const isNowSoldOut = quantityAvailable <= 0;

  const [updated] = await db
    .update(listings)
    .set({
      quantityAvailable,
      quantityTotal: Math.max(listing.quantityTotal, quantityAvailable),
      status: isNowSoldOut ? "sold_out" : "active",
      soldOutAt: isNowSoldOut ? (wasSoldOut ? listing.soldOutAt : new Date()) : null,
      updatedAt: new Date(),
    })
    .where(eq(listings.id, listing.id))
    .returning();
  const [withDetails] = await attachImagesAndSellers([updated]);
  res.json(withDetails);
});

router.delete("/:id", authenticateToken, async (req, res) => {
  const [listing] = await db.select().from(listings).where(eq(listings.id, req.params.id));
  if (!listing) return res.status(404).json({ message: "Listing not found" });
  if (listing.sellerId !== req.user!.id) return res.status(403).json({ message: "Not your listing" });
  await db.update(listings).set({ status: "deleted", updatedAt: new Date() }).where(eq(listings.id, listing.id));
  res.json({ status: "deleted" });
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
