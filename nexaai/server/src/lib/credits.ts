import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { creditTransactions } from "@shared/schema";
import { GRACE_OVERAGE_CENTS } from "./plans";

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

  await db.insert(creditTransactions).values({
    userId,
    kind: "usage",
    amountCents: -costCents,
    note,
  });

  return { allowed: true, balanceAfterCents: balanceAfter, usedGraceOverage };
}

export async function grantCredits(
  db: NodePgDatabase<Record<string, unknown>>,
  userId: string,
  amountCents: number,
  opts: { kind: "purchase" | "trial_grant" | "refund" | "adjustment"; packLabel?: string; paymentProvider?: string; providerReference?: string; note?: string },
) {
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
