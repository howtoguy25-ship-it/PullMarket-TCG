import { Router } from "express";
import { db } from "../db";
import { blocks, friendRequests, users, conversations } from "@shared/schema";
import { and, eq, inArray, or } from "drizzle-orm";
import { authenticateToken } from "../middleware/auth";

const router = Router();
router.use(authenticateToken);

const PUBLIC_USER_COLUMNS = { id: users.id, username: users.username, displayName: users.displayName, avatarUrl: users.avatarUrl };

// ── Block a user ──────────────────────────────────────────────────────────
// Also tears down any existing friendship and closes the conversation
// (declined) so the blocked person can't keep messaging through a thread
// that already existed before the block — mirrors how declining a message
// request already stops delivery in chat.ts's send route.
router.post("/:userId", async (req, res) => {
  const meId = req.user!.id;
  const targetId = req.params.userId;
  if (targetId === meId) return res.status(400).json({ message: "You can't block yourself" });

  const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, targetId));
  if (!target) return res.status(404).json({ message: "User not found" });

  await db.insert(blocks).values({ blockerId: meId, blockedId: targetId }).onConflictDoNothing();
  await db.delete(friendRequests).where(or(and(eq(friendRequests.requesterId, meId), eq(friendRequests.recipientId, targetId)), and(eq(friendRequests.requesterId, targetId), eq(friendRequests.recipientId, meId))));

  const [userAId, userBId] = meId < targetId ? [meId, targetId] : [targetId, meId];
  await db.update(conversations).set({ status: "declined" }).where(and(eq(conversations.userAId, userAId), eq(conversations.userBId, userBId)));

  res.status(201).json({ status: "ok" });
});

router.delete("/:userId", async (req, res) => {
  const meId = req.user!.id;
  await db.delete(blocks).where(and(eq(blocks.blockerId, meId), eq(blocks.blockedId, req.params.userId)));
  res.json({ status: "ok" });
});

router.get("/", async (req, res) => {
  const meId = req.user!.id;
  const rows = await db.select({ blockedId: blocks.blockedId, createdAt: blocks.createdAt }).from(blocks).where(eq(blocks.blockerId, meId));
  if (rows.length === 0) return res.json([]);

  const people = await db.select(PUBLIC_USER_COLUMNS).from(users).where(inArray(users.id, rows.map((r) => r.blockedId)));
  const byId = new Map(people.map((p) => [p.id, p]));
  res.json(rows.map((r) => ({ ...byId.get(r.blockedId), blockedAt: r.createdAt })).filter((r) => r.id));
});

export default router;
