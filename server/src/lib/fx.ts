// Live USD → AUD conversion for JustTCG prices (which are USD-only) since
// this marketplace's audience is Australian. Two independent, keyless rate
// providers — if the primary is down or rate-limited, the second still
// gives a real live rate rather than silently falling back to a hardcoded
// number, which would drift from reality over time.
const CACHE_TTL_MS = 60 * 60 * 1000; // rates don't move meaningfully more than once an hour for this UI
let cache: { at: number; rate: number } | null = null;

async function fetchFrankfurter(): Promise<number> {
  const res = await fetch("https://api.frankfurter.app/latest?from=USD&to=AUD");
  if (!res.ok) throw new Error(`frankfurter.app failed: ${res.status}`);
  const body = (await res.json()) as { rates: { AUD: number } };
  const rate = body.rates?.AUD;
  if (!rate || !Number.isFinite(rate)) throw new Error("frankfurter.app returned no AUD rate");
  return rate;
}

async function fetchExchangeRateApi(): Promise<number> {
  const res = await fetch("https://open.er-api.com/v6/latest/USD");
  if (!res.ok) throw new Error(`open.er-api.com failed: ${res.status}`);
  const body = (await res.json()) as { result: string; rates: Record<string, number> };
  const rate = body.rates?.AUD;
  if (body.result !== "success" || !rate || !Number.isFinite(rate)) throw new Error("open.er-api.com returned no AUD rate");
  return rate;
}

export async function getUsdToAudRate(): Promise<number> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.rate;
  try {
    const rate = await fetchFrankfurter();
    cache = { at: Date.now(), rate };
    return rate;
  } catch (err) {
    console.error("Primary FX provider (frankfurter.app) failed, trying fallback:", err);
  }
  try {
    const rate = await fetchExchangeRateApi();
    cache = { at: Date.now(), rate };
    return rate;
  } catch (err) {
    console.error("Fallback FX provider (open.er-api.com) also failed:", err);
    // Both live providers are unreachable right now. If we have any
    // previously-cached rate (even if past TTL) it's still a real live
    // rate from earlier and closer to reality than nothing — only give up
    // and let the caller decide how to handle it if we've truly never
    // fetched one.
    if (cache) return cache.rate;
    throw new Error("Could not fetch a live USD→AUD rate from any provider");
  }
}
