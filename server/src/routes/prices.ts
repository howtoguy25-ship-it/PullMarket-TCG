import { Router } from "express";
import { z } from "zod";
import { isJustTcgConfigured, browseCards, type PriceCardResult } from "../lib/justtcg";

const router = Router();

// Short in-memory cache per (franchise, offset, limit) — prices don't
// meaningfully change minute to minute for this UI, and this keeps many
// users browsing the same pages from each burning a separate call against
// JustTCG's daily request quota.
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; data: { cards: PriceCardResult[]; total: number; hasMore: boolean } }>();

router.get("/status", (_req, res) => {
  res.json({ configured: isJustTcgConfigured() });
});

router.get("/", async (req, res) => {
  if (!isJustTcgConfigured()) {
    return res.status(503).json({ message: "Live card prices aren't configured yet. Set JUSTTCG_API_KEY (see .env.example)." });
  }

  const parsed = z
    .object({
      franchise: z.enum(["pokemon", "one_piece"]),
      offset: z.coerce.number().int().min(0).default(0),
      limit: z.coerce.number().int().min(1).max(100).default(40),
    })
    .safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid request" });
  const { franchise, offset, limit } = parsed.data;

  const cacheKey = `${franchise}:${offset}:${limit}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return res.json(cached.data);
  }

  try {
    const result = await browseCards(franchise, offset, limit);
    cache.set(cacheKey, { at: Date.now(), data: result });
    res.json(result);
  } catch (err) {
    console.error("JustTCG price lookup failed:", err);
    res.status(502).json({ message: "Couldn't reach the live price service — try again shortly." });
  }
});

export default router;
