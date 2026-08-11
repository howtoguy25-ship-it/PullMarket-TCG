import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { notifications, users } from "@shared/schema";
import { and, desc, eq } from "drizzle-orm";
import { authenticateToken } from "../middleware/auth";

const router = Router();
router.use(authenticateToken);

// ── Register this device's Expo push token so we can send real push
// notifications, not just in-app ones ─────────────────────────────────────
router.post("/push-token", async (req, res) => {
  const schema = z.object({ pushToken: z.string().min(10).nullable() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid request" });

  await db.update(users).set({ pushToken: parsed.data.pushToken }).where(eq(users.id, req.user!.id));
  res.json({ status: "ok" });
});

router.get("/", async (req, res) => {
  const rows = await db.select().from(notifications).where(eq(notifications.userId, req.user!.id)).orderBy(desc(notifications.createdAt)).limit(100);
  res.json(rows);
});

router.get("/unread-count", async (req, res) => {
  const rows = await db.select().from(notifications).where(and(eq(notifications.userId, req.user!.id), eq(notifications.isRead, false)));
  res.json({ count: rows.length });
});

router.post("/:id/read", async (req, res) => {
  await db.update(notifications).set({ isRead: true }).where(and(eq(notifications.id, req.params.id), eq(notifications.userId, req.user!.id)));
  res.json({ status: "ok" });
});

router.post("/read-all", async (req, res) => {
  await db.update(notifications).set({ isRead: true }).where(eq(notifications.userId, req.user!.id));
  res.json({ status: "ok" });
});

router.delete("/:id", async (req, res) => {
  await db.delete(notifications).where(and(eq(notifications.id, req.params.id), eq(notifications.userId, req.user!.id)));
  res.json({ status: "ok" });
});

router.delete("/", async (req, res) => {
  await db.delete(notifications).where(eq(notifications.userId, req.user!.id));
  res.json({ status: "ok" });
});

export default router;
