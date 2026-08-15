import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { users, listings, friendRequests, conversations, follows } from "@shared/schema";
import { and, desc, eq, ilike, ne, or, sql } from "drizzle-orm";
import { authenticateToken } from "../middleware/auth";
import { attachImagesAndSellers } from "./listings";
import { upload, saveUploadedFile, deleteUploadedFile } from "../lib/upload";
import { isActivePro } from "@shared/validation";

const router = Router();
router.use(authenticateToken);

const PUBLIC_USER_COLUMNS = {
  id: users.id,
  username: users.username,
  displayName: users.displayName,
  avatarUrl: users.avatarUrl,
  identityVerificationStatus: users.identityVerificationStatus,
  proStatus: users.proStatus,
  proCurrentPeriodEnd: users.proCurrentPeriodEnd,
};

const USERNAME_CHANGE_COOLDOWN_DAYS = 30;
const USERNAME_CHANGE_COOLDOWN_MS = USERNAME_CHANGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

// ── Change username — at most once every 30 days ──────────────────────────
router.patch("/me/username", async (req, res) => {
  const parsed = z
    .object({ username: z.string().min(3).max(24).regex(/^[a-zA-Z0-9_]+$/, "Letters, numbers, and underscores only") })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Enter a valid username" });

  const [me] = await db.select({ username: users.username, usernameChangedAt: users.usernameChangedAt }).from(users).where(eq(users.id, req.user!.id));
  if (!me) return res.status(404).json({ message: "User not found" });

  const nextUsername = parsed.data.username;
  if (nextUsername === me.username) return res.status(400).json({ message: "That's already your username" });

  if (me.usernameChangedAt) {
    const nextAllowedAt = me.usernameChangedAt.getTime() + USERNAME_CHANGE_COOLDOWN_MS;
    if (Date.now() < nextAllowedAt) {
      return res.status(429).json({ message: `You can change your username again on ${new Date(nextAllowedAt).toLocaleDateString()}`, nextAllowedAt: new Date(nextAllowedAt).toISOString() });
    }
  }

  const [usernameTaken] = await db.select({ id: users.id }).from(users).where(and(eq(users.username, nextUsername), ne(users.id, req.user!.id)));
  if (usernameTaken) return res.status(409).json({ message: "That username is already taken" });

  const [updated] = await db.update(users).set({ username: nextUsername, usernameChangedAt: new Date() }).where(eq(users.id, req.user!.id)).returning();
  res.json({ username: updated.username, usernameChangedAt: updated.usernameChangedAt });
});

// ── My own profile photo ──────────────────────────────────────────────────
// Uploaded avatars are persisted via saveUploadedFile — local disk or
// object storage depending on configuration (see lib/upload.ts). A
// Google-sourced avatarUrl is a full external URL; deleteUploadedFile is a
// no-op for those, so it's always safe to call regardless of where the
// previous photo (if any) actually came from.
router.post("/me/avatar", upload.single("avatar"), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: "No image uploaded" });

  const [previous] = await db.select({ avatarUrl: users.avatarUrl }).from(users).where(eq(users.id, req.user!.id));

  const avatarUrl = await saveUploadedFile(req.file);
  const [updated] = await db.update(users).set({ avatarUrl }).where(eq(users.id, req.user!.id)).returning();

  await deleteUploadedFile(previous?.avatarUrl);

  res.json({ avatarUrl: updated.avatarUrl });
});

router.delete("/me/avatar", async (req, res) => {
  const [previous] = await db.select({ avatarUrl: users.avatarUrl }).from(users).where(eq(users.id, req.user!.id));
  await db.update(users).set({ avatarUrl: null }).where(eq(users.id, req.user!.id));

  await deleteUploadedFile(previous?.avatarUrl);

  res.json({ avatarUrl: null });
});

// ── Search users by username or phone number, for starting a chat ────────
router.get("/search", async (req, res) => {
  const parsed = z.object({ q: z.string().min(1).max(60) }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: "Enter a username or phone number" });
  const q = parsed.data.q.trim();

  const digits = q.replace(/[^\d+]/g, "");
  const matchesPhoneOrUsername = digits.length >= 4 ? or(ilike(users.username, `%${q}%`), ilike(users.phoneNumber, `%${digits}%`)) : ilike(users.username, `%${q}%`);
  const qLower = q.toLowerCase();

  const rows = await db
    .select(PUBLIC_USER_COLUMNS)
    .from(users)
    .where(and(sql`${users.deletedAt} IS NULL`, ne(users.id, req.user!.id), matchesPhoneOrUsername))
    // Text relevance always wins first (does the username actually start
    // with what was typed) — Pro membership only nudges the order among
    // otherwise-equally-relevant matches, never buries a better match.
    .orderBy(
      sql`CASE WHEN LOWER(${users.username}) LIKE ${qLower + "%"} THEN 0 ELSE 1 END`,
      sql`CASE WHEN ${users.proStatus} = 'active' AND (${users.proCurrentPeriodEnd} IS NULL OR ${users.proCurrentPeriodEnd} > NOW()) THEN 0 ELSE 1 END`,
      users.username,
    )
    .limit(25);

  res.json(rows);
});

// ── Public profile: shown when viewing a user from a chat ────────────────
router.get("/:id/profile", async (req, res) => {
  const [target] = await db.select(PUBLIC_USER_COLUMNS).from(users).where(eq(users.id, req.params.id));
  if (!target) return res.status(404).json({ message: "User not found" });

  const meId = req.user!.id;
  const [userAId, userBId] = meId < target.id ? [meId, target.id] : [target.id, meId];

  const [listingRows, friendRow, convoRow, followRow, followerCountRow, followingCountRow] = await Promise.all([
    db.select().from(listings).where(and(eq(listings.sellerId, target.id), eq(listings.status, "active"))).orderBy(desc(listings.createdAt)).limit(20),
    db
      .select()
      .from(friendRequests)
      .where(or(and(eq(friendRequests.requesterId, meId), eq(friendRequests.recipientId, target.id)), and(eq(friendRequests.requesterId, target.id), eq(friendRequests.recipientId, meId)))),
    db.select({ id: conversations.id, status: conversations.status }).from(conversations).where(and(eq(conversations.userAId, userAId), eq(conversations.userBId, userBId))),
    db.select({ followerId: follows.followerId }).from(follows).where(and(eq(follows.followerId, meId), eq(follows.followingId, target.id))).limit(1),
    db.select({ count: sql<number>`count(*)::int` }).from(follows).where(eq(follows.followingId, target.id)),
    db.select({ count: sql<number>`count(*)::int` }).from(follows).where(eq(follows.followerId, target.id)),
  ]);

  const friendRequest = friendRow[0];
  let friendStatus: "none" | "friends" | "pending_sent" | "pending_received" = "none";
  if (friendRequest) {
    if (friendRequest.status === "accepted") friendStatus = "friends";
    else if (friendRequest.status === "pending") friendStatus = friendRequest.requesterId === meId ? "pending_sent" : "pending_received";
  }

  const showsListings = target.identityVerificationStatus === "verified" && listingRows.length > 0;
  const withDetails = showsListings ? await attachImagesAndSellers(listingRows) : [];

  res.json({
    ...target,
    isSubscriber: isActivePro(target),
    isFollowing: followRow.length > 0,
    followerCount: followerCountRow[0]?.count ?? 0,
    followingCount: followingCountRow[0]?.count ?? 0,
    friendStatus,
    friendRequestId: friendRequest?.status === "pending" ? friendRequest.id : null,
    conversation: convoRow[0] ?? null,
    listings: withDetails,
  });
});

export default router;
