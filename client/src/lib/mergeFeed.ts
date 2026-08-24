import { ListingSummary } from "@/components/ListingCard";
import { EbayListingSummary } from "@/components/EbayListingCard";

export type FeedItem = { kind: "pullmarket"; key: string; data: ListingSummary } | { kind: "ebay"; key: string; data: EbayListingSummary };

// Weaves real eBay listings into the user-listing feed at a fixed rate
// (roughly 1 in every 4 cards) rather than dumping them all at the end or
// replacing anything — a seller's own listing is never hidden or bumped
// out to make room. If there are no eBay listings yet (not configured, or
// still syncing), this is just the plain PullMarket feed, unchanged.
const EBAY_INSERT_EVERY = 4;

export function mergeListingsWithEbay(pullmarket: ListingSummary[], ebay: EbayListingSummary[]): FeedItem[] {
  if (ebay.length === 0) {
    return pullmarket.map((data) => ({ kind: "pullmarket", key: `pm-${data.id}`, data }));
  }

  const result: FeedItem[] = [];
  let ebayIndex = 0;
  for (let i = 0; i < pullmarket.length; i++) {
    result.push({ kind: "pullmarket", key: `pm-${pullmarket[i].id}`, data: pullmarket[i] });
    if ((i + 1) % EBAY_INSERT_EVERY === 0 && ebayIndex < ebay.length) {
      result.push({ kind: "ebay", key: `eb-${ebay[ebayIndex].id}`, data: ebay[ebayIndex] });
      ebayIndex++;
    }
  }
  return result;
}
