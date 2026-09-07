import { Router } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { users } from "@shared/schema";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { PLAN_DEFINITIONS, FOCUS_MODE_DEFINITIONS } from "../lib/plans";

export const plansRouter = Router();

plansRouter.get("/", (_req, res) => {
  res.json({ plans: Object.values(PLAN_DEFINITIONS) });
});

plansRouter.get("/focus-modes", (_req, res) => {
  res.json({ focusModes: Object.values(FOCUS_MODE_DEFINITIONS) });
});

const switchSchema = z.object({ tier: z.enum(["beginner", "pro", "max"]) });
plansRouter.post("/switch", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = switchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  // NOTE: this only flips the tier flag. A real deployment must gate this on
  // an actual successful subscription payment (Paddle subscription webhook,
  // or an Apple IAP auto-renewable subscription receipt) before allowing the
  // upgrade — left as a TODO wired to the same payment layer as credits.
  const [user] = await db.update(users).set({ planTier: parsed.data.tier }).where(eq(users.id, req.userId!)).returning();
  res.json({ planTier: user.planTier });
});
