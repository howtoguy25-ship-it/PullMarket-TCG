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
//   3. Create two RECURRING (monthly) Price objects for the Pro/Max plans
//      and set their IDs as PADDLE_PRICE_ID_PRO / PADDLE_PRICE_ID_MAX.
//   4. Set PADDLE_API_KEY (Developer Tools -> Authentication) and
//      PADDLE_ENV=sandbox|production.
// Until those are set, createCreditCheckout/createSubscriptionCheckout below
// return a clear "not configured" error instead of pretending to create a
// real checkout — same degrade-gracefully pattern as this repo's root Stripe
// integration.

const PACK_PRICE_ENV: Record<string, string> = {
  "$35": "PADDLE_PRICE_ID_35",
  "$80": "PADDLE_PRICE_ID_80",
  "$115": "PADDLE_PRICE_ID_115",
  "$175": "PADDLE_PRICE_ID_175",
};

// Recurring Price objects for Pro/Max — created the same way as the credit
// pack prices above, except billing_cycle: monthly on the Paddle side.
const SUBSCRIPTION_PRICE_ENV: Record<"pro" | "max", string> = {
  pro: "PADDLE_PRICE_ID_PRO",
  max: "PADDLE_PRICE_ID_MAX",
};

function apiBase(): string {
  return process.env.PADDLE_ENV === "production" ? "https://api.paddle.com" : "https://sandbox-api.paddle.com";
}

export const paddleProvider: PaymentProvider & {
  chargeSavedPaymentMethod(paddleCustomerId: string, packLabel: string, userId: string): Promise<{ transactionId: string; status: string }>;
} = {
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

  async createSubscriptionCheckout({ userId, userEmail, tier }): Promise<CheckoutSession> {
    if (!this.isConfigured()) {
      throw Object.assign(new Error("Paddle is not configured. Set PADDLE_API_KEY and PADDLE_PRICE_ID_* env vars."), {
        code: "PAYMENT_PROVIDER_NOT_CONFIGURED",
      });
    }
    const priceEnvVar = SUBSCRIPTION_PRICE_ENV[tier];
    const priceId = process.env[priceEnvVar];
    if (!priceId) {
      throw Object.assign(new Error(`No Paddle price configured for the ${tier} plan (set ${priceEnvVar}).`), {
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
        custom_data: { nexaaiUserId: userId, planTier: tier },
        collection_mode: "automatic",
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Paddle subscription checkout creation failed: ${response.status} ${detail}`);
    }
    const json = (await response.json()) as { data: { id: string; checkout?: { url?: string } } };
    if (!json.data.checkout?.url) {
      throw new Error("Paddle did not return a checkout URL — check your Price is set up for hosted checkout.");
    }
    return { checkoutUrl: json.data.checkout.url, providerReference: json.data.id };
  },

  /**
   * Real off-session charge for auto-recharge (lib/autoRecharge.ts) — no
   * checkout, no redirect. Paddle attempts this against the given
   * customer's own saved/default payment method (set once, on their very
   * first real checkout) when `collection_mode: "automatic"` and a
   * `customer_id` are given with no `checkout` block. If that customer has
   * no payment method on file yet (never completed a real purchase),
   * Paddle's own API rejects it — surfaced as a normal thrown error, not
   * silently treated as success.
   */
  async chargeSavedPaymentMethod(paddleCustomerId: string, packLabel: string, userId: string): Promise<{ transactionId: string; status: string }> {
    if (!this.isConfigured()) {
      throw Object.assign(new Error("Paddle is not configured."), { code: "PAYMENT_PROVIDER_NOT_CONFIGURED" });
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
        customer_id: paddleCustomerId,
        custom_data: { nexaaiUserId: userId, packLabel, source: "auto_recharge" },
        collection_mode: "automatic",
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Paddle auto-recharge charge failed: ${response.status} ${detail}`);
    }
    const json = (await response.json()) as { data: { id: string; status: string } };
    return { transactionId: json.data.id, status: json.data.status };
  },

  async cancelSubscription(paddleSubscriptionId: string): Promise<void> {
    if (!this.isConfigured()) {
      throw Object.assign(new Error("Paddle is not configured."), { code: "PAYMENT_PROVIDER_NOT_CONFIGURED" });
    }
    // "effective_from: next_billing_period" — lets the user keep the plan
    // through what they already paid for, same as cancelling any real
    // subscription, instead of yanking access the instant they cancel.
    const response = await fetch(`${apiBase()}/subscriptions/${paddleSubscriptionId}/cancel`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PADDLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ effective_from: "next_billing_period" }),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Paddle subscription cancellation failed: ${response.status} ${detail}`);
    }
  },
};
