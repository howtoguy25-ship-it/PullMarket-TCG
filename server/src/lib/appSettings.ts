import { db } from "../db";
import { appSettings } from "@shared/schema";
import { eq } from "drizzle-orm";

const SETTINGS_ROW_ID = "global";

async function ensureRow() {
  await db.insert(appSettings).values({ id: SETTINGS_ROW_ID }).onConflictDoNothing();
}

export async function isReviewBypassEnabled(): Promise<boolean> {
  await ensureRow();
  const [row] = await db.select({ reviewBypassEnabled: appSettings.reviewBypassEnabled }).from(appSettings).where(eq(appSettings.id, SETTINGS_ROW_ID));
  return row?.reviewBypassEnabled ?? true;
}

export async function setReviewBypassEnabled(enabled: boolean): Promise<boolean> {
  await ensureRow();
  const [row] = await db
    .update(appSettings)
    .set({ reviewBypassEnabled: enabled })
    .where(eq(appSettings.id, SETTINGS_ROW_ID))
    .returning({ reviewBypassEnabled: appSettings.reviewBypassEnabled });
  return row.reviewBypassEnabled;
}
