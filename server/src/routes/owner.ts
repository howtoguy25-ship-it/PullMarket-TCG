import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { reports, users, listings, orders, listingImages, conversations, messages } from "@shared/schema";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { authenticateToken, requireOwner } from "../middleware/auth";
import { sendEmail } from "../lib/mailer";
import { notifyUser } from "../lib/notify";
import { isReviewBypassEnabled, setReviewBypassEnabled } from "../lib/appSettings";

const router = Router();
router.use(authenticateToken, requireOwner);

const REPORTER_COLUMNS = { id: users.id, username: users.username, email: users.email, phoneNumber: users.phoneNumber };

// ── Incident reports (listing/order/chat, user-submitted or AI-flagged) ───
router.get("/reports", async (req, res) => {
  const statusFilter = req.query.status as string | undefined;
  const rows = await db
    .select()
    .from(reports)
    .where(statusFilter ? eq(reports.status, statusFilter) : sql`true`)
    .orderBy(desc(reports.createdAt));

  const userIds = [...new Set([...rows.map((r) => r.reporterId), ...rows.map((r) => r.reportedUserId)].filter((x): x is string => !!x))];
  const listingIds = rows.map((r) => r.listingId).filter((x): x is string => !!x);
  const orderIds = rows.map((r) => r.orderId).filter((x): x is string => !!x);
  const [relatedUsers, relatedListings, relatedOrders] = await Promise.all([
    userIds.length ? db.select(REPORTER_COLUMNS).from(users).where(inArray(users.id, userIds)) : Promise.resolve([]),
    listingIds.length ? db.select().from(listings).where(inArray(listings.id, listingIds)) : Promise.resolve([]),
    orderIds.length ? db.select().from(orders).where(inArray(orders.id, orderIds)) : Promise.resolve([]),
  ]);
  const userById = new Map(relatedUsers.map((u) => [u.id, u]));
  const listingById = new Map(relatedListings.map((l) => [l.id, l]));
  const orderById = new Map(relatedOrders.map((o) => [o.id, o]));

  res.json(
    rows.map((r) => ({
      ...r,
      reporter: r.reporterId ? userById.get(r.reporterId) ?? null : null,
      reportedUser: r.reportedUserId ? userById.get(r.reportedUserId) ?? null : null,
      listing: r.listingId ? listingById.get(r.listingId) ?? null : null,
      order: r.orderId ? orderById.get(r.orderId) ?? null : null,
    })),
  );
});

router.get("/reports/:id", async (req, res) => {
  const [report] = await db.select().from(reports).where(eq(reports.id, req.params.id));
  if (!report) return res.status(404).json({ message: "Report not found" });

  const [reporter, reportedUser] = await Promise.all([
    report.reporterId ? db.select(REPORTER_COLUMNS).from(users).where(eq(users.id, report.reporterId)).then((r) => r[0] ?? null) : Promise.resolve(null),
    report.reportedUserId ? db.select(REPORTER_COLUMNS).from(users).where(eq(users.id, report.reportedUserId)).then((r) => r[0] ?? null) : Promise.resolve(null),
  ]);

  const listing = report.listingId ? (await db.select().from(listings).where(eq(listings.id, report.listingId)))[0] : null;
  const images = listing ? await db.select().from(listingImages).where(eq(listingImages.listingId, listing.id)) : [];

  let message: { id: string; text: string | null; createdAt: Date | null } | null = null;
  let recentMessages: { senderId: string; text: string | null; createdAt: Date | null }[] = [];
  if (report.conversationId) {
    recentMessages = await db
      .select({ senderId: messages.senderId, text: messages.text, createdAt: messages.createdAt })
      .from(messages)
      .where(eq(messages.conversationId, report.conversationId))
      .orderBy(desc(messages.createdAt))
      .limit(20);
    recentMessages.reverse();
  }
  if (report.messageId) {
    message = (await db.select({ id: messages.id, text: messages.text, createdAt: messages.createdAt }).from(messages).where(eq(messages.id, report.messageId)))[0] ?? null;
  }

  res.json({
    ...report,
    reporter,
    reportedUser,
    listing: listing ? { ...listing, images: images.map((i) => i.url) } : null,
    flaggedMessage: message,
    recentMessages,
  });
});

router.patch("/reports/:id", async (req, res) => {
  const schema = z.object({ status: z.enum(["pending", "reviewed", "actioned", "dismissed"]).optional(), ownerNotes: z.string().max(2000).optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid request" });
  const [updated] = await db.update(reports).set(parsed.data).where(eq(reports.id, req.params.id)).returning();
  if (!updated) return res.status(404).json({ message: "Report not found" });
  res.json(updated);
});

// ── Approve: upholds the report and takes real action — delists the
// reported listing, or suspends the reported user for a chat report. Every
// report stays in the table regardless (nothing is ever deleted), so this
// is purely a status + consequence change, not a data-retention decision.
router.post("/reports/:id/approve", async (req, res) => {
  const schema = z.object({ ownerNotes: z.string().max(2000).optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid request" });

  const [report] = await db.select().from(reports).where(eq(reports.id, req.params.id));
  if (!report) return res.status(404).json({ message: "Report not found" });

  if (report.listingId) {
    await db.update(listings).set({ status: "removed" }).where(eq(listings.id, report.listingId));
  }
  if (report.reportedUserId) {
    const reasonNote = `Report upheld (${report.reason}): ${report.description.slice(0, 300)}`;
    await db
      .update(users)
      .set({ isSuspended: true, suspendedAt: new Date(), suspensionReason: reasonNote, tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.id, report.reportedUserId));
  }

  const [updated] = await db
    .update(reports)
    .set({ status: "actioned", ownerNotes: parsed.data.ownerNotes ?? report.ownerNotes })
    .where(eq(reports.id, report.id))
    .returning();

  if (report.reporterId) {
    await notifyUser(report.reporterId, {
      type: "report_update",
      title: "Your report was reviewed",
      body: "We reviewed your report and took action. Thanks for helping keep PullMarket safe.",
      data: { reportId: report.id },
    });
  }

  res.json(updated);
});

// ── Decline: closes the report with no consequence. Still saved forever
// for the record — declining just means no enforcement action was taken.
router.post("/reports/:id/decline", async (req, res) => {
  const schema = z.object({ ownerNotes: z.string().max(2000).optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid request" });

  const [report] = await db.select().from(reports).where(eq(reports.id, req.params.id));
  if (!report) return res.status(404).json({ message: "Report not found" });

  const [updated] = await db
    .update(reports)
    .set({ status: "dismissed", ownerNotes: parsed.data.ownerNotes ?? report.ownerNotes })
    .where(eq(reports.id, report.id))
    .returning();

  if (report.reporterId) {
    await notifyUser(report.reporterId, {
      type: "report_update",
      title: "Your report was reviewed",
      body: "We looked into your report — no action was needed this time.",
      data: { reportId: report.id },
    });
  }

  res.json(updated);
});

// ── Reply to the reporter: sends an email back to the app's report inbox,
// which forwards to the customer's email address on file. ────────────────
router.post("/reports/:id/reply", async (req, res) => {
  const schema = z.object({ message: z.string().min(1).max(5000) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Write a reply message" });

  const [report] = await db.select().from(reports).where(eq(reports.id, req.params.id));
  if (!report) return res.status(404).json({ message: "Report not found" });
  if (!report.reporterId) {
    return res.status(400).json({ message: "This report was auto-flagged by AI moderation — there's no reporting customer to email." });
  }

  const [reporter] = await db.select({ email: users.email }).from(users).where(eq(users.id, report.reporterId));
  if (!reporter?.email) {
    return res.status(400).json({ message: "This customer didn't sign up with an email address, so a reply can't be sent by email." });
  }

  await sendEmail({
    to: reporter.email,
    subject: `Re: your PullMarket TCG report (#${report.id.slice(0, 8)})`,
    text: parsed.data.message,
  });

  await db.update(reports).set({ ownerReplySentAt: new Date(), status: "reviewed" }).where(eq(reports.id, report.id));

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

// ── App-wide runtime settings (currently just the App Review sign-in
// bypass — see server/src/lib/otp.ts) ─────────────────────────────────────
router.get("/settings", async (_req, res) => {
  res.json({ reviewBypassEnabled: await isReviewBypassEnabled() });
});

router.post("/settings/review-bypass", async (req, res) => {
  const parsed = z.object({ enabled: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid request" });
  res.json({ reviewBypassEnabled: await setReviewBypassEnabled(parsed.data.enabled) });
});

export default router;
