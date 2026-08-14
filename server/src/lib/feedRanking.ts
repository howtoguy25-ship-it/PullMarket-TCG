// Fair, weighted rotation for boosted (paid) listings in the marketplace
// feed.
//
// The naive approach — "boosted listings first, sorted by createdAt" —
// means whoever bought the longest/most recent boost sits permanently at
// #1 for their entire window, burying every other paying seller for days.
// This module fixes that with two real, well-known techniques instead of
// an ad-hoc shuffle:
//
// 1. Weighted random ranking WITHOUT replacement (Efraimidis & Spirakis,
//    "Weighted random sampling with a reservoir", Information Processing
//    Letters, 2006 — the "A-Res" algorithm). Each boosted listing gets a
//    key = u^(1/weight), where u is a uniform random value and weight is
//    derived from how much the seller paid (sqrt-scaled, so a $200 boost
//    doesn't get 13x the visibility of a $15 boost — diminishing returns
//    keeps it fair). Sorting by key descending gives a random permutation
//    where higher-weight items are STATISTICALLY more likely to rank
//    higher, without ever guaranteeing a permanent #1.
// 2. The "random" draw is a deterministic hash of (listingId, rotation
//    window), not Math.random() — so the order is stable for a fixed
//    window (no listings reshuffling mid-scroll or between paginated
//    requests) but rotates to a fresh permutation every ROTATION_WINDOW_MS,
//    giving every boosted listing repeated real turns at the top over time.
//
// Boosted listings are then interleaved into real "sponsored slots" spaced
// through the feed (every SPONSORED_SLOT_INTERVAL positions) instead of
// dumped in one static block, cycling through the ranked boosted list —
// capped per-listing so a small boosted pool doesn't spam-repeat through a
// long feed.

export const ROTATION_WINDOW_MS = 15 * 60 * 1000; // boosted order refreshes every 15 minutes
export const SPONSORED_SLOT_INTERVAL = 6; // 1 in every 6 feed positions is a sponsored slot
export const MAX_APPEARANCES_PER_BOOST = 3; // a boosted listing repeats at most this many times per feed load
export const DEFAULT_BOOST_WEIGHT_PRICE_CENTS = 1500; // baseline weight for boosts with no purchase record (the free Pro 48h perk)

// FNV-1a — a standard, fast, well-distributed non-cryptographic string
// hash — normalized to a uniform value in [0, 1). Deterministic: same
// input always produces the same output, which is exactly what a stable
// per-rotation-window ranking needs.
export function hashToUnitInterval(input: string): number {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  return (hash >>> 0) / 4294967296; // 2^32, unsigned 32-bit range -> [0, 1)
}

export function boostWeight(priceCentsPaid: number): number {
  return Math.sqrt(Math.max(priceCentsPaid, 1));
}

export function rotationBucket(now: number = Date.now()): number {
  return Math.floor(now / ROTATION_WINDOW_MS);
}

// The A-Res weighted-random-sampling key for one listing in one rotation
// window. Sorting a set of listings by this key, descending, yields a
// proper weighted random permutation (Efraimidis & Spirakis, 2006).
export function weightedRotationKey(listingId: string, priceCentsPaid: number, now: number = Date.now()): number {
  const weight = boostWeight(priceCentsPaid);
  const u = Math.max(hashToUnitInterval(`${listingId}:${rotationBucket(now)}`), 1e-9);
  return Math.pow(u, 1 / weight);
}

export function rankBoostedListings<T extends { id: string; priceCentsPaid: number }>(boosted: T[], now: number = Date.now()): T[] {
  return [...boosted].sort((a, b) => weightedRotationKey(b.id, b.priceCentsPaid, now) - weightedRotationKey(a.id, a.priceCentsPaid, now));
}

// Weaves ranked boosted listings into the organic feed at real sponsored
// slots (positions 0, SPONSORED_SLOT_INTERVAL, 2*SPONSORED_SLOT_INTERVAL,
// ...), cycling through the boosted list so everyone keeps getting turns,
// capped per-listing so a tiny boosted pool doesn't repeat endlessly
// through a long feed. Falls back to plain organic order once there are no
// more organic items (a feed never runs longer than its real inventory) or
// once every boosted listing has hit its repeat cap.
export function interleaveBoostedListings<T extends { id: string }>(
  organicRanked: T[],
  boostedRanked: T[],
  opts: { slotInterval?: number; maxAppearancesPerBoost?: number } = {},
): T[] {
  const configuredInterval = opts.slotInterval ?? SPONSORED_SLOT_INTERVAL;
  const maxAppearancesPerBoost = opts.maxAppearancesPerBoost ?? MAX_APPEARANCES_PER_BOOST;
  if (boostedRanked.length === 0) return organicRanked;

  // The loop below stops once organic supply runs out (a feed never
  // outlasts its real inventory), which means every boosted listing needs
  // its first appearance to land BEFORE that point or it silently never
  // shows at all — a real bug if left at a fixed interval: e.g. 5 organic
  // items with a fixed every-6th-slot rule reserves exactly one sponsored
  // slot (position 0) and the organic supply is gone before position 6 is
  // ever reached, so only the single top-ranked boost ever appears no
  // matter how many listings paid for a boost. Shrinking the interval when
  // the organic pool is small guarantees every boosted listing gets at
  // least one real shot, while a large organic pool (the common case)
  // keeps the configured 1-in-N density untouched.
  const totalLength = organicRanked.length + boostedRanked.length;
  const slotInterval = Math.max(1, Math.min(configuredInterval, Math.floor(totalLength / boostedRanked.length)));

  const appearances = new Map<string, number>();
  const result: T[] = [];
  let organicIdx = 0;
  let cycleCursor = 0;

  while (organicIdx < organicRanked.length) {
    if (result.length % slotInterval === 0) {
      let placed = false;
      for (let attempt = 0; attempt < boostedRanked.length; attempt++) {
        const idx = (cycleCursor + attempt) % boostedRanked.length;
        const candidate = boostedRanked[idx];
        const count = appearances.get(candidate.id) ?? 0;
        if (count < maxAppearancesPerBoost) {
          result.push(candidate);
          appearances.set(candidate.id, count + 1);
          cycleCursor = idx + 1;
          placed = true;
          break;
        }
      }
      if (placed) continue;
    }
    result.push(organicRanked[organicIdx]);
    organicIdx++;
  }
  return result;
}
