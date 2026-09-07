import { eq } from "drizzle-orm";
import { db } from "../db";
import { usageWindows, users } from "@shared/schema";
import { PLAN_DEFINITIONS, type PlanTier } from "../lib/plans";
import {
  nextWeeklyResetAt,
  startOfSydneyDay,
  formatSydneyTime,
  formatInTimezone,
  computeRestUntil,
  type SessionPace,
} from "../lib/usageClock";

function currentWeeklyWindowStart(now: Date): Date {
  const next = nextWeeklyResetAt(now);
  return new Date(next.getTime() - 7 * 24 * 60 * 60 * 1000);
}

export type UsageCheck =
  | { ok: true }
  | { ok: false; reason: "resting" | "weekly_limit" | "daily_limit"; message: string; resetAt: Date };

/**
 * Rolls the user's usage window forward across any reset boundaries that
 * have passed, then checks whether they're currently allowed to use the
 * app. Call this before starting/continuing a chat session.
 */
export async function checkUsageWindow(userId: string, tier: PlanTier, timezone: string): Promise<UsageCheck> {
  const now = new Date();
  const plan = PLAN_DEFINITIONS[tier];

  let [window] = await db.select().from(usageWindows).where(eq(usageWindows.userId, userId));
  if (!window) {
    [window] = await db
      .insert(usageWindows)
      .values({
        userId,
        weekStartAt: currentWeeklyWindowStart(now),
        weeklySecondsCap: plan.weeklySessionSecondsCap,
        dayStartAt: startOfSydneyDay(now),
        sessionsCapToday: plan.dailySessionCountCap,
      })
      .returning();
  }

  const weekStart = currentWeeklyWindowStart(now);
  const dayStart = startOfSydneyDay(now);
  const needsWeekReset = window.weekStartAt.getTime() < weekStart.getTime();
  const needsDayReset = window.dayStartAt.getTime() < dayStart.getTime();

  if (needsWeekReset || needsDayReset) {
    const patch: Partial<typeof window> = {};
    if (needsWeekReset) {
      patch.weekStartAt = weekStart;
      patch.weeklySecondsUsed = 0;
      patch.weeklySecondsCap = plan.weeklySessionSecondsCap;
    }
    if (needsDayReset) {
      patch.dayStartAt = dayStart;
      patch.sessionsUsedToday = 0;
      patch.sessionsCapToday = plan.dailySessionCountCap;
    }
    [window] = await db
      .update(usageWindows)
      .set({ ...patch, updatedAt: now })
      .where(eq(usageWindows.userId, userId))
      .returning();
  }

  if (window.restUntil && now.getTime() < window.restUntil.getTime()) {
    return {
      ok: false,
      reason: "resting",
      resetAt: window.restUntil,
      message: `You've reached your session limit. It resets at ${formatSydneyTime(window.restUntil)} (${formatInTimezone(window.restUntil, timezone)} your time).`,
    };
  }

  if (window.weeklySecondsUsed >= window.weeklySecondsCap) {
    const resetAt = nextWeeklyResetAt(now);
    return {
      ok: false,
      reason: "weekly_limit",
      resetAt,
      message: `You've reached your weekly usage limit. Resets ${formatSydneyTime(resetAt)} (${formatInTimezone(resetAt, timezone)} your time).`,
    };
  }

  if (window.sessionsUsedToday >= window.sessionsCapToday) {
    const resetAt = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    return {
      ok: false,
      reason: "daily_limit",
      resetAt,
      message: `You've reached today's session limit. Resets ${formatSydneyTime(resetAt)} (${formatInTimezone(resetAt, timezone)} your time).`,
    };
  }

  return { ok: true };
}

export async function recordSessionStart(userId: string) {
  // Read-then-write; a production deployment under real concurrency should
  // do this as an atomic `sql`${col} + 1`` update instead.
  const [window] = await db.select().from(usageWindows).where(eq(usageWindows.userId, userId));
  if (window) {
    await db
      .update(usageWindows)
      .set({ sessionsUsedToday: window.sessionsUsedToday + 1, updatedAt: new Date() })
      .where(eq(usageWindows.userId, userId));
  }
}

/** Adds elapsed seconds to the weekly usage counter, and pauses the account (sets restUntil) if this message burned through the last of the weekly allowance at a forced pace. */
export async function recordUsageSeconds(userId: string, seconds: number, pace: SessionPace) {
  const [window] = await db.select().from(usageWindows).where(eq(usageWindows.userId, userId));
  if (!window) return;
  const newUsed = window.weeklySecondsUsed + seconds;
  const patch: Record<string, unknown> = { weeklySecondsUsed: newUsed, updatedAt: new Date() };
  if (newUsed >= window.weeklySecondsCap) {
    patch.restUntil = computeRestUntil(new Date(), pace);
  }
  await db.update(usageWindows).set(patch).where(eq(usageWindows.userId, userId));
}

export async function isTrialActive(userId: string): Promise<boolean> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return false;
  return user.planTier === "beginner" && new Date() < user.trialEndsAt;
}
