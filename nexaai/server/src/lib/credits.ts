import { eq, and, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { creditTransactions } from "@shared/schema";
import { GRACE_OVERAGE_CENTS } from "./plans";
import { maybeAutoRecharge } from "./autoRecharge";

export async function getCreditBalanceCents(
  db: NodePgDatabase<Record<string, unknown>>,
  userId: string,
): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${creditTransactions.amountCents}), 0)` })
    .from(creditTransactions)
    .where(eq(creditTransactions.userId, userId));
  return row?.total ?? 0;
}

export interface SpendResult {
  allowed: boolean;
  balanceAfterCents: number;
  usedGraceOverage: boolean;
  reason?: "insufficient_credit";
  /** The real ledger row this spend created — null when the spend was disallowed. Callers (routes/chat.ts) use this to link the transaction to the exact message it charged for (creditTransactions.messageId) and to auto-refund it if the turn ends up failing after payment. */
  transactionId?: string;
}

/**
 * Attempts to spend `costCents` of credit. If the balance can't fully cover
 * it, allows the spend to dip up to $1 (GRACE_OVERAGE_CENTS) into the red —
 * "if credit usage finished a day bot still after in tact then use upto $1
 * more then immediately pause the session" — and flags the caller to pause
 * the session right after.
 */
export async function spendCredits(
  db: NodePgDatabase<Record<string, unknown>>,
  userId: string,
  costCents: number,
  note: string,
): Promise<SpendResult> {
  const balance = await getCreditBalanceCents(db, userId);
  if (balance <= -GRACE_OVERAGE_CENTS) {
    return { allowed: false, balanceAfterCents: balance, usedGraceOverage: false, reason: "insufficient_credit" };
  }

  const balanceAfter = balance - costCents;
  const usedGraceOverage = balance >= 0 && balanceAfter < 0;

  const [row] = await db
    .insert(creditTransactions)
    .values({
      userId,
      kind: "usage",
      amountCents: -costCents,
      note,
    })
    .returning({ id: creditTransactions.id });

  maybeAutoRecharge(db, userId, balanceAfter);
  return { allowed: true, balanceAfterCents: balanceAfter, usedGraceOverage, transactionId: row.id };
}

/** Real link from a spend to the exact message it charged for — set right after that message row exists, since spendCredits necessarily runs before it (routes/chat.ts's prepareTurn checks affordability before writing anything). Everything the dispute system and the auto-refund-on-failure path key off depends on this having run. */
export async function linkTransactionToMessage(db: NodePgDatabase<Record<string, unknown>>, transactionId: string, messageId: string) {
  await db.update(creditTransactions).set({ messageId }).where(eq(creditTransactions.id, transactionId));
}

export async function grantCredits(
  db: NodePgDatabase<Record<string, unknown>>,
  userId: string,
  amountCents: number,
  opts: { kind: "purchase" | "trial_grant" | "refund" | "adjustment"; packLabel?: string; paymentProvider?: string; providerReference?: string; note?: string },
) {
  // Idempotency guard: a Paddle webhook can be redelivered, and an Apple
  // purchase can be re-verified (a restore, or the client retrying after a
  // dropped response) — dedup by providerReference so the same real-world
  // purchase never grants credit twice.
  if (opts.providerReference) {
    const [existing] = await db
      .select({ id: creditTransactions.id })
      .from(creditTransactions)
      .where(and(eq(creditTransactions.userId, userId), eq(creditTransactions.providerReference, opts.providerReference)));
    if (existing) return;
  }

  await db.insert(creditTransactions).values({
    userId,
    kind: opts.kind,
    amountCents,
    packLabel: opts.packLabel,
    paymentProvider: opts.paymentProvider,
    providerReference: opts.providerReference,
    note: opts.note,
  });
}
