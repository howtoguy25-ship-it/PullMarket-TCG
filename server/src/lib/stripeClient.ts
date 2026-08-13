import Stripe from "stripe";

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
