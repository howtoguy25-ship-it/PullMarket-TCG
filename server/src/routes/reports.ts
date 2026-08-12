import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { reports, listings, users, conversations } from "@shared/schema";
import { eq } from "drizzle-orm";
import { authenticateToken } from "../middleware/auth";

const router = Router();
router.use(authenticateToken);

const REASONS = ["counterfeit", "not_as_described", "never_received", "scam", "inappropriate", "harassment", "other"] as const;

router.post("/", async (req, res) => {
  const schema = z.object({
    listingId: z.string().optional(),
    orderId: z.string().optional(),
    conversationId: z.string().optional(),
    reportedUserId: z.string().optional(),
    reason: z.enum(REASONS),
    description: z.string().min(5).max(2000),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid report" });

  if (parsed.data.listingId) {
    const [listing] = await db.select().from(listings).where(eq(listings.id, parsed.data.listingId));
    if (!listing) return res.status(404).json({ message: "Listing not found" });
  }
  if (parsed.data.conversationId) {
    const [convo] = await db.select().from(conversations).where(eq(conversations.id, parsed.data.conversationId));
    if (!convo) return res.status(404).json({ message: "Conversation not found" });
    if (convo.userAId !== req.user!.id && convo.userBId !== req.user!.id) return res.status(403).json({ message: "You're not part of this conversation" });
  }
  if (parsed.data.reportedUserId) {
    const [reported] = await db.select({ id: users.id }).from(users).where(eq(users.id, parsed.data.reportedUserId));
    if (!reported) return res.status(404).json({ message: "User not found" });
  }

  const [report] = await db
    .insert(reports)
    .values({ reporterId: req.user!.id, source: "user", ...parsed.data })
    .returning();

  res.status(201).json(report);
});

router.get("/mine", async (req, res) => {
  const rows = await db.select().from(reports).where(eq(reports.reporterId, req.user!.id));
  res.json(rows);
});

export default router;
