import { Router } from "express";
import { z } from "zod";
import { isJustTcgConfigured, browseCards, findPriceHistoryForListing, type PriceCardResult, type CardPriceHistory } from "../lib/justtcg";
import { getUsdToAudRate } from "../lib/fx";

const router = Router();

export interface PriceCardWithAud extends PriceCardResult {
  marketPriceAudCents: number | null;
}

// Short in-memory cache per (franchise, offset, limit) — prices don't
// meaningfully change minute to minute for this UI, and this keeps many
// users browsing the same pages from each burning a separate call against
// JustTCG's daily request quota. Stored in the original USD form from
// JustTCG; the AUD conversion is applied fresh on every response using
// whatever the current live FX rate is (that rate has its own, separate
// cache in lib/fx.ts) so a stale price cache never serves a stale rate.
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; data: { cards: PriceCardResult[]; total: number; hasMore: boolean } }>();

function withAud(cards: PriceCardResult[], usdToAud: number): PriceCardWithAud[] {
  return cards.map((card) => ({
    ...card,
    marketPriceAudCents: card.marketPriceCents != null ? Math.round(card.marketPriceCents * usdToAud) : null,
  }));
}

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

  try {
    const usdToAud = await getUsdToAudRate();
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return res.json({ ...cached.data, cards: withAud(cached.data.cards, usdToAud), fxRateUsdToAud: usdToAud });
    }
    const result = await browseCards(franchise, offset, limit);
    cache.set(cacheKey, { at: Date.now(), data: result });
    res.json({ ...result, cards: withAud(result.cards, usdToAud), fxRateUsdToAud: usdToAud });
  } catch (err) {
    console.error("JustTCG price lookup failed:", err);
    res.status(502).json({ message: "Couldn't reach the live price service — try again shortly." });
  }
});

export interface CardPriceHistoryWithAud extends CardPriceHistory {
  marketPriceAudCents: number;
  minPriceAllTimeAudCents: number | null;
  maxPriceAllTimeAudCents: number | null;
  history: (CardPriceHistory["history"][number] & { priceAudCents: number })[];
}

// Keyed by (franchise, listing title) rather than listing id — a re-edited
// listing title should re-match rather than serve a stale card forever,
// and this also means two different listings for the same real card share
// one JustTCG lookup instead of each burning their own. 1h TTL: the chart
// itself is daily-granularity price history, so there's no value in
// re-fetching more often than that, and it keeps this well within
// JustTCG's request quota even on a busy listings page.
const HISTORY_CACHE_TTL_MS = 60 * 60 * 1000;
const historyCache = new Map<string, { at: number; data: CardPriceHistory | null }>();

// Resolves (and caches) the matched card for a listing, without the AUD
// conversion or HTTP response shaping the /match route adds — shared so a
// new listing can be analyzed once at creation time (see
// warmPriceMatchCache below) instead of every viewer's first load paying
// for a cold multi-query JustTCG search.
async function resolveAndCache(franchise: "pokemon" | "one_piece" | "both", title: string): Promise<CardPriceHistory | null> {
  const cacheKey = `${franchise}:${title.toLowerCase()}`;
  const cached = historyCache.get(cacheKey);
  if (cached && Date.now() - cached.at < HISTORY_CACHE_TTL_MS) return cached.data;
  const data = await findPriceHistoryForListing(franchise, title);
  historyCache.set(cacheKey, { at: Date.now(), data });
  return data;
}

// Fire-and-forget: called right after a listing is created so the real
// card analysis (name/set/rarity matching against JustTCG's catalog) has
// already run and is sitting warm in the cache by the time a buyer opens
// the listing — instead of them waiting out a several-second cold search.
// Never throws into the caller: a failed/slow analysis here just means the
// chart resolves lazily on first view instead, same as before this existed.
export function warmPriceMatchCache(franchise: "pokemon" | "one_piece" | "both", title: string): void {
  if (!isJustTcgConfigured()) return;
  resolveAndCache(franchise, title).catch(() => {});
}

router.get("/match", async (req, res) => {
  if (!isJustTcgConfigured()) {
    return res.status(503).json({ message: "Live card prices aren't configured yet. Set JUSTTCG_API_KEY (see .env.example)." });
  }

  const parsed = z
    .object({
      franchise: z.enum(["pokemon", "one_piece", "both"]),
      title: z.string().trim().min(1).max(300),
    })
    .safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid request" });
  const { franchise, title } = parsed.data;

  try {
    const usdToAud = await getUsdToAudRate();
    const data = await resolveAndCache(franchise, title);

    if (!data) return res.json({ match: null });

    const result: CardPriceHistoryWithAud = {
      ...data,
      marketPriceAudCents: Math.round(data.marketPriceCents * usdToAud),
      minPriceAllTimeAudCents: data.minPriceAllTimeCents != null ? Math.round(data.minPriceAllTimeCents * usdToAud) : null,
      maxPriceAllTimeAudCents: data.maxPriceAllTimeCents != null ? Math.round(data.maxPriceAllTimeCents * usdToAud) : null,
      history: data.history.map((p) => ({ ...p, priceAudCents: Math.round(p.priceCents * usdToAud) })),
    };
    res.json({ match: result });
  } catch (err) {
    console.error("JustTCG price-history lookup failed:", err);
    res.status(502).json({ message: "Couldn't reach the live price service — try again shortly." });
  }
});

export default router;
