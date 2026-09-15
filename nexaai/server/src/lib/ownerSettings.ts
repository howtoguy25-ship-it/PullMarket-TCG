// Real, single-row app-wide control panel backing the owner panel's "AI
// Controls" tab — the actual table every relevant route/lib re-checks
// alongside a user's own per-account capability toggle (never instead of
// it — see schema.ts's ownerSettings comment). A short in-process cache
// avoids a DB round trip on every chat/voice/agent/memory call, since these
// values change rarely and reading them is on the hot path.

import { eq } from "drizzle-orm";
import { db } from "../db";
import { ownerSettings, type reasoningEffortCapEnum } from "@shared/schema";

export type ReasoningEffortCap = (typeof reasoningEffortCapEnum.enumValues)[number];
export type OwnerSettingsRow = typeof ownerSettings.$inferSelect;

const SINGLETON_ID = "singleton";
const CACHE_TTL_MS = 5000;

let cached: { row: OwnerSettingsRow; expiresAt: number } | null = null;

export async function getOwnerSettings(): Promise<OwnerSettingsRow> {
  if (cached && cached.expiresAt > Date.now()) return cached.row;

  let [row] = await db.select().from(ownerSettings).where(eq(ownerSettings.id, SINGLETON_ID));
  if (!row) {
    // First read ever — create the singleton row with defaults. A racing
    // concurrent request doing the same insert is fine: onConflictDoNothing
    // means only one insert wins, and we re-select either way.
    await db.insert(ownerSettings).values({ id: SINGLETON_ID }).onConflictDoNothing();
    [row] = await db.select().from(ownerSettings).where(eq(ownerSettings.id, SINGLETON_ID));
  }

  cached = { row, expiresAt: Date.now() + CACHE_TTL_MS };
  return row;
}

export async function updateOwnerSettings(patch: Partial<Omit<OwnerSettingsRow, "id" | "updatedAt">>): Promise<OwnerSettingsRow> {
  // Ensure the singleton row exists before updating it (same first-write path as getOwnerSettings).
  await getOwnerSettings();
  const [row] = await db
    .update(ownerSettings)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(ownerSettings.id, SINGLETON_ID))
    .returning();
  cached = { row, expiresAt: Date.now() + CACHE_TTL_MS };
  return row;
}
