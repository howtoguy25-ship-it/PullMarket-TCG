import { Router } from "express";
import { db } from "../db";
import { friendRequests, users } from "@shared/schema";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { authenticateToken } from "../middleware/auth";
import { notifyUser } from "../lib/notify";
import { isBlockedEitherWay } from "../lib/blocks";

const router = Router();
router.use(authenticateToken);

const PUBLIC_USER_COLUMNS = { id: users.id, username: users.username, displayName: users.displayName, avatarUrl: users.avatarUrl };

async function attachUsers<T extends { requesterId: string; recipientId: string }>(rows: T[]) {
  if (rows.length === 0) return [];
  const ids = Array.from(new Set(rows.flatMap((r) => [r.requesterId, r.recipientId])));
  const people = await db.select(PUBLIC_USER_COLUMNS).from(users).where(inArray(users.id, ids));
  const byId = new Map(people.map((p) => [p.id, p]));
  return rows.map((r) => ({ ...r, requester: byId.get(r.requesterId) ?? null, recipient: byId.get(r.recipientId) ?? null }));
}

// ── Send a friend request (or auto-accept if they already requested you) ─
router.post("/request/:userId", async (req, res) => {
  const meId = req.user!.id;
  const targetId = req.params.userId;
  if (targetId === meId) return res.status(400).json({ message: "You can't friend yourself" });

  const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, targetId));
  if (!target) return res.status(404).json({ message: "User not found" });
  if (await isBlockedEitherWay(meId, targetId)) return res.status(403).json({ message: "You can't friend this user" });

  const [reverse] = await db.select().from(friendRequests).where(and(eq(friendRequests.requesterId, targetId), eq(friendRequests.recipientId, meId)));
  if (reverse) {
    if (reverse.status === "accepted") return res.json(reverse);
    const [updated] = await db.update(friendRequests).set({ status: "accepted", respondedAt: new Date() }).where(eq(friendRequests.id, reverse.id)).returning();
    await notifyUser(targetId, { type: "friend_accept", title: "Friend request accepted", body: `@${req.user!.username} accepted your friend request`, data: { userId: meId } });
    return res.json(updated);
  }

  const [existing] = await db.select().from(friendRequests).where(and(eq(friendRequests.requesterId, meId), eq(friendRequests.recipientId, targetId)));
  if (existing) return res.json(existing);

  const [created] = await db.insert(friendRequests).values({ requesterId: meId, recipientId: targetId, status: "pending" }).returning();
  await notifyUser(targetId, { type: "friend_request", title: "New friend request", body: `@${req.user!.username} sent you a friend request`, data: { requestId: created.id, userId: meId } });
  res.status(201).json(created);
});

router.post("/:requestId/accept", async (req, res) => {
  const [request] = await db.select().from(friendRequests).where(eq(friendRequests.id, req.params.requestId));
  if (!request) return res.status(404).json({ message: "Request not found" });
  if (request.recipientId !== req.user!.id) return res.status(403).json({ message: "Not your request to accept" });
  if (request.status !== "pending") return res.json(request);

  const [updated] = await db.update(friendRequests).set({ status: "accepted", respondedAt: new Date() }).where(eq(friendRequests.id, request.id)).returning();
  await notifyUser(request.requesterId, { type: "friend_accept", title: "Friend request accepted", body: `@${req.user!.username} accepted your friend request`, data: { userId: req.user!.id } });
  res.json(updated);
});

router.post("/:requestId/decline", async (req, res) => {
  const [request] = await db.select().from(friendRequests).where(eq(friendRequests.id, req.params.requestId));
  if (!request) return res.status(404).json({ message: "Request not found" });
  if (request.recipientId !== req.user!.id) return res.status(403).json({ message: "Not your request to decline" });

  const [updated] = await db.update(friendRequests).set({ status: "declined", respondedAt: new Date() }).where(eq(friendRequests.id, request.id)).returning();
  res.json(updated);
});

// ── Remove an existing friendship ─────────────────────────────────────────
router.delete("/:userId", async (req, res) => {
  const meId = req.user!.id;
  await db
    .delete(friendRequests)
    .where(or(and(eq(friendRequests.requesterId, meId), eq(friendRequests.recipientId, req.params.userId)), and(eq(friendRequests.requesterId, req.params.userId), eq(friendRequests.recipientId, meId))));
  res.json({ status: "ok" });
});

router.get("/requests", async (req, res) => {
  const meId = req.user!.id;
  const [incoming, outgoing] = await Promise.all([
    db.select().from(friendRequests).where(and(eq(friendRequests.recipientId, meId), eq(friendRequests.status, "pending"))).orderBy(desc(friendRequests.createdAt)),
    db.select().from(friendRequests).where(and(eq(friendRequests.requesterId, meId), eq(friendRequests.status, "pending"))).orderBy(desc(friendRequests.createdAt)),
  ]);
  res.json({ incoming: await attachUsers(incoming), outgoing: await attachUsers(outgoing) });
});

router.get("/status/:userId", async (req, res) => {
  const meId = req.user!.id;
  const targetId = req.params.userId;
  const [row] = await db
    .select()
    .from(friendRequests)
    .where(or(and(eq(friendRequests.requesterId, meId), eq(friendRequests.recipientId, targetId)), and(eq(friendRequests.requesterId, targetId), eq(friendRequests.recipientId, meId))));

  if (!row) return res.json({ status: "none", requestId: null });
  if (row.status === "accepted") return res.json({ status: "friends", requestId: row.id });
  if (row.status === "declined") return res.json({ status: "none", requestId: null });
  res.json({ status: row.requesterId === meId ? "pending_sent" : "pending_received", requestId: row.id });
});

export default router;
