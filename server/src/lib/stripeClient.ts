import Stripe from "stripe";
import { PRO_SUBSCRIPTION_LOOKUP_KEY, PRO_SUBSCRIPTION_PRICE_CENTS, REMOVE_ADS_LOOKUP_KEY, REMOVE_ADS_PRICE_CENTS } from "@shared/validation";

let stripeClient: Stripe | null = null;

export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

export function getStripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not set — add it to .env to enable payments (see .env.example).");
  }
  if (!stripeClient) {
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2024-12-18.acacia" as Stripe.LatestApiVersion,
    });
  }
  return stripeClient;
}

// $2.99 per order, kept on the platform's own Stripe balance via
// application_fee_amount on the Connect destination charge (see
// routes/checkout.ts) — the rest transfers to the seller. Override with
// PLATFORM_FEE_CENTS if a different amount is ever needed.
export function getPlatformFeeCents(): number {
  return Number(process.env.PLATFORM_FEE_CENTS || 299);
}

// The Pro membership's recurring Price ($19.99/mo) — created once via the
// API rather than requiring manual setup in the Stripe Dashboard, found
// again on every subsequent call by its lookup_key so this stays a no-op
// after the first real use. Cached in-process since a Price is immutable
// once created (Stripe Prices can't be edited, only archived + replaced).
let cachedProPriceId: string | null = null;
export async function getOrCreateProPriceId(): Promise<string> {
  if (cachedProPriceId) return cachedProPriceId;
  const stripe = getStripe();

  const existing = await stripe.prices.list({ lookup_keys: [PRO_SUBSCRIPTION_LOOKUP_KEY], active: true, limit: 1 });
  if (existing.data[0]) {
    cachedProPriceId = existing.data[0].id;
    return cachedProPriceId;
  }

  const product = await stripe.products.create({ name: "PullMarket Pro", description: "Follower system, verified tick, 48h listing boost, and search recognition." });
  const price = await stripe.prices.create({
    product: product.id,
    currency: "usd",
    unit_amount: PRO_SUBSCRIPTION_PRICE_CENTS,
    recurring: { interval: "month" },
    lookup_key: PRO_SUBSCRIPTION_LOOKUP_KEY,
  });
  cachedProPriceId = price.id;
  return cachedProPriceId;
}

// Remove Ads — a one-time $39.99 Price (no `recurring` block), same
// find-or-create-by-lookup_key pattern as the Pro Price above.
let cachedRemoveAdsPriceId: string | null = null;
export async function getOrCreateRemoveAdsPriceId(): Promise<string> {
  if (cachedRemoveAdsPriceId) return cachedRemoveAdsPriceId;
  const stripe = getStripe();

  const existing = await stripe.prices.list({ lookup_keys: [REMOVE_ADS_LOOKUP_KEY], active: true, limit: 1 });
  if (existing.data[0]) {
    cachedRemoveAdsPriceId = existing.data[0].id;
    return cachedRemoveAdsPriceId;
  }

  const product = await stripe.products.create({ name: "PullMarket — Remove Ads", description: "Removes banner and app-open ads for this account, permanently." });
  const price = await stripe.prices.create({
    product: product.id,
    currency: "usd",
    unit_amount: REMOVE_ADS_PRICE_CENTS,
    lookup_key: REMOVE_ADS_LOOKUP_KEY,
  });
  cachedRemoveAdsPriceId = price.id;
  return cachedRemoveAdsPriceId;
}
