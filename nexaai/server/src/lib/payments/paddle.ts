import type { PaymentProvider, CheckoutSession } from "./provider";

// Paddle (paddle.com) — chosen as "something other than Stripe" for the
// website's credit-pack checkout. Paddle acts as merchant-of-record (handles
// its own card processing + global tax), so this hits Paddle's real Billing
// API, not a mock.
//
// Setup required (your own Paddle account, real):
//   1. Sign up at paddle.com, switch to "Billing" (not classic).
//   2. Create one-time Price objects for each credit pack ($35/$80/$115/$175)
//      and set their IDs as PADDLE_PRICE_ID_35 / _80 / _115 / _175.
//   3. Set PADDLE_API_KEY (Developer Tools -> Authentication) and
//      PADDLE_ENV=sandbox|production.
// Until those are set, createCreditCheckout below returns a clear
// "not configured" error instead of pretending to create a real checkout —
// same degrade-gracefully pattern as this repo's root Stripe integration.

const PACK_PRICE_ENV: Record<string, string> = {
  "$35": "PADDLE_PRICE_ID_35",
  "$80": "PADDLE_PRICE_ID_80",
  "$115": "PADDLE_PRICE_ID_115",
  "$175": "PADDLE_PRICE_ID_175",
};

function apiBase(): string {
  return process.env.PADDLE_ENV === "production" ? "https://api.paddle.com" : "https://sandbox-api.paddle.com";
}

export const paddleProvider: PaymentProvider = {
  name: "paddle",

  isConfigured() {
    return !!process.env.PADDLE_API_KEY;
  },

  async createCreditCheckout({ userId, userEmail, packLabel }): Promise<CheckoutSession> {
    if (!this.isConfigured()) {
      throw Object.assign(new Error("Paddle is not configured. Set PADDLE_API_KEY and PADDLE_PRICE_ID_* env vars."), {
        code: "PAYMENT_PROVIDER_NOT_CONFIGURED",
      });
    }
    const priceEnvVar = PACK_PRICE_ENV[packLabel];
    const priceId = priceEnvVar ? process.env[priceEnvVar] : undefined;
    if (!priceId) {
      throw Object.assign(new Error(`No Paddle price configured for pack ${packLabel} (set ${priceEnvVar}).`), {
        code: "PAYMENT_PROVIDER_NOT_CONFIGURED",
      });
    }

    const response = await fetch(`${apiBase()}/transactions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PADDLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        items: [{ price_id: priceId, quantity: 1 }],
        customer: { email: userEmail },
        custom_data: { nexaaiUserId: userId, packLabel },
        collection_mode: "automatic",
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Paddle checkout creation failed: ${response.status} ${detail}`);
    }
    const json = (await response.json()) as { data: { id: string; checkout?: { url?: string } } };
    if (!json.data.checkout?.url) {
      throw new Error("Paddle did not return a checkout URL — check your Price is set up for hosted checkout.");
    }
    return { checkoutUrl: json.data.checkout.url, providerReference: json.data.id };
  },
};
