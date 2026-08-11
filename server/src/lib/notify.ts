import { db } from "../db";
import { notifications, users } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";

/**
 * Sends a real push notification via Expo's push API — no SDK needed, it's
 * a plain HTTPS endpoint that accepts an Expo push token (the kind
 * expo-notifications hands back on-device) and returns delivery receipts.
 * https://docs.expo.dev/push-notifications/sending-notifications/
 */
async function sendExpoPush(pushToken: string, title: string, body: string, data?: Record<string, unknown>): Promise<void> {
  try {
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ to: pushToken, title, body, data, sound: "default" }),
    });
    if (!res.ok) {
      console.error("Expo push send failed:", res.status, await res.text());
    }
  } catch (err) {
    console.error("Expo push send failed:", err);
  }
}

/**
 * Creates the in-app notification row and, if the user has a registered
 * device and hasn't disabled notifications, also sends a real push
 * notification. This is the single place all notification-triggering
 * routes should call through, so every notification type gets both for free.
 */
export async function notifyUser(userId: string, opts: { type: string; title: string; body: string; data?: Record<string, unknown> }): Promise<void> {
  await db.insert(notifications).values({ userId, type: opts.type, title: opts.title, body: opts.body, data: opts.data ?? {} });

  const [user] = await db.select({ pushToken: users.pushToken, notificationsEnabled: users.notificationsEnabled }).from(users).where(eq(users.id, userId));
  if (user?.pushToken && user.notificationsEnabled !== false) {
    await sendExpoPush(user.pushToken, opts.title, opts.body, opts.data);
  }
}

/** Same as notifyUser but for several recipients at once (still one DB round-trip for the notification rows). */
export async function notifyUsers(userIds: string[], opts: { type: string; title: string; body: string; data?: Record<string, unknown> }): Promise<void> {
  if (userIds.length === 0) return;
  await db.insert(notifications).values(userIds.map((userId) => ({ userId, type: opts.type, title: opts.title, body: opts.body, data: opts.data ?? {} })));

  const recipients = await db
    .select({ id: users.id, pushToken: users.pushToken, notificationsEnabled: users.notificationsEnabled })
    .from(users)
    .where(inArray(users.id, userIds));
  const byId = new Map(recipients.map((r) => [r.id, r]));
  await Promise.all(
    userIds.map((userId) => {
      const user = byId.get(userId);
      if (user?.pushToken && user.notificationsEnabled !== false) return sendExpoPush(user.pushToken, opts.title, opts.body, opts.data);
      return Promise.resolve();
    }),
  );
}
