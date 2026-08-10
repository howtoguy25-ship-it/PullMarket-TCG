// Shared between client (inline form feedback) and server (source of truth).

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
  inappropriate: "Inappropriate listing",
  other: "Other",
};

// Refund window: buyers can request a refund any time before the seller
// marks the order shipped, or within 48h of payment if it's shipped later
// than expected — the server enforces "before shipped" as the hard rule;
// this constant is surfaced in the UI copy.
export const REFUND_WINDOW_HOURS = 48;
export const SHIPPING_DEADLINE_BUSINESS_DAYS = 5;
export const PLATFORM_FEE_CENTS_DEFAULT = 200;
