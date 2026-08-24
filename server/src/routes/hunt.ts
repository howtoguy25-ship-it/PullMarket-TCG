// Card Hunt: a real-money, real-location geo-hunt game. The owner sells
// paid entries, hides a real physical card, then reveals real photos plus
// a radius circle around their real captured GPS location. Only one game
// is ever live at a time; a paid entrant's "I found it" claim only wins
// once the owner reviews and approves it (self-declared wins would be
// trivially game-able otherwise).
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { huntGames, huntGameImages, huntEntries, users, HUNT_REACTION_MESSAGES } from "@shared/schema";
import { and, desc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { authenticateToken, requireOwner } from "../middleware/auth";
import { upload, saveUploadedFile, deleteUploadedFile } from "../lib/upload";
import { getStripe, isStripeConfigured } from "../lib/stripeClient";
import { notifyUser, notifyUsers } from "../lib/notify";
import { HUNT_ENTRY_PRICE_MIN_CENTS, HUNT_ENTRY_PRICE_MAX_CENTS, HUNT_MAX_IMAGES, HUNT_LEADERBOARD_VISIBLE_MS } from "@shared/validation";

const router = Router();

async function attachImages(game: typeof huntGames.$inferSelect) {
  const images = await db.select().from(huntGameImages).where(eq(huntGameImages.gameId, game.id)).orderBy(huntGameImages.position);
  return images.map((i) => i.url);
}

// A game is only "live" (blocking a new one from being scheduled) while
// it's still collecting entries or between reveal and a winner being
// approved — once ended, the owner can schedule the next one immediately,
// independent of whether the 15-minute leaderboard window has expired yet.
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
    entryPriceCents: z.coerce.number().int().min(HUNT_ENTRY_PRICE_MIN_CENTS).max(HUNT_ENTRY_PRICE_MAX_CENTS),
    countdownMinutes: z.coerce.number().int().min(1).max(7 * 24 * 60),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid game settings" });

  if (await getLiveGame()) return res.status(400).json({ message: "A hunt is already live — end it before starting a new one." });

  const [game] = await db
    .insert(huntGames)
    .values({
      entryPriceCents: parsed.data.entryPriceCents,
      countdownEndsAt: new Date(Date.now() + parsed.data.countdownMinutes * 60 * 1000),
    })
    .returning();

  res.status(201).json(game);
});

// Replaces the game's photo set wholesale (simplest correct behavior for a
// max-3 preview-before-send flow) — only allowed before reveal.
ownerRouter.post("/:gameId/images", upload.array("images", HUNT_MAX_IMAGES), async (req, res) => {
  const [game] = await db.select().from(huntGames).where(eq(huntGames.id, req.params.gameId));
  if (!game) return res.status(404).json({ message: "Hunt not found" });
  if (game.status !== "entry_open") return res.status(400).json({ message: "Photos can only be changed before the hunt is revealed." });

  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) return res.status(400).json({ message: "Add at least one photo" });

  const existing = await db.select().from(huntGameImages).where(eq(huntGameImages.gameId, game.id));
  await Promise.all(existing.map((img) => deleteUploadedFile(img.url)));
  await db.delete(huntGameImages).where(eq(huntGameImages.gameId, game.id));

  const urls = await Promise.all(files.map((f) => saveUploadedFile(f)));
  await db.insert(huntGameImages).values(urls.map((url, i) => ({ gameId: game.id, url, position: i })));

  res.json({ images: urls });
});

ownerRouter.post("/:gameId/reveal", async (req, res) => {
  const [game] = await db.select().from(huntGames).where(eq(huntGames.id, req.params.gameId));
  if (!game) return res.status(404).json({ message: "Hunt not found" });
  if (game.status !== "entry_open") return res.status(400).json({ message: "This hunt has already been revealed." });

  const schema = z.object({
    latitude: z.coerce.number().min(-90).max(90),
    longitude: z.coerce.number().min(-180).max(180),
    radiusMeters: z.coerce.number().int().min(10).max(50_000),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid location" });

  const imageCount = (await db.select().from(huntGameImages).where(eq(huntGameImages.gameId, game.id))).length;
  if (imageCount === 0) return res.status(400).json({ message: "Add at least one photo before sending the reveal." });

  const [updated] = await db
    .update(huntGames)
    .set({ status: "revealed", revealedAt: new Date(), latitude: parsed.data.latitude, longitude: parsed.data.longitude, radiusMeters: parsed.data.radiusMeters })
    .where(eq(huntGames.id, game.id))
    .returning();

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
    .select({
      id: huntEntries.id,
      userId: huntEntries.userId,
      username: users.username,
      paidAt: huntEntries.paidAt,
      claimStatus: huntEntries.claimStatus,
      claimImageUrl: huntEntries.claimImageUrl,
      claimedAt: huntEntries.claimedAt,
    })
    .from(huntEntries)
    .innerJoin(users, eq(users.id, huntEntries.userId))
    .where(eq(huntEntries.gameId, req.params.gameId))
    .orderBy(desc(huntEntries.paidAt));
  res.json(rows.filter((r) => r.paidAt !== null));
});

ownerRouter.post("/:gameId/entries/:entryId/approve", async (req, res) => {
  const [game] = await db.select().from(huntGames).where(eq(huntGames.id, req.params.gameId));
  if (!game) return res.status(404).json({ message: "Hunt not found" });
  if (game.status !== "revealed") return res.status(400).json({ message: "This hunt isn't open for claims right now." });

  const [entry] = await db.select().from(huntEntries).where(and(eq(huntEntries.id, req.params.entryId), eq(huntEntries.gameId, game.id)));
  if (!entry) return res.status(404).json({ message: "Entry not found" });
  if (entry.claimStatus !== "pending") return res.status(400).json({ message: "This entry has no pending claim to approve." });

  const now = new Date();
  await db.update(huntEntries).set({ claimStatus: "approved" }).where(eq(huntEntries.id, entry.id));
  await db
    .update(huntGames)
    .set({ status: "ended", winnerUserId: entry.userId, endedAt: now, leaderboardExpiresAt: new Date(now.getTime() + HUNT_LEADERBOARD_VISIBLE_MS) })
    .where(eq(huntGames.id, game.id));

  const [winner] = await db.select({ username: users.username }).from(users).where(eq(users.id, entry.userId));
  const otherEntrants = await db
    .select({ userId: huntEntries.userId })
    .from(huntEntries)
    .where(and(eq(huntEntries.gameId, game.id), ne(huntEntries.userId, entry.userId), isNotNull(huntEntries.paidAt)));

  await notifyUser(entry.userId, { type: "hunt_won", title: "🏆 You found it!", body: "Congrats — you won the Card Hunt!", data: { gameId: game.id } });
  if (otherEntrants.length > 0) {
    await notifyUsers(
      otherEntrants.map((e) => e.userId),
      { type: "hunt_ended", title: "Card Hunt over", body: `@${winner?.username ?? "someone"} found it! Send them a message on the leaderboard.`, data: { gameId: game.id } },
    );
  }

  res.json({ ended: true, winnerUserId: entry.userId });
});

ownerRouter.post("/:gameId/entries/:entryId/reject", async (req, res) => {
  const [entry] = await db.select().from(huntEntries).where(and(eq(huntEntries.id, req.params.entryId), eq(huntEntries.gameId, req.params.gameId)));
  if (!entry) return res.status(404).json({ message: "Entry not found" });
  if (entry.claimStatus !== "pending") return res.status(400).json({ message: "This entry has no pending claim to reject." });

  await db.update(huntEntries).set({ claimStatus: "rejected" }).where(eq(huntEntries.id, entry.id));
  await notifyUser(entry.userId, { type: "hunt_claim_rejected", title: "Not quite", body: "That claim didn't check out — keep looking and try again!", data: { gameId: req.params.gameId } });
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

  const base = {
    id: game.id,
    status: game.status,
    entryPriceCents: game.entryPriceCents,
    countdownEndsAt: game.countdownEndsAt,
    myEntry: myEntry
      ? { id: myEntry.id, paid: hasPaidEntry, claimStatus: myEntry.claimStatus, reactionMessage: myEntry.reactionMessage }
      : null,
  };

  // Photos and the map are the paid product — only a paying entrant (or
  // the game being fully ended, when it's just historical record) sees
  // them; someone who hasn't paid only sees the price/countdown/leaderboard
  // shape, enough to decide whether to enter.
  const revealGated = game.status !== "entry_open" && (hasPaidEntry || game.status === "ended");

  let entries: { userId: string; username: string; claimStatus: string; reactionMessage: string | null }[] = [];
  if (game.status !== "entry_open") {
    const rows = await db
      .select({ userId: huntEntries.userId, username: users.username, paidAt: huntEntries.paidAt, claimStatus: huntEntries.claimStatus, reactionMessage: huntEntries.reactionMessage })
      .from(huntEntries)
      .innerJoin(users, eq(users.id, huntEntries.userId))
      .where(eq(huntEntries.gameId, game.id));
    entries = rows.filter((r) => r.paidAt !== null).map(({ paidAt, ...rest }) => rest);
  }

  res.json({
    game: {
      ...base,
      images: revealGated ? await attachImages(game) : [],
      latitude: revealGated ? game.latitude : null,
      longitude: revealGated ? game.longitude : null,
      radiusMeters: revealGated ? game.radiusMeters : null,
      winnerUsername: game.winnerUserId ? entries.find((e) => e.userId === game.winnerUserId)?.username ?? null : null,
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
    // Straight platform revenue, no Connect destination — the owner IS the
    // platform here, there's no separate seller to pay out.
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

// Web fallback — @stripe/stripe-react-native has no web build, so the web
// client redirects through Stripe's own hosted Checkout page instead, same
// split as the marketplace's own checkout (see routes/checkout.ts).
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

router.post("/:gameId/claim", upload.single("image"), async (req, res) => {
  const [game] = await db.select().from(huntGames).where(eq(huntGames.id, req.params.gameId));
  if (!game) return res.status(404).json({ message: "Hunt not found" });
  if (game.status !== "revealed") return res.status(400).json({ message: "This hunt isn't accepting claims right now." });

  const [entry] = await db.select().from(huntEntries).where(and(eq(huntEntries.gameId, game.id), eq(huntEntries.userId, req.user!.id)));
  if (!entry?.paidAt) return res.status(403).json({ message: "You haven't entered this hunt." });
  if (entry.claimStatus === "pending" || entry.claimStatus === "approved") {
    return res.status(400).json({ message: "You already have a claim in for this hunt." });
  }

  const file = req.file as Express.Multer.File | undefined;
  if (!file) return res.status(400).json({ message: "Add a photo proving you found it" });
  const url = await saveUploadedFile(file);

  await db.update(huntEntries).set({ claimStatus: "pending", claimImageUrl: url, claimedAt: new Date() }).where(eq(huntEntries.id, entry.id));

  const owner = await db.select({ id: users.id }).from(users).where(eq(users.isOwner, true));
  if (owner.length > 0) {
    await notifyUsers(
      owner.map((o) => o.id),
      { type: "hunt_claim_submitted", title: "🔍 New claim!", body: `@${req.user!.username} says they found it — review their photo.`, data: { gameId: game.id, entryId: entry.id } },
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
  if (game.winnerUserId === req.user!.id) return res.status(400).json({ message: "You won — no need to react!" });

  const [entry] = await db.select().from(huntEntries).where(and(eq(huntEntries.gameId, game.id), eq(huntEntries.userId, req.user!.id)));
  if (!entry?.paidAt) return res.status(403).json({ message: "You haven't entered this hunt." });
  if (entry.reactionMessage) return res.status(400).json({ message: "You already sent a reaction for this hunt." });

  await db.update(huntEntries).set({ reactionMessage: parsed.data.message, reactionSentAt: new Date() }).where(eq(huntEntries.id, entry.id));

  if (game.winnerUserId) {
    await notifyUser(game.winnerUserId, { type: "hunt_reaction", title: "New message on your win 🏆", body: `@${req.user!.username} sent you a message.`, data: { gameId: game.id } });
  }

  res.json({ sent: true });
});

router.use("/owner", ownerRouter);

export default router;
