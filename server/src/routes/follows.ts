import { Router } from "express";
import { db } from "../db";
import { follows, friendRequests, users } from "@shared/schema";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { authenticateToken } from "../middleware/auth";
import { isActivePro } from "@shared/validation";
import { notifyUser } from "../lib/notify";

const router = Router();
router.use(authenticateToken);

const PUBLIC_USER_COLUMNS = { id: users.id, username: users.username, displayName: users.displayName, avatarUrl: users.avatarUrl, proStatus: users.proStatus, proCurrentPeriodEnd: users.proCurrentPeriodEnd };

// ── Follow / unfollow — only an active Pro member can BE followed ────────
router.post("/:userId", async (req, res) => {
  const meId = req.user!.id;
  const targetId = req.params.userId;
  if (targetId === meId) return res.status(400).json({ message: "You can't follow yourself" });

  const [target] = await db.select().from(users).where(eq(users.id, targetId));
  if (!target) return res.status(404).json({ message: "User not found" });
  if (!isActivePro(target)) return res.status(400).json({ message: "Only active Pro members can be followed" });

  await db.insert(follows).values({ followerId: meId, followingId: targetId }).onConflictDoNothing();
  await notifyUser(targetId, { type: "new_follower", title: "New follower", body: `@${req.user!.username} started following you`, data: { userId: meId } });
  res.status(201).json({ status: "ok" });
});

router.delete("/:userId", async (req, res) => {
  const meId = req.user!.id;
  await db.delete(follows).where(and(eq(follows.followerId, meId), eq(follows.followingId, req.params.userId)));
  res.json({ status: "ok" });
});

// ── Whether I follow :userId, plus their follower/following counts ───────
router.get("/:userId/status", async (req, res) => {
  const meId = req.user!.id;
  const targetId = req.params.userId;

  const [[followRow], [followerCount], [followingCount]] = await Promise.all([
    db.select({ followerId: follows.followerId }).from(follows).where(and(eq(follows.followerId, meId), eq(follows.followingId, targetId))).limit(1),
    db.select({ count: sql<number>`count(*)::int` }).from(follows).where(eq(follows.followingId, targetId)),
    db.select({ count: sql<number>`count(*)::int` }).from(follows).where(eq(follows.followerId, targetId)),
  ]);

  res.json({ isFollowing: !!followRow, followerCount: followerCount?.count ?? 0, followingCount: followingCount?.count ?? 0 });
});

// ── Followers list, with a real "friend" flag per follower for the
// handshake icon — computed from the PROFILE OWNER's friendships (not the
// viewer's), so it reads the same regardless of who's looking, including
// the profile owner viewing their own list. ──────────────────────────────
router.get("/:userId/followers", async (req, res) => {
  const targetId = req.params.userId;

  const rows = await db
    .select({ follower: PUBLIC_USER_COLUMNS, createdAt: follows.createdAt })
    .from(follows)
    .innerJoin(users, eq(users.id, follows.followerId))
    .where(eq(follows.followingId, targetId))
    .orderBy(desc(follows.createdAt));

  if (rows.length === 0) return res.json([]);

  const followerIds = rows.map((r) => r.follower.id);
  const friendRows = await db
    .select({ requesterId: friendRequests.requesterId, recipientId: friendRequests.recipientId })
    .from(friendRequests)
    .where(and(eq(friendRequests.status, "accepted"), or(and(eq(friendRequests.requesterId, targetId), inArray(friendRequests.recipientId, followerIds)), and(eq(friendRequests.recipientId, targetId), inArray(friendRequests.requesterId, followerIds)))));
  const friendIds = new Set(friendRows.map((f) => (f.requesterId === targetId ? f.recipientId : f.requesterId)));

  res.json(rows.map((r) => ({ ...r.follower, followedAt: r.createdAt, isFriend: friendIds.has(r.follower.id) })));
});

router.get("/:userId/following", async (req, res) => {
  const targetId = req.params.userId;
  const rows = await db
    .select({ following: PUBLIC_USER_COLUMNS, createdAt: follows.createdAt })
    .from(follows)
    .innerJoin(users, eq(users.id, follows.followingId))
    .where(eq(follows.followerId, targetId))
    .orderBy(desc(follows.createdAt));
  res.json(rows.map((r) => ({ ...r.following, followedAt: r.createdAt })));
});

export default router;
