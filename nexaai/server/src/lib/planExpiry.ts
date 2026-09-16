// Lazy plan-expiry sync: rather than standing up full Paddle subscription-
// lifecycle webhooks and Apple App Store Server Notifications V2 (a much
// bigger integration — a real deployment should eventually add both), this
// checks a user's own planCurrentPeriodEnd at natural high-traffic
// touchpoints and downgrades them back to "beginner" the moment their paid
// period has actually lapsed. A cancelled Paddle subscription or an
// unrenewed Apple subscription both eventually show up here: the row's
// planCurrentPeriodEnd stops moving forward, and the next touchpoint call
// catches it.
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users } from "@shared/schema";
import type { PlanTier } from "./plans";

export async function syncExpiredPlan(userId: string): Promise<PlanTier> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return "beginner";
  if (user.planTier === "beginner") return "beginner";
  if (!user.planCurrentPeriodEnd) return user.planTier as PlanTier; // no expiry tracked yet (e.g. legacy row) — leave as-is

  if (user.planCurrentPeriodEnd.getTime() <= Date.now()) {
    const [updated] = await db
      .update(users)
      .set({ planTier: "beginner", planSource: null, planCurrentPeriodEnd: null })
      .where(eq(users.id, userId))
      .returning();
    return updated.planTier as PlanTier;
  }
  return user.planTier as PlanTier;
}
