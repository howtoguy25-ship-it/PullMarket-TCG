// Real, app-wide owner controls — a single database row every relevant
// route/lib checks before acting, not an in-memory flag that resets on
// deploy or only applies to one server instance. Short in-process cache
// (a few seconds) so a hot code path like routes/chat.ts doesn't add a
// query per message; a write from the owner panel invalidates it
// immediately so a toggle takes effect on the very next request.

import { eq } from "drizzle-orm";
import { db } from "../db";
import { ownerSettings, type reasoningEffortCapEnum } from "@shared/schema";

export type ReasoningEffortCap = (typeof reasoningEffortCapEnum.enumValues)[number];

export type OwnerSettingsRow = typeof ownerSettings.$inferSelect;

const SINGLETON_ID = "singleton";
const CACHE_MS = 5000;

let cached: { row: OwnerSettingsRow; at: number } | null = null;

export async function getOwnerSettings(): Promise<OwnerSettingsRow> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.row;

  let [row] = await db.select().from(ownerSettings).where(eq(ownerSettings.id, SINGLETON_ID));
  if (!row) {
    // First-ever read — create the singleton row with real defaults (every
    // toggle on, no reasoning cap) rather than requiring a manual seed step.
    [row] = await db.insert(ownerSettings).values({ id: SINGLETON_ID }).onConflictDoNothing().returning();
    if (!row) [row] = await db.select().from(ownerSettings).where(eq(ownerSettings.id, SINGLETON_ID));
  }
  cached = { row, at: Date.now() };
  return row;
}

export async function updateOwnerSettings(patch: Partial<Omit<OwnerSettingsRow, "id" | "updatedAt">>): Promise<OwnerSettingsRow> {
  await getOwnerSettings(); // ensures the singleton row exists before the update below
  const [row] = await db
    .update(ownerSettings)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(ownerSettings.id, SINGLETON_ID))
    .returning();
  cached = { row, at: Date.now() };
  return row;
}
