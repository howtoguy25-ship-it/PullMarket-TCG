import { Router } from "express";
import { db } from "../db";
import { notifications } from "@shared/schema";
import { and, desc, eq } from "drizzle-orm";
import { authenticateToken } from "../middleware/auth";

const router = Router();
router.use(authenticateToken);

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

export default router;
