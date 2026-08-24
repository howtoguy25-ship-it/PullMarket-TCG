// Card Hunt: a real-money, real-location geo-hunt game. The owner sells
// paid entries, hides 1 or 2 real physical cards ("targets"), then reveals
// real photos plus a radius circle per target around a real captured GPS
// location. Only one game is ever live at a time. A paid entrant's "I
// found it" claim only wins once the owner reviews and approves it
// (self-declared wins would be trivially game-able otherwise) — approving
// one awards real points (base + a speed bonus for a fast find) onto the
// user's lifetime points total.
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { huntGames, huntTargets, huntTargetImages, huntEntries, huntClaims, users, reports, HUNT_REACTION_MESSAGES } from "@shared/schema";
import { and, desc, eq, inArray, isNotNull, ilike, ne, sql } from "drizzle-orm";
import { authenticateToken, requireOwner } from "../middleware/auth";
import { upload, saveUploadedFile, deleteUploadedFile } from "../lib/upload";
import { getStripe, isStripeConfigured } from "../lib/stripeClient";
import { notifyUser, notifyUsers } from "../lib/notify";
import {
  HUNT_PRICE_TIERS_CENTS,
  HUNT_MAX_IMAGES,
  HUNT_MAX_CARDS,
  HUNT_LEADERBOARD_VISIBLE_MS,
  HUNT_DEFAULT_BASE_POINTS,
  HUNT_DEFAULT_SPEED_BONUS_THRESHOLD_MINUTES,
  HUNT_DEFAULT_SPEED_BONUS_POINTS,
  computeHuntPoints,
} from "@shared/validation";

const router = Router();

async function getTargetsWithImages(gameId: string) {
  const targets = await db.select().from(huntTargets).where(eq(huntTargets.gameId, gameId)).orderBy(huntTargets.index);
  const images = targets.length > 0 ? await db.select().from(huntTargetImages).where(inArray(huntTargetImages.targetId, targets.map((t) => t.id))).orderBy(huntTargetImages.position) : [];
  const imagesByTarget = new Map<string, string[]>();
  for (const img of images) {
    const arr = imagesByTarget.get(img.targetId) ?? [];
    arr.push(img.url);
    imagesByTarget.set(img.targetId, arr);
  }
  return targets.map((t) => ({ ...t, images: imagesByTarget.get(t.id) ?? [] }));
}

// A game is only "live" (blocking a new one from being scheduled) while
// it's still collecting entries or between reveal and every target having
// a winner — once ended, the owner can schedule the next one immediately.
async function getLiveGame() {
  const [game] = await db
    .select()
    .from(huntGames)
    .where(inArray(huntGames.status, ["entry_open", "revealed"]))
    .orderBy(desc(huntGames.createdAt))
    .limit(1);
  return game ?? null;
}

// ══════════════════════════════════════════════════════════════════════
// Owner routes
// ══════════════════════════════════════════════════════════════════════
const ownerRouter = Router();
ownerRouter.use(authenticateToken, requireOwner);

ownerRouter.post("/create", async (req, res) => {
  const schema = z.object({
    entryPriceCents: z.coerce.number().int().refine((v) => (HUNT_PRICE_TIERS_CENTS as readonly number[]).includes(v), "Pick a valid entry price tier"),
    countdownSeconds: z.coerce.number().int().min(10).max(7 * 24 * 60 * 60),
    cardCount: z.coerce.number().int().min(1).max(HUNT_MAX_CARDS).default(1),
    basePoints: z.coerce.number().int().min(1).max(10_000).default(HUNT_DEFAULT_BASE_POINTS),
    speedBonusThresholdMinutes: z.coerce.number().int().min(0).max(1440).default(HUNT_DEFAULT_SPEED_BONUS_THRESHOLD_MINUTES),
    speedBonusPoints: z.coerce.number().int().min(0).max(10_000).default(HUNT_DEFAULT_SPEED_BONUS_POINTS),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid game settings" });

  if (await getLiveGame()) return res.status(400).json({ message: "A hunt is already live — end it before starting a new one." });

  const [game] = await db
    .insert(huntGames)
    .values({
      entryPriceCents: parsed.data.entryPriceCents,
      cardCount: parsed.data.cardCount,
      basePoints: parsed.data.basePoints,
      speedBonusThresholdMinutes: parsed.data.speedBonusThresholdMinutes,
      speedBonusPoints: parsed.data.speedBonusPoints,
      countdownEndsAt: new Date(Date.now() + parsed.data.countdownSeconds * 1000),
    })
    .returning();

  await db.insert(huntTargets).values(Array.from({ length: parsed.data.cardCount }, (_, i) => ({ gameId: game.id, index: i })));

  res.status(201).json(game);
});

// Replaces one target's photo set wholesale — only allowed before reveal.
ownerRouter.post("/:gameId/targets/:targetIndex/images", upload.array("images", HUNT_MAX_IMAGES), async (req, res) => {
  const [game] = await db.select().from(huntGames).where(eq(huntGames.id, req.params.gameId));
  if (!game) return res.status(404).json({ message: "Hunt not found" });
  if (game.status !== "entry_open") return res.status(400).json({ message: "Photos can only be changed before the hunt is revealed." });

  const targetIndex = Number(req.params.targetIndex);
  const [target] = await db.select().from(huntTargets).where(and(eq(huntTargets.gameId, game.id), eq(huntTargets.index, targetIndex)));
  if (!target) return res.status(404).json({ message: "Card not found for this hunt" });

  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) return res.status(400).json({ message: "Add at least one photo" });

  const existing = await db.select().from(huntTargetImages).where(eq(huntTargetImages.targetId, target.id));
  await Promise.all(existing.map((img) => deleteUploadedFile(img.url)));
  await db.delete(huntTargetImages).where(eq(huntTargetImages.targetId, target.id));

  const urls = await Promise.all(files.map((f) => saveUploadedFile(f)));
  await db.insert(huntTargetImages).values(urls.map((url, i) => ({ targetId: target.id, url, position: i })));

  res.json({ images: urls });
});

ownerRouter.post("/:gameId/reveal", async (req, res) => {
  const [game] = await db.select().from(huntGames).where(eq(huntGames.id, req.params.gameId));
  if (!game) return res.status(404).json({ message: "Hunt not found" });
  if (game.status !== "entry_open") return res.status(400).json({ message: "This hunt has already been revealed." });

  const schema = z.object({
    targets: z
      .array(z.object({ index: z.number().int(), latitude: z.coerce.number().min(-90).max(90), longitude: z.coerce.number().min(-180).max(180), radiusMeters: z.coerce.number().int().min(10).max(50_000) }))
      .min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid location" });
  if (parsed.data.targets.length !== game.cardCount) return res.status(400).json({ message: `Set the location for all ${game.cardCount} card(s).` });

  const targets = await getTargetsWithImages(game.id);
  for (const t of targets) {
    if (t.images.length === 0) return res.status(400).json({ message: `Card ${t.index + 1} needs at least one photo before sending.` });
  }

  await Promise.all(
    parsed.data.targets.map((t) =>
      db.update(huntTargets).set({ latitude: t.latitude, longitude: t.longitude, radiusMeters: t.radiusMeters }).where(and(eq(huntTargets.gameId, game.id), eq(huntTargets.index, t.index))),
    ),
  );

  const [updated] = await db.update(huntGames).set({ status: "revealed", revealedAt: new Date() }).where(eq(huntGames.id, game.id)).returning();

  const entrants = await db.select({ userId: huntEntries.userId }).from(huntEntries).where(and(eq(huntEntries.gameId, game.id), isNotNull(huntEntries.paidAt)));
  if (entrants.length > 0) {
    await notifyUsers(
      entrants.map((e) => e.userId),
      { type: "hunt_revealed", title: "🗺️ The Card Hunt is live!", body: "The photos and search area just went live — go find it!", data: { gameId: game.id } },
    );
  }

  res.json(updated);
});

ownerRouter.get("/:gameId/entries", async (req, res) => {
  const rows = await db
    .select({ id: huntEntries.id, userId: huntEntries.userId, username: users.username, paidAt: huntEntries.paidAt })
    .from(huntEntries)
    .innerJoin(users, eq(users.id, huntEntries.userId))
    .where(and(eq(huntEntries.gameId, req.params.gameId), isNotNull(huntEntries.paidAt)))
    .orderBy(desc(huntEntries.paidAt));
  res.json(rows);
});

// All pending/approved/rejected claims across every target of this game,
// with the claimant's username — the owner's review queue.
ownerRouter.get("/:gameId/claims", async (req, res) => {
  const targets = await db.select().from(huntTargets).where(eq(huntTargets.gameId, req.params.gameId));
  if (targets.length === 0) return res.json([]);
  const rows = await db
    .select({
      id: huntClaims.id,
      targetId: huntClaims.targetId,
      userId: huntClaims.userId,
      username: users.username,
      imageUrl: huntClaims.imageUrl,
      status: huntClaims.status,
      claimedAt: huntClaims.claimedAt,
      pointsAwarded: huntClaims.pointsAwarded,
    })
    .from(huntClaims)
    .innerJoin(users, eq(users.id, huntClaims.userId))
    .where(inArray(huntClaims.targetId, targets.map((t) => t.id)))
    .orderBy(desc(huntClaims.claimedAt));
  const targetIndexById = new Map(targets.map((t) => [t.id, t.index]));
  res.json(rows.map((r) => ({ ...r, targetIndex: targetIndexById.get(r.targetId) })));
});

ownerRouter.post("/:gameId/claims/:claimId/approve", async (req, res) => {
  const [game] = await db.select().from(huntGames).where(eq(huntGames.id, req.params.gameId));
  if (!game) return res.status(404).json({ message: "Hunt not found" });
  if (game.status !== "revealed") return res.status(400).json({ message: "This hunt isn't open for claims right now." });

  const [claim] = await db.select().from(huntClaims).where(eq(huntClaims.id, req.params.claimId));
  if (!claim) return res.status(404).json({ message: "Claim not found" });
  if (claim.status !== "pending") return res.status(400).json({ message: "This claim has already been reviewed." });

  const [target] = await db.select().from(huntTargets).where(eq(huntTargets.id, claim.targetId));
  if (!target || target.gameId !== game.id) return res.status(404).json({ message: "Card not found for this hunt" });
  if (target.winnerUserId) return res.status(400).json({ message: "This card already has a winner." });

  const now = new Date();
  const points = computeHuntPoints(game.basePoints, game.speedBonusThresholdMinutes, game.speedBonusPoints, game.revealedAt ?? now, claim.claimedAt ?? now);

  await db.update(huntClaims).set({ status: "approved", reviewedAt: now, pointsAwarded: points }).where(eq(huntClaims.id, claim.id));
  await db.update(huntTargets).set({ winnerUserId: claim.userId, wonAt: now }).where(eq(huntTargets.id, target.id));
  await db.update(users).set({ points: sql`${users.points} + ${points}` }).where(eq(users.id, claim.userId));
  // Any other still-pending claims on this same card are moot now that it has a winner.
  await db.update(huntClaims).set({ status: "rejected", reviewedAt: now }).where(and(eq(huntClaims.targetId, target.id), eq(huntClaims.status, "pending")));

  const [winner] = await db.select({ username: users.username }).from(users).where(eq(users.id, claim.userId));
  await notifyUser(claim.userId, { type: "hunt_won", title: "🏆 You found it!", body: `+${points} points — congrats, you won Card ${target.index + 1}!`, data: { gameId: game.id } });

  const remainingTargets = await db.select().from(huntTargets).where(eq(huntTargets.gameId, game.id));
  const allWon = remainingTargets.every((t) => t.id === target.id || !!t.winnerUserId);

  if (allWon) {
    await db
      .update(huntGames)
      .set({ status: "ended", endedAt: now, leaderboardExpiresAt: new Date(now.getTime() + HUNT_LEADERBOARD_VISIBLE_MS) })
      .where(eq(huntGames.id, game.id));

    const otherEntrants = await db
      .select({ userId: huntEntries.userId })
      .from(huntEntries)
      .where(and(eq(huntEntries.gameId, game.id), ne(huntEntries.userId, claim.userId), isNotNull(huntEntries.paidAt)));
    if (otherEntrants.length > 0) {
      await notifyUsers(
        otherEntrants.map((e) => e.userId),
        { type: "hunt_ended", title: "Card Hunt over", body: `@${winner?.username ?? "someone"} found it! Send them a message on the leaderboard.`, data: { gameId: game.id } },
      );
    }
  }

  res.json({ approved: true, winnerUserId: claim.userId, pointsAwarded: points, gameEnded: allWon });
});

ownerRouter.post("/:gameId/claims/:claimId/reject", async (req, res) => {
  const [claim] = await db.select().from(huntClaims).where(eq(huntClaims.id, req.params.claimId));
  if (!claim) return res.status(404).json({ message: "Claim not found" });
  if (claim.status !== "pending") return res.status(400).json({ message: "This claim has already been reviewed." });

  await db.update(huntClaims).set({ status: "rejected", reviewedAt: new Date() }).where(eq(huntClaims.id, claim.id));
  await notifyUser(claim.userId, { type: "hunt_claim_rejected", title: "Not quite", body: "That claim didn't check out — keep looking and try again!", data: { gameId: req.params.gameId } });
  res.json({ rejected: true });
});

ownerRouter.post("/broadcast", async (req, res) => {
  const schema = z.object({ title: z.string().min(1).max(80), body: z.string().min(1).max(300) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid broadcast" });

  const allUsers = await db.select({ id: users.id }).from(users);
  await notifyUsers(
    allUsers.map((u) => u.id),
    { type: "owner_broadcast", title: parsed.data.title, body: parsed.data.body },
  );
  res.json({ sentTo: allUsers.length });
});

// Real, searchable candidate list for a targeted (not broadcast-to-all)
// notification — flags anyone who's never actually paid to enter a hunt,
// so the owner can spot who to nudge.
ownerRouter.get("/notify-candidates", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const rows = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(q ? ilike(users.username, `%${q}%`) : undefined)
    .orderBy(users.username)
    .limit(100);

  const paidUserIds = new Set((await db.selectDistinct({ userId: huntEntries.userId }).from(huntEntries).where(isNotNull(huntEntries.paidAt))).map((r) => r.userId));
  res.json(rows.map((r) => ({ id: r.id, username: r.username, hasPaidBefore: paidUserIds.has(r.id) })));
});

ownerRouter.post("/notify", async (req, res) => {
  const schema = z.object({ userIds: z.array(z.string()).min(1).max(500), title: z.string().min(1).max(80), body: z.string().min(1).max(300) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid notification" });

  await notifyUsers(parsed.data.userIds, { type: "owner_broadcast", title: parsed.data.title, body: parsed.data.body });
  res.json({ sentTo: parsed.data.userIds.length });
});

// ══════════════════════════════════════════════════════════════════════
// User routes
// ══════════════════════════════════════════════════════════════════════
router.use(authenticateToken);

router.get("/current", async (req, res) => {
  const [game] = await db.select().from(huntGames).orderBy(desc(huntGames.createdAt)).limit(1);
  if (!game) return res.json({ game: null });

  if (game.status === "ended" && (!game.leaderboardExpiresAt || game.leaderboardExpiresAt.getTime() < Date.now())) {
    return res.json({ game: null });
  }

  const [myEntry] = await db.select().from(huntEntries).where(and(eq(huntEntries.gameId, game.id), eq(huntEntries.userId, req.user!.id)));
  const hasPaidEntry = !!myEntry?.paidAt;
  // The owner manages their own hunt's photos/location/radius through this
  // same endpoint (OwnerHuntScreen), including while it's still entry_open
  // and nobody has paid yet — gating that data away from entrants until
  // reveal must never gate it away from the owner viewing their own game.
  const revealGated = req.user!.isOwner || (game.status !== "entry_open" && (hasPaidEntry || game.status === "ended"));

  const targetsRaw = revealGated ? await getTargetsWithImages(game.id) : [];
  const winnerIds = targetsRaw.filter((t) => t.winnerUserId).map((t) => t.winnerUserId!);
  const winnerUsernames = winnerIds.length > 0 ? await db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, winnerIds)) : [];
  const winnerNameById = new Map(winnerUsernames.map((w) => [w.id, w.username]));

  let myClaimsByTarget = new Map<string, string>();
  if (revealGated && targetsRaw.length > 0) {
    const myClaims = await db.select().from(huntClaims).where(and(eq(huntClaims.userId, req.user!.id), inArray(huntClaims.targetId, targetsRaw.map((t) => t.id))));
    myClaimsByTarget = new Map(myClaims.map((c) => [c.targetId, c.status]));
  }

  const targets = targetsRaw.map((t) => ({
    index: t.index,
    images: t.images,
    latitude: t.latitude,
    longitude: t.longitude,
    radiusMeters: t.radiusMeters,
    winnerUserId: t.winnerUserId,
    winnerUsername: t.winnerUserId ? (winnerNameById.get(t.winnerUserId) ?? null) : null,
    myClaimStatus: myClaimsByTarget.get(t.id) ?? null,
  }));

  let entries: { userId: string; username: string; reactionMessage: string | null }[] = [];
  if (game.status !== "entry_open") {
    const rows = await db
      .select({ userId: huntEntries.userId, username: users.username, paidAt: huntEntries.paidAt, reactionMessage: huntEntries.reactionMessage })
      .from(huntEntries)
      .innerJoin(users, eq(users.id, huntEntries.userId))
      .where(eq(huntEntries.gameId, game.id));
    entries = rows.filter((r) => r.paidAt !== null).map(({ paidAt, ...rest }) => rest);
  }

  res.json({
    game: {
      id: game.id,
      status: game.status,
      entryPriceCents: game.entryPriceCents,
      countdownEndsAt: game.countdownEndsAt,
      leaderboardExpiresAt: game.leaderboardExpiresAt,
      cardCount: game.cardCount,
      basePoints: game.basePoints,
      speedBonusThresholdMinutes: game.speedBonusThresholdMinutes,
      speedBonusPoints: game.speedBonusPoints,
      myEntry: myEntry ? { id: myEntry.id, paid: hasPaidEntry, reactionMessage: myEntry.reactionMessage } : null,
      targets,
      entries,
    },
  });
});

router.post("/:gameId/enter", async (req, res) => {
  if (!isStripeConfigured()) return res.status(503).json({ message: "Payments aren't configured yet." });

  const [game] = await db.select().from(huntGames).where(eq(huntGames.id, req.params.gameId));
  if (!game) return res.status(404).json({ message: "Hunt not found" });
  if (game.status !== "entry_open") return res.status(400).json({ message: "Entries are closed for this hunt." });

  const [existing] = await db.select().from(huntEntries).where(and(eq(huntEntries.gameId, game.id), eq(huntEntries.userId, req.user!.id)));
  if (existing?.paidAt) return res.status(400).json({ message: "You're already entered in this hunt." });

  const stripe = getStripe();
  const paymentIntent = await stripe.paymentIntents.create({
    amount: game.entryPriceCents,
    currency: "usd",
    payment_method_types: ["card"],
    receipt_email: req.user!.email ?? undefined,
    metadata: { kind: "hunt_entry", gameId: game.id, userId: req.user!.id },
  });

  if (existing) {
    await db.update(huntEntries).set({ stripePaymentIntentId: paymentIntent.id, priceCentsPaid: game.entryPriceCents }).where(eq(huntEntries.id, existing.id));
  } else {
    await db.insert(huntEntries).values({ gameId: game.id, userId: req.user!.id, priceCentsPaid: game.entryPriceCents, stripePaymentIntentId: paymentIntent.id });
  }

  res.json({ clientSecret: paymentIntent.client_secret });
});

router.post("/:gameId/session", async (req, res) => {
  if (!isStripeConfigured()) return res.status(503).json({ message: "Payments aren't configured yet." });
  const schema = z.object({ returnUrl: z.string().url() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid request" });

  const [game] = await db.select().from(huntGames).where(eq(huntGames.id, req.params.gameId));
  if (!game) return res.status(404).json({ message: "Hunt not found" });
  if (game.status !== "entry_open") return res.status(400).json({ message: "Entries are closed for this hunt." });

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [{ price_data: { currency: "usd", unit_amount: game.entryPriceCents, product_data: { name: "Card Hunt entry" } }, quantity: 1 }],
    success_url: `${parsed.data.returnUrl}?status=success`,
    cancel_url: `${parsed.data.returnUrl}?status=cancelled`,
    metadata: { kind: "hunt_entry", gameId: game.id, userId: req.user!.id },
  });

  const [existing] = await db.select().from(huntEntries).where(and(eq(huntEntries.gameId, game.id), eq(huntEntries.userId, req.user!.id)));
  if (existing) {
    await db.update(huntEntries).set({ stripePaymentIntentId: session.payment_intent as string | null, priceCentsPaid: game.entryPriceCents }).where(eq(huntEntries.id, existing.id));
  } else {
    await db.insert(huntEntries).values({ gameId: game.id, userId: req.user!.id, priceCentsPaid: game.entryPriceCents, stripePaymentIntentId: session.payment_intent as string | null });
  }

  res.json({ url: session.url });
});

router.post("/:gameId/targets/:targetIndex/claim", upload.single("image"), async (req, res) => {
  const [game] = await db.select().from(huntGames).where(eq(huntGames.id, req.params.gameId));
  if (!game) return res.status(404).json({ message: "Hunt not found" });
  if (game.status !== "revealed") return res.status(400).json({ message: "This hunt isn't accepting claims right now." });

  const targetIndex = Number(req.params.targetIndex);
  const [target] = await db.select().from(huntTargets).where(and(eq(huntTargets.gameId, game.id), eq(huntTargets.index, targetIndex)));
  if (!target) return res.status(404).json({ message: "Card not found for this hunt" });
  if (target.winnerUserId) return res.status(400).json({ message: "This card has already been found." });

  const [entry] = await db.select().from(huntEntries).where(and(eq(huntEntries.gameId, game.id), eq(huntEntries.userId, req.user!.id)));
  if (!entry?.paidAt) return res.status(403).json({ message: "You haven't entered this hunt." });

  const [existingClaim] = await db.select().from(huntClaims).where(and(eq(huntClaims.targetId, target.id), eq(huntClaims.userId, req.user!.id)));
  if (existingClaim && existingClaim.status !== "rejected") {
    return res.status(400).json({ message: "You already have a claim in for this card." });
  }

  const file = req.file as Express.Multer.File | undefined;
  if (!file) return res.status(400).json({ message: "Add a photo proving you found it" });
  const url = await saveUploadedFile(file);

  if (existingClaim) {
    await db.update(huntClaims).set({ status: "pending", imageUrl: url, claimedAt: new Date(), reviewedAt: null, pointsAwarded: null }).where(eq(huntClaims.id, existingClaim.id));
  } else {
    await db.insert(huntClaims).values({ targetId: target.id, userId: req.user!.id, imageUrl: url });
  }

  const owner = await db.select({ id: users.id }).from(users).where(eq(users.isOwner, true));
  if (owner.length > 0) {
    await notifyUsers(
      owner.map((o) => o.id),
      { type: "hunt_claim_submitted", title: "🔍 New claim!", body: `@${req.user!.username} says they found Card ${targetIndex + 1} — review their photo.`, data: { gameId: game.id } },
    );
  }

  res.json({ claimed: true });
});

router.post("/:gameId/react", async (req, res) => {
  const schema = z.object({ message: z.enum(HUNT_REACTION_MESSAGES) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid reaction" });

  const [game] = await db.select().from(huntGames).where(eq(huntGames.id, req.params.gameId));
  if (!game) return res.status(404).json({ message: "Hunt not found" });
  if (game.status !== "ended" || !game.leaderboardExpiresAt || game.leaderboardExpiresAt.getTime() < Date.now()) {
    return res.status(400).json({ message: "This hunt's leaderboard is no longer open." });
  }

  const targets = await db.select().from(huntTargets).where(eq(huntTargets.gameId, game.id));
  if (targets.some((t) => t.winnerUserId === req.user!.id)) return res.status(400).json({ message: "You won — no need to react!" });

  const [entry] = await db.select().from(huntEntries).where(and(eq(huntEntries.gameId, game.id), eq(huntEntries.userId, req.user!.id)));
  if (!entry?.paidAt) return res.status(403).json({ message: "You haven't entered this hunt." });
  if (entry.reactionMessage) return res.status(400).json({ message: "You already sent a reaction for this hunt." });

  await db.update(huntEntries).set({ reactionMessage: parsed.data.message, reactionSentAt: new Date() }).where(eq(huntEntries.id, entry.id));

  const winnerIds = Array.from(new Set(targets.filter((t) => t.winnerUserId).map((t) => t.winnerUserId!)));
  await Promise.all(winnerIds.map((id) => notifyUser(id, { type: "hunt_reaction", title: "New message on your win 🏆", body: `@${req.user!.username} sent you a message.`, data: { gameId: game.id } })));

  res.json({ sent: true });
});

// Log that an entrant screenshotted the reveal map — Android genuinely
// blocks the screenshot itself (see HuntMap's usePreventScreenCapture,
// FLAG_SECURE), but iOS gives no API to block or blank a screenshot after
// it's taken, so on iOS the client detects it via the OS's
// screenshot-taken notification and reports it here, same pattern as
// buyer shipping-info protection (routes/orders.ts). Surfaces straight
// into the existing owner Reports inbox — real anti-cheat here means the
// owner seeing who to disqualify, not a cosmetic effect on an image that
// already exists in that user's photo library.
router.post("/:gameId/screenshot-detected", async (req, res) => {
  const [game] = await db.select().from(huntGames).where(eq(huntGames.id, req.params.gameId));
  if (!game) return res.status(404).json({ message: "Hunt not found" });

  const [entry] = await db.select().from(huntEntries).where(and(eq(huntEntries.gameId, game.id), eq(huntEntries.userId, req.user!.id)));
  if (!entry?.paidAt) return res.status(403).json({ message: "You haven't entered this hunt." });

  await db.insert(reports).values({
    reporterId: null,
    source: "system",
    reportedUserId: req.user!.id,
    reason: "screenshot_detected",
    description: `@${req.user!.username} took a screenshot of the Card Hunt reveal map (game ${game.id.slice(0, 8).toUpperCase()}) — possible attempt to share the hidden location with someone who hasn't paid to enter.`,
    aiReasoning: "Detected via the OS screenshot-taken notification while the hunt map was on screen. This is detection, not prevention — iOS provides no API to block screenshots outright.",
  });

  res.status(201).json({ logged: true });
});

// A user's real, public Card Hunt profile — reachable by tapping their name
// on the leaderboard: lifetime points plus every card they've actually won.
router.get("/users/:userId/stats", async (req, res) => {
  const [profile] = await db.select({ id: users.id, username: users.username, points: users.points }).from(users).where(eq(users.id, req.params.userId));
  if (!profile) return res.status(404).json({ message: "User not found" });

  const wins = await db
    .select({ gameId: huntTargets.gameId, targetIndex: huntTargets.index, wonAt: huntTargets.wonAt })
    .from(huntTargets)
    .where(eq(huntTargets.winnerUserId, req.params.userId))
    .orderBy(desc(huntTargets.wonAt));

  res.json({ username: profile.username, points: profile.points, wins });
});

router.use("/owner", ownerRouter);

export default router;
