// Shared between client (inline form feedback) and server (source of truth).

export const PRO_SUBSCRIPTION_PRICE_CENTS = 1999; // $19.99/mo
export const PRO_SUBSCRIPTION_LOOKUP_KEY = "pullmarket_pro_monthly";
export const PRO_LISTING_BOOST_HOURS = 48;

// A seller can unlist-and-relist or edit a listing's details up to this many
// times combined before it's locked — after that they must create a fresh
// listing instead. See LISTING_STATUSES/revisionCount in schema.ts and the
// PATCH/unlist/relist routes in routes/listings.ts.
export const LISTING_REVISION_LIMIT = 2;

// A listing that's been out of stock this many days with no restock gets
// auto-unlisted (see lib/autoUnlist.ts) so the marketplace doesn't stay
// cluttered with cards nobody can buy.
export const AUTO_UNLIST_OUT_OF_STOCK_DAYS = 3;

export const REMOVE_ADS_PRICE_CENTS = 3999; // $39.99 one-time
export const REMOVE_ADS_LOOKUP_KEY = "pullmarket_remove_ads";

// ─── Listing boosts ──────────────────────────────────────────────────────
// A real paid purchase that pushes a listing to the top of the marketplace
// feed for a fixed window (see listings.boostedUntil in schema.ts, and
// routes/boost.ts). Every tier's price strictly increases with its
// duration, so there's never a case where a shorter boost costs more than
// a longer one.
export interface BoostTier {
  id: string;
  durationHours: number;
  priceCents: number;
}

export const BOOST_TIERS: BoostTier[] = [
  { id: "12h", durationHours: 12, priceCents: 1500 },
  { id: "24h", durationHours: 24, priceCents: 1999 },
  { id: "36h", durationHours: 36, priceCents: 3000 },
  { id: "48h", durationHours: 48, priceCents: 4500 },
  { id: "60h", durationHours: 60, priceCents: 5000 },
  { id: "72h", durationHours: 72, priceCents: 5499 },
  { id: "96h", durationHours: 96, priceCents: 7500 },
  { id: "108h", durationHours: 108, priceCents: 8500 },
  { id: "120h", durationHours: 120, priceCents: 9000 },
  { id: "132h", durationHours: 132, priceCents: 9500 },
  { id: "144h", durationHours: 144, priceCents: 10000 },
  { id: "168h", durationHours: 168, priceCents: 10999 },
  { id: "336h", durationHours: 336, priceCents: 20000 },
];

// Active Pro subscribers get this fraction off every boost tier's price.
export const PRO_BOOST_DISCOUNT = 0.15;

export function getBoostTierById(id: string): BoostTier | undefined {
  return BOOST_TIERS.find((t) => t.id === id);
}

/** The real price a specific user pays for a tier — full price, or 15% off
 * for an active Pro subscriber. Always rounds to the nearest cent. */
export function boostPriceCentsForUser(tier: BoostTier, isProSubscriber: boolean): number {
  if (!isProSubscriber) return tier.priceCents;
  return Math.round(tier.priceCents * (1 - PRO_BOOST_DISCOUNT));
}

/** "12 hours" / "1 day" / "1 day 12 hours" / "14 days" — always the plainest
 * exact phrasing for a given hour count, never a rounded approximation. */
export function formatBoostDuration(durationHours: number): string {
  if (durationHours < 24) return `${durationHours} hour${durationHours === 1 ? "" : "s"}`;
  const days = Math.floor(durationHours / 24);
  const hours = durationHours % 24;
  const daysLabel = `${days} day${days === 1 ? "" : "s"}`;
  if (hours === 0) return daysLabel;
  return `${daysLabel} ${hours} hour${hours === 1 ? "" : "s"}`;
}

/**
 * Single source of truth for "is this user's Pro membership currently
 * active" — used both server-side (gating follow/boost/search-ranking) and
 * client-side (showing the tick/follow button/perks). `proStatus` alone
 * isn't quite enough: Stripe keeps a subscription's status as "active"
 * right up until the paid period actually ends even after the user has
 * cancelled (cancelAtPeriodEnd), and proCurrentPeriodEnd is the real
 * authority for whether that period has actually elapsed yet.
 */
export function isActivePro(user: { proStatus: string; proCurrentPeriodEnd: string | Date | null } | null | undefined): boolean {
  if (!user || user.proStatus !== "active") return false;
  if (!user.proCurrentPeriodEnd) return true;
  return new Date(user.proCurrentPeriodEnd).getTime() > Date.now();
}

const POKEMON_RE = /pok[eé]mon/i;
const ONE_PIECE_RE = /one\s*piece/i;

/** Every listing title must reference at least one of the two franchises. */
export function detectFranchise(title: string, description: string): "pokemon" | "one_piece" | "both" | null {
  const text = `${title} ${description}`;
  const hasPokemon = POKEMON_RE.test(text);
  const hasOnePiece = ONE_PIECE_RE.test(text);
  if (hasPokemon && hasOnePiece) return "both";
  if (hasPokemon) return "pokemon";
  if (hasOnePiece) return "one_piece";
  return null;
}

export function titleMentionsFranchise(title: string): boolean {
  return POKEMON_RE.test(title) || ONE_PIECE_RE.test(title);
}

// ─── Courier tracking-number format validation ──────────────────────────
// These match the real public numbering formats each carrier documents.
// This is FORMAT validation only — it confirms the string is shaped like a
// real tracking number for the selected courier, not a live lookup against
// the carrier's API (that needs a carrier account + API key; see README).
export const COURIER_LABELS: Record<string, string> = {
  australia_post: "Australia Post",
  dhl: "DHL",
  fedex: "FedEx",
  other: "Other / local courier",
  // Third-party sellers shipping via a courier outside the fixed list —
  // the seller names the business and Claude checks the tracking number's
  // format is actually consistent with it (see lib/carrierDetection.ts on
  // the server). Distinct from plain "other", which has no such check.
  custom: "Custom tracking (AI-verified)",
};

export const COURIER_PATTERNS: Record<string, RegExp> = {
  // UPU S10 international format (2 letters + 9 digits + 2 letters, e.g.
  // "AB123456785AU") or AusPost's domestic numeric barcode (13-24 digits).
  australia_post: /^([A-Z]{2}\d{9}AU)$|^(\d{13,24})$/i,
  // DHL Express AWB (10-11 digits) or DHL Parcel/eCommerce (12 digits).
  dhl: /^\d{10,12}$/,
  // FedEx Express (12 digits), Ground (15 digits), SmartPost/Freight (20 digits).
  fedex: /^\d{12}$|^\d{15}$|^\d{20}$/,
  // No fixed public spec — just require a plausible-length code.
  other: /^[A-Za-z0-9-]{4,40}$/,
};

export function isValidTrackingNumber(courier: string, trackingNumber: string): boolean {
  const trimmed = trackingNumber.trim().replace(/\s+/g, "");
  const pattern = COURIER_PATTERNS[courier];
  if (!pattern) return trimmed.length >= 4;
  return pattern.test(trimmed);
}

// Real public tracking pages for the fixed couriers — "other"/"custom" have
// no single fixed courier to link to, so those render as plain text instead.
const COURIER_TRACKING_URL_BUILDERS: Record<string, (trackingNumber: string) => string> = {
  australia_post: (n) => `https://auspost.com.au/mypost/track/#/details/${encodeURIComponent(n)}`,
  dhl: (n) => `https://www.dhl.com/global-en/home/tracking.html?tracking-id=${encodeURIComponent(n)}`,
  fedex: (n) => `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(n)}`,
};

export function buildTrackingUrl(courier: string, trackingNumber: string): string | null {
  const trimmed = trackingNumber.trim();
  if (!trimmed) return null;
  return COURIER_TRACKING_URL_BUILDERS[courier]?.(trimmed) ?? null;
}

/** Adds N business days (Mon-Fri) to `from`. Used for the 5-business-day ship deadline. */
export function addBusinessDays(from: Date, days: number): Date {
  const result = new Date(from);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return result;
}

export const CONDITION_LABELS: Record<string, string> = {
  brand_new: "Brand New",
  great_condition: "Great Condition",
  used: "Used",
};

export const REPORT_REASON_LABELS: Record<string, string> = {
  counterfeit: "Counterfeit / fake card",
  not_as_described: "Item not as described",
  never_received: "Never received item",
  scam: "Scam or fraud",
  inappropriate: "Inappropriate content",
  harassment: "Harassment or threats",
  screenshot_detected: "Screenshotted buyer delivery info",
  other: "Other",
};

// Reasons relevant when reporting a chat/user rather than a listing —
// narrows the picker shown on ReportScreen in that context.
export const CHAT_REPORT_REASONS = ["scam", "harassment", "inappropriate", "other"] as const;
export const LISTING_REPORT_REASONS = ["counterfeit", "not_as_described", "never_received", "scam", "inappropriate", "other"] as const;

// Refund window: buyers can request a refund any time before the seller
// marks the order shipped, or within 48h of payment if it's shipped later
// than expected — the server enforces "before shipped" as the hard rule;
// this constant is surfaced in the UI copy.
export const REFUND_WINDOW_HOURS = 48;
export const SHIPPING_DEADLINE_BUSINESS_DAYS = 5;
export const PLATFORM_FEE_CENTS_DEFAULT = 299;

// Countries Stripe Checkout will collect a shipping address for. Kept to
// countries this marketplace can realistically reach via the existing
// couriers (COURIER_PATTERNS above) — a buyer outside this list simply
// won't see a "Pay now" flow that promises delivery it can't fulfill.
export const SHIPPING_COUNTRIES = [
  "US", "CA", "GB", "AU", "NZ", "IE", "DE", "FR", "ES", "IT", "PT", "NL", "BE",
  "CH", "AT", "SE", "NO", "DK", "FI", "PL", "JP", "SG", "HK",
] as const;

export const SHIPPING_COUNTRY_LABELS: Record<string, string> = {
  US: "United States",
  CA: "Canada",
  GB: "United Kingdom",
  AU: "Australia",
  NZ: "New Zealand",
  IE: "Ireland",
  DE: "Germany",
  FR: "France",
  ES: "Spain",
  IT: "Italy",
  PT: "Portugal",
  NL: "Netherlands",
  BE: "Belgium",
  CH: "Switzerland",
  AT: "Austria",
  SE: "Sweden",
  NO: "Norway",
  DK: "Denmark",
  FI: "Finland",
  PL: "Poland",
  JP: "Japan",
  SG: "Singapore",
  HK: "Hong Kong",
};
