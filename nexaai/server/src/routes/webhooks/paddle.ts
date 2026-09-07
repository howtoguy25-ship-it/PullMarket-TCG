import { Router } from "express";
import crypto from "crypto";
import { CREDIT_PACKS } from "../../lib/plans";
import { fulfillCreditPurchase } from "../credits";

export const paddleWebhookRouter = Router();

// Verifies Paddle's webhook signature (HMAC-SHA256 of "ts:body" using your
// Paddle notification secret) before trusting the payload — same shape as
// verifying a real Stripe webhook signature. Set PADDLE_WEBHOOK_SECRET from
// Paddle Dashboard -> Developer Tools -> Notifications.
function verifySignature(rawBody: string, signatureHeader: string | undefined): boolean {
  if (!process.env.PADDLE_WEBHOOK_SECRET || !signatureHeader) return false;
  const parts = Object.fromEntries(signatureHeader.split(";").map((kv) => kv.split("=") as [string, string]));
  if (!parts.ts || !parts.h1) return false;
  const expected = crypto
    .createHmac("sha256", process.env.PADDLE_WEBHOOK_SECRET)
    .update(`${parts.ts}:${rawBody}`)
    .digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.h1));
}

paddleWebhookRouter.post("/", async (req, res) => {
  const rawBody = JSON.stringify(req.body);
  if (!verifySignature(rawBody, req.header("Paddle-Signature"))) {
    return res.status(401).json({ error: "Invalid or missing Paddle-Signature" });
  }

  const event = req.body as {
    event_type: string;
    data: { id: string; custom_data?: { nexaaiUserId?: string; packLabel?: string } };
  };

  if (event.event_type === "transaction.completed" && event.data.custom_data?.nexaaiUserId) {
    const userId = event.data.custom_data.nexaaiUserId;
    const packLabel = event.data.custom_data.packLabel ?? "Custom";
    const pack = CREDIT_PACKS.find((p) => p.label === packLabel);
    await fulfillCreditPurchase(userId, pack?.priceCents ?? 0, pack?.bonusCents ?? 0, packLabel, event.data.id);
  }

  res.json({ received: true });
});
