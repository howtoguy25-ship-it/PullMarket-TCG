// JustTCG (justtcg.com) — third-party TCG market-price aggregator. Chosen
// because TCGPlayer closed its own API to new developers in late 2024, and
// JustTCG is one of the few alternatives covering both Pokémon and One
// Piece TCG from a single provider. Requires a PAID plan for commercial use
// (their terms: any product shown to other people needs a paid plan,
// regardless of request volume) — the free tier is personal/prototyping use
// only. Prices here are volume-weighted market averages, not literal
// "lowest sold for" figures, so they're always labeled "Market price" to
// stay accurate to what the data actually represents.
const BASE_URL = "https://api.justtcg.com/v1";

export function isJustTcgConfigured(): boolean {
  return !!process.env.JUSTTCG_API_KEY;
}

function headers(): Record<string, string> {
  return { "x-api-key": process.env.JUSTTCG_API_KEY! };
}

interface JustTcgPriceHistoryPoint {
  p: number;
  t: number;
}

interface JustTcgVariant {
  id: string;
  printing: string;
  condition: string;
  price: number;
  priceChange24hr?: number;
  lastUpdated: number;
  priceHistory?: JustTcgPriceHistoryPoint[];
  priceChange7d?: number;
  priceChange30d?: number;
  minPriceAllTime?: number;
  maxPriceAllTime?: number;
}

interface JustTcgCard {
  id: string;
  uuid: string;
  name: string;
  game: string;
  set: string;
  set_name: string;
  number?: string;
  rarity?: string;
  tcgplayerId?: string;
  variants: JustTcgVariant[];
}

interface JustTcgCardsResponse {
  data: JustTcgCard[];
  meta: { total: number; limit: number; offset: number; hasMore: boolean };
}

interface JustTcgGame {
  id: string;
  name: string;
}

// The exact game-id slugs JustTCG uses aren't documented anywhere stable,
// so these are resolved dynamically from /games (matched by name) rather
// than hardcoded — avoids silently breaking if their slugs ever differ
// from the obvious guess. Cached for the life of the process; the game
// list itself essentially never changes.
let gameIdCache: { pokemon: string | null; onePiece: string | null } | null = null;

async function resolveGameIds(): Promise<{ pokemon: string | null; onePiece: string | null }> {
  if (gameIdCache) return gameIdCache;
  const res = await fetch(`${BASE_URL}/games`, { headers: headers() });
  if (!res.ok) throw new Error(`JustTCG /games failed: ${res.status}`);
  const body = (await res.json()) as { data: JustTcgGame[] };
  const pokemon = body.data.find((g) => /pok[eé]mon/i.test(g.name))?.id ?? null;
  const onePiece = body.data.find((g) => /one\s*piece/i.test(g.name))?.id ?? null;
  gameIdCache = { pokemon, onePiece };
  return gameIdCache;
}

export interface PriceCardResult {
  id: string;
  name: string;
  setName: string;
  number: string | null;
  rarity: string | null;
  marketPriceCents: number | null;
  priceChange24hr: number | null;
  lastUpdated: number | null;
  imageUrl: string | null;
}

function normalizeCard(card: JustTcgCard): PriceCardResult {
  // Prefer a "Near Mint" / "Normal" printing variant as the headline price
  // (most representative of what a buyer actually pays), falling back to
  // whichever variant comes first if that exact combination isn't present.
  const variant =
    card.variants.find((v) => /near ?mint/i.test(v.condition) && /normal/i.test(v.printing)) ??
    card.variants.find((v) => /near ?mint/i.test(v.condition)) ??
    card.variants[0];

  return {
    id: card.uuid || card.id,
    name: card.name,
    setName: card.set_name,
    number: card.number ?? null,
    rarity: card.rarity ?? null,
    marketPriceCents: variant ? Math.round(variant.price * 100) : null,
    priceChange24hr: variant?.priceChange24hr ?? null,
    lastUpdated: variant?.lastUpdated ?? null,
    // JustTCG's own card data has no image field, but it does carry the
    // matching TCGplayer product id, which resolves to a real product
    // photo on TCGplayer's own image CDN (verified directly: a known id
    // returns the actual booster-box/card photo, a bogus one 403s) —
    // the client treats a failed load as "no image" rather than erroring.
    imageUrl: card.tcgplayerId ? `https://tcgplayer-cdn.tcgplayer.com/product/${card.tcgplayerId}_200w.jpg` : null,
  };
}

export async function browseCards(franchise: "pokemon" | "one_piece", offset: number, limit: number): Promise<{ cards: PriceCardResult[]; total: number; hasMore: boolean }> {
  const ids = await resolveGameIds();
  const gameId = franchise === "pokemon" ? ids.pokemon : ids.onePiece;
  if (!gameId) throw new Error(`JustTCG doesn't currently list a "${franchise}" game`);

  const params = new URLSearchParams({ game: gameId, limit: String(limit), offset: String(offset) });
  const res = await fetch(`${BASE_URL}/cards?${params}`, { headers: headers() });
  if (!res.ok) throw new Error(`JustTCG /cards failed: ${res.status} ${await res.text().catch(() => "")}`);
  const body = (await res.json()) as JustTcgCardsResponse;

  return { cards: body.data.map(normalizeCard), total: body.meta.total, hasMore: body.meta.hasMore };
}

export interface PriceHistoryPoint {
  priceCents: number;
  date: string; // ISO 8601, converted from JustTCG's unix-seconds "t"
}

export interface CardPriceHistory {
  cardName: string;
  setName: string;
  matchedVariant: { condition: string; printing: string };
  marketPriceCents: number;
  priceChange7dPct: number | null;
  priceChange30dPct: number | null;
  minPriceAllTimeCents: number | null;
  maxPriceAllTimeCents: number | null;
  history: PriceHistoryPoint[];
  imageUrl: string | null;
}

// A marketplace listing's title is free text a seller typed ("PSA 7
// CHARIZARD GOLD STAR - 100/101 - POKEMON 2006 EX DRAGON FRONTIERS"), not a
// stable card id — so finding its real market chart means searching
// JustTCG's card names for the closest match rather than a direct lookup.
// This is inherently best-effort (grading/condition/set details in a
// listing title aren't guaranteed to isolate one exact card), which is why
// the API response is explicit about which card/variant it actually
// matched, and the client labels this as a reference chart rather than
// implying it's this exact physical card's own price history.
//
// JustTCG's search (verified live) is a fairly literal substring match, not
// a fuzzy/relevance search — querying its full cleaned title ("Charizard
// Gold Star Dragon Frontiers") reliably returns zero results, while just
// "Charizard Gold Star" matches. So rather than guess one "right" amount of
// truncation, this returns several candidate queries from most to least
// specific (full cleaned phrase down to just the first couple of words),
// and the caller tries each until one actually returns a card.
function candidateSearchQueries(title: string): string[] {
  const cleaned = title
    .replace(/\b(PSA|BGS|CGC|SGC)\s*[\d.]+\b/gi, "")
    .replace(/\bGEM\s*MT\s*\d+\b/gi, "")
    .replace(/\b\d+\/\d+\b/g, "")
    .replace(/\b(pokemon|pok[eé]mon|one\s*piece)\b/gi, "")
    .replace(/\b(19|20)\d{2}\b/g, "") // release years add noise, not signal
    .replace(/[-–—|.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return [];

  // Capped at 6 words to start: a real card name is almost never longer
  // than that, and every extra word beyond it in a listing title tends to
  // be rarity/set noise that actively hurts JustTCG's literal matching —
  // capping also bounds this to at most 5 API calls per (game, listing).
  const words = cleaned.split(" ").slice(0, 6);
  const queries: string[] = [];
  for (let take = words.length; take >= Math.min(2, words.length); take--) {
    const q = words.slice(0, take).join(" ");
    if (!queries.includes(q)) queries.push(q);
  }
  return queries;
}

export async function findPriceHistoryForListing(franchise: "pokemon" | "one_piece" | "both", title: string): Promise<CardPriceHistory | null> {
  const ids = await resolveGameIds();
  const candidateGameIds = franchise === "both" ? [ids.pokemon, ids.onePiece] : [franchise === "pokemon" ? ids.pokemon : ids.onePiece];
  const queries = candidateSearchQueries(title);
  if (queries.length === 0) return null;

  for (const gameId of candidateGameIds) {
    if (!gameId) continue;
    for (const q of queries) {
      const params = new URLSearchParams({ game: gameId, q, limit: "1" });
      const res = await fetch(`${BASE_URL}/cards?${params}`, { headers: headers() });
      if (!res.ok) continue;
      const body = (await res.json()) as JustTcgCardsResponse;
      const card = body.data[0];
      if (!card) continue;

      const variant =
        card.variants.find((v) => /near ?mint/i.test(v.condition) && /normal/i.test(v.printing)) ??
        card.variants.find((v) => /near ?mint/i.test(v.condition)) ??
        card.variants[0];
      if (!variant) continue;

      return {
        cardName: card.name,
        setName: card.set_name,
        matchedVariant: { condition: variant.condition, printing: variant.printing },
        marketPriceCents: Math.round(variant.price * 100),
        priceChange7dPct: variant.priceChange7d ?? null,
        priceChange30dPct: variant.priceChange30d ?? null,
        minPriceAllTimeCents: variant.minPriceAllTime != null ? Math.round(variant.minPriceAllTime * 100) : null,
        maxPriceAllTimeCents: variant.maxPriceAllTime != null ? Math.round(variant.maxPriceAllTime * 100) : null,
        history: (variant.priceHistory ?? []).map((p) => ({ priceCents: Math.round(p.p * 100), date: new Date(p.t * 1000).toISOString() })),
        imageUrl: card.tcgplayerId ? `https://tcgplayer-cdn.tcgplayer.com/product/${card.tcgplayerId}_200w.jpg` : null,
      };
    }
  }

  return null;
}
