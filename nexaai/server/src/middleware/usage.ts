import { eq } from "drizzle-orm";
import { db } from "../db";
import { usageWindows } from "@shared/schema";
import { PLAN_DEFINITIONS, type PlanTier } from "../lib/plans";
import { isWindowExpired, windowResetAt, formatCountdown, formatInTimezone } from "../lib/usageClock";

export type UsageCheck = { ok: true } | { ok: false; reason: "window_limit"; message: string; resetAt: Date };

async function getOrCreateWindow(userId: string) {
  let [window] = await db.select().from(usageWindows).where(eq(usageWindows.userId, userId));
  if (!window) {
    [window] = await db.insert(usageWindows).values({ userId }).returning();
  }
  return window;
}

/**
 * Real Claude-style rolling window check: are they still inside an active
 * window, and if so, have they used up its message cap? Call this before
 * actually answering a message.
 */
export async function checkUsageWindow(userId: string, tier: PlanTier, timezone: string): Promise<UsageCheck> {
  const now = new Date();
  const plan = PLAN_DEFINITIONS[tier];
  const window = await getOrCreateWindow(userId);

  if (isWindowExpired(window.windowStartAt, now)) return { ok: true };

  if (window.messagesUsedInWindow >= plan.messagesPerWindow) {
    const resetAt = windowResetAt(window.windowStartAt!);
    return {
      ok: false,
      reason: "window_limit",
      resetAt,
      message: `You've used all ${plan.messagesPerWindow} messages available right now on ${plan.displayName}. More available in ${formatCountdown(resetAt, now)} (${formatInTimezone(resetAt, timezone)} your time).`,
    };
  }
  return { ok: true };
}

/** Records one real chat turn against the rolling window — starts a fresh window if the last one expired (or never existed). */
export async function recordMessageSent(userId: string) {
  const now = new Date();
  const window = await getOrCreateWindow(userId);
  const patch = isWindowExpired(window.windowStartAt, now)
    ? { windowStartAt: now, messagesUsedInWindow: 1, updatedAt: now }
    : { messagesUsedInWindow: window.messagesUsedInWindow + 1, updatedAt: now };
  await db.update(usageWindows).set(patch).where(eq(usageWindows.userId, userId));
}

export interface UsageStatus {
  messagesUsedInWindow: number;
  messagesPerWindow: number;
  resetAt: string | null;
}

/** For the Plans screen's real usage display — current window state, or a full-cap "nothing used yet" state if there's no active window. */
export async function getUsageStatus(userId: string, tier: PlanTier): Promise<UsageStatus> {
  const now = new Date();
  const plan = PLAN_DEFINITIONS[tier];
  const window = await getOrCreateWindow(userId);
  if (isWindowExpired(window.windowStartAt, now)) {
    return { messagesUsedInWindow: 0, messagesPerWindow: plan.messagesPerWindow, resetAt: null };
  }
  return {
    messagesUsedInWindow: window.messagesUsedInWindow,
    messagesPerWindow: plan.messagesPerWindow,
    resetAt: windowResetAt(window.windowStartAt!).toISOString(),
  };
}
