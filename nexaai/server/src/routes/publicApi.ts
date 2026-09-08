// Real external API, secured by the developer keys issued in
// routes/apiKeys.ts — this is what an app the user builds separately (e.g.
// their own SiteSpark) actually calls to ask NexaAi something, without a
// human ever going through the app's own login. Deliberately minimal: one
// endpoint, text in, text out, billed against the calling user's own plan
// and credit balance exactly like a normal chat message.

import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "../db";
import { apiKeys, users } from "@shared/schema";
import { askModel } from "../lib/modelRouter";
import { PLAN_DEFINITIONS } from "../lib/plans";
import { spendCredits } from "../lib/credits";

export const publicApiRouter = Router();

const CENTS_PER_PUBLIC_API_CALL = 2;

async function authenticateApiKey(rawKey: string | undefined): Promise<{ userId: string; keyId: string } | null> {
  if (!rawKey || !rawKey.startsWith("nxa_")) return null;
  const prefix = rawKey.slice(0, 12);
  const candidates = await db.select().from(apiKeys).where(and(eq(apiKeys.keyPrefix, prefix), isNull(apiKeys.revokedAt)));
  for (const candidate of candidates) {
    if (await bcrypt.compare(rawKey, candidate.keyHash)) {
      db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, candidate.id)).catch(() => {}); // best-effort, don't block the request
      return { userId: candidate.userId, keyId: candidate.id };
    }
  }
  return null;
}

const generateSchema = z.object({
  prompt: z.string().min(1).max(8000),
});

publicApiRouter.post("/generate", async (req, res) => {
  const auth = await authenticateApiKey(req.header("x-api-key"));
  if (!auth) return res.status(401).json({ error: "invalid_api_key", message: "Missing or invalid x-api-key header." });

  const parsed = generateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const [user] = await db.select().from(users).where(eq(users.id, auth.userId));
  if (!user) return res.status(404).json({ error: "User not found" });

  const spend = await spendCredits(db, auth.userId, CENTS_PER_PUBLIC_API_CALL, "api:generate");
  if (!spend.allowed) return res.status(402).json({ error: "insufficient_credit", message: "This account is out of credit." });

  const result = await askModel({
    plan: PLAN_DEFINITIONS[user.planTier],
    answerCount: 1,
    userMessage: parsed.data.prompt,
    history: [],
    mode: "chat",
    focusMode: "quick",
  });

  res.json({ text: result.text, creditBalanceAfterCents: spend.balanceAfterCents });
});
