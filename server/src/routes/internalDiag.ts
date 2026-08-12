// TEMPORARY diagnostic route — read-only, token-protected, deleted right
// after use. Added to directly inspect why authenticateToken's user lookup
// is failing immediately after a successful sign-in for a specific
// account, instead of continuing to guess at the cause from client-side
// symptoms alone.
import { Router } from "express";
import { db } from "../db";
import { users } from "@shared/schema";
import { sql } from "drizzle-orm";
import { getFailedLookups } from "../lib/authDiag";

const router = Router();

const DIAG_TOKEN = "diag-7f3a9c-temp-2026";

router.get("/failed-lookups", (req, res) => {
  if (req.query.token !== DIAG_TOKEN) return res.status(404).end();
  res.json({ failedLookups: getFailedLookups() });
});

router.get("/users-by-phone", async (req, res) => {
  if (req.query.token !== DIAG_TOKEN) return res.status(404).end();
  const phone = String(req.query.phone || "");

  const exact = await db.select().from(users).where(sql`${users.phoneNumber} = ${phone}`);
  const like = await db.select({ id: users.id, username: users.username, phoneNumber: users.phoneNumber }).from(users).where(sql`${users.phoneNumber} ILIKE ${"%" + phone.replace(/^\+/, "") + "%"}`);
  const countAll = await db.select({ count: sql<number>`count(*)::int` }).from(users);

  res.json({
    queriedPhone: phone,
    exactMatches: exact.map((u) => ({
      id: u.id,
      username: u.username,
      phoneNumber: u.phoneNumber,
      email: u.email,
      tokenVersion: u.tokenVersion,
      isSuspended: u.isSuspended,
      deletedAt: u.deletedAt,
      createdAt: u.createdAt,
      lastSeen: u.lastSeen,
    })),
    likeMatches: like,
    totalUserCount: countAll[0]?.count,
  });
});

export default router;
