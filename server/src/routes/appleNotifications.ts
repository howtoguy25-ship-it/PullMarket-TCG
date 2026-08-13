import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { verifyAppleNotification, verifyAppleTransaction, isAppleTransactionActive } from "../lib/appleSubscription";

const router = Router();

// App Store Server Notifications V2 — Apple calls this directly (no user
// session, no CSRF token to check: authenticity comes entirely from the
// signedPayload's JWS signature, verified against Apple's own root cert).
// Configure this URL in App Store Connect once Apple IAP is set up:
// Users and Access > Integrations > App Store Server Notifications >
// Production/Sandbox URL = https://<your-domain>/api/apple/notifications
router.post("/notifications", async (req, res) => {
  const schema = z.object({ signedPayload: z.string() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });

  let notification;
  try {
    notification = await verifyAppleNotification(parsed.data.signedPayload);
  } catch (err) {
    console.error("Apple notification verification failed:", err);
    return res.status(400).json({ error: "Invalid signature" });
  }

  const signedTransaction = notification.data?.signedTransactionInfo;
  if (!signedTransaction) return res.json({ received: true });

  try {
    const transaction = await verifyAppleTransaction(signedTransaction);
    if (!transaction.originalTransactionId) return res.json({ received: true });

    const active = isAppleTransactionActive(transaction);
    await db
      .update(users)
      .set({
        proStatus: active ? "active" : "canceled",
        proSource: "apple",
        proCurrentPeriodEnd: transaction.expiresDate ? new Date(transaction.expiresDate) : null,
      })
      .where(eq(users.proAppleOriginalTransactionId, transaction.originalTransactionId));
  } catch (err) {
    console.error("Apple notification transaction handling failed:", err);
  }

  res.json({ received: true });
});

export default router;
