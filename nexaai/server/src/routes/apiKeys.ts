// Real developer API keys — generate one here, then use it to call
// routes/publicApi.ts from an external app (e.g. the user's own SiteSpark)
// without going through the OAuth connector flow. The raw key is shown
// exactly once, at creation; only a bcrypt hash is ever stored (same
// principle as password storage), plus a short prefix so a user can tell
// their keys apart in a list without ever seeing the full value again.

import { Router } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { eq, and, desc, isNull } from "drizzle-orm";
import { db } from "../db";
import { apiKeys } from "@shared/schema";
import { requireAuth, type AuthedRequest } from "../middleware/auth";

export const apiKeysRouter = Router();
apiKeysRouter.use(requireAuth);

function generateRawKey(): string {
  return `nxa_${crypto.randomBytes(24).toString("base64url")}`;
}

apiKeysRouter.get("/", async (req: AuthedRequest, res) => {
  const rows = await db
    .select({ id: apiKeys.id, label: apiKeys.label, keyPrefix: apiKeys.keyPrefix, createdAt: apiKeys.createdAt, lastUsedAt: apiKeys.lastUsedAt, revokedAt: apiKeys.revokedAt })
    .from(apiKeys)
    .where(eq(apiKeys.userId, req.userId!))
    .orderBy(desc(apiKeys.createdAt));
  res.json({ apiKeys: rows });
});

const createSchema = z.object({ label: z.string().min(1).max(80) });
apiKeysRouter.post("/", async (req: AuthedRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const rawKey = generateRawKey();
  const keyHash = await bcrypt.hash(rawKey, 10);
  const [row] = await db
    .insert(apiKeys)
    .values({ userId: req.userId!, label: parsed.data.label, keyPrefix: rawKey.slice(0, 12), keyHash })
    .returning({ id: apiKeys.id, label: apiKeys.label, keyPrefix: apiKeys.keyPrefix, createdAt: apiKeys.createdAt });

  // rawKey is returned ONLY in this one response — it is never retrievable again.
  res.status(201).json({ apiKey: row, rawKey });
});

apiKeysRouter.delete("/:id", async (req: AuthedRequest, res) => {
  const [updated] = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, req.params.id), eq(apiKeys.userId, req.userId!), isNull(apiKeys.revokedAt)))
    .returning();
  if (!updated) return res.status(404).json({ error: "Key not found or already revoked" });
  res.status(204).end();
});
