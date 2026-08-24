import { db } from "../db";
import { stories } from "@shared/schema";
import { lte } from "drizzle-orm";
import { deleteUploadedFile } from "./upload";

const SWEEP_INTERVAL_MS = 15 * 60 * 1000; // every 15 minutes

/** Every story read is already filtered on expiresAt, so an expired story
 * is invisible the instant it expires regardless of this sweep — this just
 * reclaims the now-pointless row and its uploaded media file afterward. */
export async function sweepExpiredStories(): Promise<void> {
  const expired = await db.select({ id: stories.id, mediaUrl: stories.mediaUrl }).from(stories).where(lte(stories.expiresAt, new Date()));
  if (expired.length === 0) return;

  await db.delete(stories).where(lte(stories.expiresAt, new Date()));
  await Promise.all(expired.map((s) => deleteUploadedFile(s.mediaUrl)));
}

export function startStoryExpiryScheduler(): void {
  sweepExpiredStories().catch((err) => console.error("Story expiry sweep failed:", err));
  setInterval(() => {
    sweepExpiredStories().catch((err) => console.error("Story expiry sweep failed:", err));
  }, SWEEP_INTERVAL_MS);
}
