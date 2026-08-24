// Real eBay-sourced inventory via eBay's Buy Browse API, surfaced alongside
// this marketplace's own user listings and monetized through eBay Partner
// Network (EPN) affiliate links — a buyer who taps "Buy on eBay" checks out
// entirely on eBay's own systems; this app never touches that payment, and
// EPN pays a commission separately (see partnernetwork.ebay.com), on its
// own schedule, once a real Campaign ID is approved and set.
import { db } from "../db";
import { ebayListings } from "@shared/schema";
import { eq, lt, sql } from "drizzle-orm";

const OAUTH_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const BROWSE_URL = "https://api.ebay.com/buy/browse/v1/item_summary/search";

// "CCG Individual Cards" — the single eBay category that carries both
// Pokémon and One Piece TCG singles (confirmed live via the Taxonomy API);
// franchise is picked out by keyword within it, not a separate category id.
const CCG_INDIVIDUAL_CARDS_CATEGORY_ID = "183454";

const FRANCHISE_QUERIES: Record<"pokemon" | "one_piece", string[]> = {
  pokemon: ["pokemon card", "pokemon card psa", "charizard pokemon card", "pikachu pokemon card"],
  one_piece: ["one piece card game", "one piece tcg psa", "luffy one piece card", "one piece card game op"],
};

export function isEbayConfigured(): boolean {
  return !!process.env.EBAY_APP_ID && !!process.env.EBAY_CERT_ID;
}

export function isEpnConfigured(): boolean {
  return !!process.env.EBAY_EPN_CAMPAIGN_ID;
}

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}
let tokenCache: TokenCache | null = null;

// Application Access Token (client-credentials grant) — the right token
// type for browsing public listings with no signed-in eBay user involved.
// Cached in memory and refreshed a few minutes before eBay's stated expiry
// (normally 2h) rather than on every call.
async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 5 * 60 * 1000) {
    return tokenCache.accessToken;
  }
  const basic = Buffer.from(`${process.env.EBAY_APP_ID}:${process.env.EBAY_CERT_ID}`).toString("base64");
  const res = await fetch(OAUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basic}` },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: "https://api.ebay.com/oauth/api_scope" }),
  });
  if (!res.ok) throw new Error(`eBay OAuth token request failed: ${res.status} ${await res.text().catch(() => "")}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { accessToken: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return tokenCache.accessToken;
}

interface EbayItemSummary {
  itemId: string;
  title: string;
  price?: { value: string; currency: string };
  condition?: string;
  image?: { imageUrl: string };
  itemWebUrl: string;
  seller?: { username: string };
}

async function searchEbayItems(query: string, offset: number, limit: number): Promise<EbayItemSummary[]> {
  const token = await getAccessToken();
  const params = new URLSearchParams({
    q: query,
    category_ids: CCG_INDIVIDUAL_CARDS_CATEGORY_ID,
    filter: "buyingOptions:{FIXED_PRICE}",
    sort: "newlyListed",
    limit: String(limit),
    offset: String(offset),
  });
  const res = await fetch(`${BROWSE_URL}?${params}`, {
    headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" },
  });
  if (!res.ok) throw new Error(`eBay Browse search failed: ${res.status} ${await res.text().catch(() => "")}`);
  const body = (await res.json()) as { itemSummaries?: EbayItemSummary[] };
  return body.itemSummaries ?? [];
}

// Pulls a real, current page of listings per query for each franchise and
// upserts them — deliberately a bounded sample (a handful of high-signal
// queries × a couple pages each), refreshed on every sync pass, not a
// literal import of eBay's entire catalog (hundreds of thousands of items,
// most irrelevant junk) — this keeps what's shown fresh, real, and
// actually browsable rather than one enormous stale dump.
const PAGES_PER_QUERY = 2;
const ITEMS_PER_PAGE = 50;

export async function syncEbayListings(): Promise<{ upserted: number; franchiseCounts: Record<string, number> }> {
  if (!isEbayConfigured()) return { upserted: 0, franchiseCounts: {} };

  let upserted = 0;
  const franchiseCounts: Record<string, number> = { pokemon: 0, one_piece: 0 };

  for (const franchise of ["pokemon", "one_piece"] as const) {
    const seenThisFranchise = new Set<string>();
    for (const query of FRANCHISE_QUERIES[franchise]) {
      for (let page = 0; page < PAGES_PER_QUERY; page++) {
        let items: EbayItemSummary[];
        try {
          items = await searchEbayItems(query, page * ITEMS_PER_PAGE, ITEMS_PER_PAGE);
        } catch (err) {
          console.error(`eBay sync: search failed for "${query}" (franchise=${franchise}, page=${page}):`, err);
          continue;
        }
        if (items.length === 0) break;

        for (const item of items) {
          if (seenThisFranchise.has(item.itemId)) continue;
          seenThisFranchise.add(item.itemId);
          if (!item.price?.value) continue;

          await db
            .insert(ebayListings)
            .values({
              ebayItemId: item.itemId,
              title: item.title,
              franchise,
              priceCents: Math.round(parseFloat(item.price.value) * 100),
              currency: item.price.currency,
              condition: item.condition ?? null,
              imageUrl: item.image?.imageUrl ?? null,
              itemWebUrl: item.itemWebUrl,
              sellerUsername: item.seller?.username ?? null,
              lastSeenAt: new Date(),
            })
            .onConflictDoUpdate({
              target: ebayListings.ebayItemId,
              set: {
                title: item.title,
                priceCents: Math.round(parseFloat(item.price.value) * 100),
                currency: item.price.currency,
                condition: item.condition ?? null,
                imageUrl: item.image?.imageUrl ?? null,
                itemWebUrl: item.itemWebUrl,
                sellerUsername: item.seller?.username ?? null,
                lastSeenAt: new Date(),
              },
            });
          upserted++;
          franchiseCounts[franchise]++;
        }
      }
    }
  }

  return { upserted, franchiseCounts };
}

// A row not touched by any sync pass in a while is a listing that's ended
// or sold on eBay itself — drop it rather than keep showing dead inventory.
const STALE_AFTER_MS = 6 * 60 * 60 * 1000; // 6h — a few missed sync cycles' worth of grace

export async function sweepStaleEbayListings(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);
  const result = await db.delete(ebayListings).where(lt(ebayListings.lastSeenAt, cutoff));
  return result.rowCount ?? 0;
}

const SYNC_INTERVAL_MS = 60 * 60 * 1000; // hourly

export function startEbaySyncScheduler(): void {
  if (!isEbayConfigured()) {
    console.log("eBay sync: EBAY_APP_ID/EBAY_CERT_ID not set, skipping (see .env.example)");
    return;
  }
  const run = () => {
    syncEbayListings()
      .then((r) => console.log(`eBay sync: upserted ${r.upserted} listings`, r.franchiseCounts))
      .catch((err) => console.error("eBay sync failed:", err));
    sweepStaleEbayListings()
      .then((n) => n > 0 && console.log(`eBay sync: swept ${n} stale listings`))
      .catch((err) => console.error("eBay stale sweep failed:", err));
  };
  run();
  setInterval(run, SYNC_INTERVAL_MS);
}

// Builds a real EPN affiliate link from a plain eBay item URL. Until a real
// Campaign ID is approved (see isEpnConfigured), this returns the plain
// item URL unchanged — a genuinely working link to the real item, just not
// yet tracked for commission — rather than a fake/broken tracking link.
export function toAffiliateUrl(itemWebUrl: string): string {
  const campaignId = process.env.EBAY_EPN_CAMPAIGN_ID;
  if (!campaignId) return itemWebUrl;
  const url = new URL(itemWebUrl);
  url.searchParams.set("mkevt", "1");
  url.searchParams.set("mkcid", "1");
  url.searchParams.set("mkrid", "711-53200-19255-0"); // eBay's standard US rotation id for EPN text/link placements
  url.searchParams.set("campid", campaignId);
  url.searchParams.set("toolid", "10001");
  return url.toString();
}
