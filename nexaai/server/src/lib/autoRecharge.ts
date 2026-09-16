// Real auto-recharge — hooked straight into lib/credits.ts's spendCredits
// (the one true choke point every real credit spend already runs through),
// so this fires no matter which feature spent the credit.
//
// The honest split this file makes explicit: on the web/Stripe side, this
// really can fire a charge with no user interaction at all, once they've
// completed one real checkout and Stripe has a payment method on file for
// them. On iOS there is no equivalent — Apple's StoreKit will not let a
// server or an app silently charge a purchase; every consumable IAP needs
// a real on-device tap (and usually Face ID/Touch ID) no matter who
// initiates it. So an Apple-only user's "auto-recharge" is the client
// noticing the low balance (via GET /api/auth/me, which now returns
// autoRechargeEnabled/threshold) and presenting the real purchase sheet
// automatically — still one tap, because Apple requires it, not because
// this app chose to.

import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { users } from "@shared/schema";
import { stripeProvider } from "./payments/stripe";

const AUTO_RECHARGE_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Fire-and-forget: never throws, never slows down the caller's real
 * response. Called right after a successful spend with the resulting
 * balance.
 */
export function maybeAutoRecharge(db: NodePgDatabase<Record<string, unknown>>, userId: string, balanceAfterCents: number): void {
  attemptAutoRecharge(db, userId, balanceAfterCents).catch((err) => {
    console.error("auto-recharge attempt failed", err);
  });
}

async function attemptAutoRecharge(db: NodePgDatabase<Record<string, unknown>>, userId: string, balanceAfterCents: number): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user || !user.autoRechargeEnabled) return;
  if (balanceAfterCents >= user.autoRechargeThresholdCents) return;

  const inFlightRecently = user.autoRechargeInFlightAt && Date.now() - user.autoRechargeInFlightAt.getTime() < AUTO_RECHARGE_COOLDOWN_MS;
  if (inFlightRecently) return;

  if (!user.stripeCustomerId || !stripeProvider.isConfigured()) {
    // Nothing server-side to do — either this account has never completed
    // a real Stripe checkout (no saved payment method to charge), or
    // Stripe isn't configured on this server at all. The client picks up
    // the slack for an Apple-only user (see this file's header).
    return;
  }

  await db.update(users).set({ autoRechargeInFlightAt: new Date() }).where(eq(users.id, userId));
  try {
    await stripeProvider.chargeSavedPaymentMethod(user.stripeCustomerId, user.autoRechargePackLabel, userId);
    // Left claimed until the real payment_intent.succeeded webhook clears it
    // (routes/webhooks/stripe.ts) — that's the only source of truth that
    // the charge actually went through, not this call returning.
  } catch (err) {
    // A real failure (expired/removed saved card, Paddle down, etc.) —
    // release the claim so the next spend can try again once the cooldown
    // above allows it, instead of waiting for a webhook that's never coming.
    await db.update(users).set({ autoRechargeInFlightAt: null }).where(eq(users.id, userId));
    throw err;
  }
}
