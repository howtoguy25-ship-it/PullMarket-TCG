import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { reports, users, listings, orders, listingImages } from "@shared/schema";
import { desc, eq, sql } from "drizzle-orm";
import { authenticateToken, requireOwner } from "../middleware/auth";
import { sendEmail } from "../lib/mailer";

const router = Router();
router.use(authenticateToken, requireOwner);

// ── Incident reports ──────────────────────────────────────────────────────
router.get("/reports", async (req, res) => {
  const statusFilter = req.query.status as string | undefined;
  const rows = await db
    .select({
      report: reports,
      reporter: { id: users.id, username: users.username, email: users.email, phoneNumber: users.phoneNumber },
    })
    .from(reports)
    .innerJoin(users, eq(reports.reporterId, users.id))
    .where(statusFilter ? eq(reports.status, statusFilter) : sql`true`)
    .orderBy(desc(reports.createdAt));

  const listingIds = rows.map((r) => r.report.listingId).filter((x): x is string => !!x);
  const orderIds = rows.map((r) => r.report.orderId).filter((x): x is string => !!x);
  const [relatedListings, relatedOrders] = await Promise.all([
    listingIds.length ? db.select().from(listings).where(sql`${listings.id} = ANY(${listingIds})`) : Promise.resolve([]),
    orderIds.length ? db.select().from(orders).where(sql`${orders.id} = ANY(${orderIds})`) : Promise.resolve([]),
  ]);
  const listingById = new Map(relatedListings.map((l) => [l.id, l]));
  const orderById = new Map(relatedOrders.map((o) => [o.id, o]));

  res.json(
    rows.map((r) => ({
      ...r.report,
      reporter: r.reporter,
      listing: r.report.listingId ? listingById.get(r.report.listingId) ?? null : null,
      order: r.report.orderId ? orderById.get(r.report.orderId) ?? null : null,
    })),
  );
});

router.get("/reports/:id", async (req, res) => {
  const [row] = await db
    .select({ report: reports, reporter: users })
    .from(reports)
    .innerJoin(users, eq(reports.reporterId, users.id))
    .where(eq(reports.id, req.params.id));
  if (!row) return res.status(404).json({ message: "Report not found" });

  const listing = row.report.listingId ? (await db.select().from(listings).where(eq(listings.id, row.report.listingId)))[0] : null;
  const images = listing ? await db.select().from(listingImages).where(eq(listingImages.listingId, listing.id)) : [];

  res.json({ ...row.report, reporter: row.reporter, listing: listing ? { ...listing, images: images.map((i) => i.url) } : null });
});

router.patch("/reports/:id", async (req, res) => {
  const schema = z.object({ status: z.enum(["pending", "reviewed", "actioned", "dismissed"]).optional(), ownerNotes: z.string().max(2000).optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid request" });
  const [updated] = await db.update(reports).set(parsed.data).where(eq(reports.id, req.params.id)).returning();
  if (!updated) return res.status(404).json({ message: "Report not found" });
  res.json(updated);
});

// ── Reply to the reporter: sends an email back to the app's report inbox,
// which forwards to the customer's email address on file. ────────────────
router.post("/reports/:id/reply", async (req, res) => {
  const schema = z.object({ message: z.string().min(1).max(5000) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Write a reply message" });

  const [row] = await db
    .select({ report: reports, reporter: users })
    .from(reports)
    .innerJoin(users, eq(reports.reporterId, users.id))
    .where(eq(reports.id, req.params.id));
  if (!row) return res.status(404).json({ message: "Report not found" });

  if (!row.reporter.email) {
    return res.status(400).json({ message: "This customer didn't sign up with an email address, so a reply can't be sent by email." });
  }

  await sendEmail({
    to: row.reporter.email,
    subject: `Re: your PullMarket TCG report (#${row.report.id.slice(0, 8)})`,
    text: parsed.data.message,
  });

  await db.update(reports).set({ ownerReplySentAt: new Date(), status: "reviewed" }).where(eq(reports.id, row.report.id));

  res.json({ status: "sent" });
});

// ── Users / suspensions ───────────────────────────────────────────────────
router.get("/users", async (req, res) => {
  const rows = await db.select().from(users).orderBy(desc(users.createdAt)).limit(500);
  res.json(rows);
});

router.post("/users/:id/suspend", async (req, res) => {
  const schema = z.object({ reason: z.string().min(3).max(500) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Give a reason for the suspension" });

  const [updated] = await db
    .update(users)
    .set({ isSuspended: true, suspendedAt: new Date(), suspensionReason: parsed.data.reason, tokenVersion: sql`${users.tokenVersion} + 1` })
    .where(eq(users.id, req.params.id))
    .returning();
  if (!updated) return res.status(404).json({ message: "User not found" });
  res.json(updated);
});

router.post("/users/:id/unsuspend", async (req, res) => {
  const [updated] = await db.update(users).set({ isSuspended: false, suspendedAt: null, suspensionReason: null }).where(eq(users.id, req.params.id)).returning();
  if (!updated) return res.status(404).json({ message: "User not found" });
  res.json(updated);
});

// ── Orders overview (for manual refund/shipping disputes) ────────────────
router.get("/orders", async (_req, res) => {
  const rows = await db.select().from(orders).orderBy(desc(orders.createdAt)).limit(500);
  res.json(rows);
});

export default router;
