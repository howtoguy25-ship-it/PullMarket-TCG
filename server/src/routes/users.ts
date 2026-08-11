import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { users, listings, friendRequests, conversations } from "@shared/schema";
import { and, desc, eq, ilike, ne, or, sql } from "drizzle-orm";
import { authenticateToken } from "../middleware/auth";
import { attachImagesAndSellers } from "./listings";

const router = Router();
router.use(authenticateToken);

const PUBLIC_USER_COLUMNS = {
  id: users.id,
  username: users.username,
  displayName: users.displayName,
  avatarUrl: users.avatarUrl,
  identityVerificationStatus: users.identityVerificationStatus,
};

// ── Search users by username or phone number, for starting a chat ────────
router.get("/search", async (req, res) => {
  const parsed = z.object({ q: z.string().min(1).max(60) }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: "Enter a username or phone number" });
  const q = parsed.data.q.trim();

  const digits = q.replace(/[^\d+]/g, "");
  const matchesPhoneOrUsername = digits.length >= 4 ? or(ilike(users.username, `%${q}%`), ilike(users.phoneNumber, `%${digits}%`)) : ilike(users.username, `%${q}%`);

  const rows = await db
    .select(PUBLIC_USER_COLUMNS)
    .from(users)
    .where(and(sql`${users.deletedAt} IS NULL`, ne(users.id, req.user!.id), matchesPhoneOrUsername))
    .limit(25);

  res.json(rows);
});

// ── Public profile: shown when viewing a user from a chat ────────────────
router.get("/:id/profile", async (req, res) => {
  const [target] = await db.select(PUBLIC_USER_COLUMNS).from(users).where(eq(users.id, req.params.id));
  if (!target) return res.status(404).json({ message: "User not found" });

  const meId = req.user!.id;
  const [userAId, userBId] = meId < target.id ? [meId, target.id] : [target.id, meId];

  const [listingRows, friendRow, convoRow] = await Promise.all([
    db.select().from(listings).where(and(eq(listings.sellerId, target.id), eq(listings.status, "active"))).orderBy(desc(listings.createdAt)).limit(20),
    db
      .select()
      .from(friendRequests)
      .where(or(and(eq(friendRequests.requesterId, meId), eq(friendRequests.recipientId, target.id)), and(eq(friendRequests.requesterId, target.id), eq(friendRequests.recipientId, meId)))),
    db.select({ id: conversations.id, status: conversations.status }).from(conversations).where(and(eq(conversations.userAId, userAId), eq(conversations.userBId, userBId))),
  ]);

  const friendRequest = friendRow[0];
  let friendStatus: "none" | "friends" | "pending_sent" | "pending_received" = "none";
  if (friendRequest) {
    if (friendRequest.status === "accepted") friendStatus = "friends";
    else if (friendRequest.status === "pending") friendStatus = friendRequest.requesterId === meId ? "pending_sent" : "pending_received";
  }

  const showsListings = target.identityVerificationStatus === "verified" && listingRows.length > 1;
  const withDetails = showsListings ? await attachImagesAndSellers(listingRows) : [];

  res.json({
    ...target,
    friendStatus,
    friendRequestId: friendRequest?.status === "pending" ? friendRequest.id : null,
    conversation: convoRow[0] ?? null,
    listings: withDetails,
  });
});

export default router;
