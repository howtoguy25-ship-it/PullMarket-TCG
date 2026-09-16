import type { PaymentProvider, CheckoutSession } from "./provider";
import { appBaseUrl } from "../appBaseUrl";

// Stripe — the payment provider for the website's credit-pack and
// subscription checkout, used instead of Paddle (kept in ./paddle.ts,
// dormant) while that account's business verification is stuck. Unlike
// Paddle, Stripe is not a merchant of record: you handle your own sales
// tax/VAT. This hits Stripe's real Checkout + Payment Intents API, not a
// mock.
//
// Setup required (your own Stripe account, real):
//   1. Create one-time Price objects for each credit pack ($35/$80/$115/$175)
//      and set their IDs as STRIPE_PRICE_ID_35 / _80 / _115 / _175.
//   2. Create two RECURRING (monthly) Price objects for the Pro/Max plans
//      and set their IDs as STRIPE_PRICE_ID_PRO / STRIPE_PRICE_ID_MAX.
//   3. Set STRIPE_SECRET_KEY (Developers -> API keys) and, once you've
//      created a webhook endpoint at <APP_BASE_URL>/api/webhooks/stripe
//      (Developers -> Webhooks), STRIPE_WEBHOOK_SECRET from that endpoint.
// Until those are set, createCreditCheckout/createSubscriptionCheckout
// below return a clear "not configured" error instead of pretending to
// create a real checkout.

const PACK_PRICE_ENV: Record<string, string> = {
  "$35": "STRIPE_PRICE_ID_35",
  "$80": "STRIPE_PRICE_ID_80",
  "$115": "STRIPE_PRICE_ID_115",
  "$175": "STRIPE_PRICE_ID_175",
};

const SUBSCRIPTION_PRICE_ENV: Record<"pro" | "max", string> = {
  pro: "STRIPE_PRICE_ID_PRO",
  max: "STRIPE_PRICE_ID_MAX",
};

const API_BASE = "https://api.stripe.com/v1";

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
}

/** Stripe's REST API takes classic form-encoded bodies, including for nested objects (a[b]=c). */
function toForm(params: Record<string, string | number | boolean>): string {
  return Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}

export const stripeProvider: PaymentProvider & {
  chargeSavedPaymentMethod(stripeCustomerId: string, packLabel: string, userId: string): Promise<{ transactionId: string; status: string }>;
} = {
  name: "stripe",

  isConfigured() {
    return !!process.env.STRIPE_SECRET_KEY;
  },

  async createCreditCheckout({ userId, userEmail, priceCents, packLabel }): Promise<CheckoutSession> {
    if (!this.isConfigured()) {
      throw Object.assign(new Error("Stripe is not configured. Set STRIPE_SECRET_KEY and STRIPE_PRICE_ID_* env vars."), {
        code: "PAYMENT_PROVIDER_NOT_CONFIGURED",
      });
    }

    // The 4 fixed packs use a pre-created catalog Price (clean reporting in
    // the Stripe dashboard); a custom top-up amount (routes/credits.ts,
    // real $5 minimum) has no pre-created Price to point at, so it builds
    // the line item's price inline via price_data — a real Stripe feature
    // for exactly this case, not a workaround.
    const lineItem: Record<string, string | number> =
      packLabel === "Custom"
        ? {
            "line_items[0][price_data][currency]": "usd",
            "line_items[0][price_data][product_data][name]": `NexaAi Credits ($${(priceCents / 100).toFixed(2)})`,
            "line_items[0][price_data][unit_amount]": priceCents,
          }
        : (() => {
            const priceEnvVar = PACK_PRICE_ENV[packLabel];
            const priceId = priceEnvVar ? process.env[priceEnvVar] : undefined;
            if (!priceId) {
              throw Object.assign(new Error(`No Stripe price configured for pack ${packLabel} (set ${priceEnvVar}).`), {
                code: "PAYMENT_PROVIDER_NOT_CONFIGURED",
              });
            }
            return { "line_items[0][price]": priceId };
          })();

    const response = await fetch(`${API_BASE}/checkout/sessions`, {
      method: "POST",
      headers: authHeaders(),
      body: toForm({
        mode: "payment",
        ...lineItem,
        "line_items[0][quantity]": 1,
        customer_email: userEmail,
        // Managed Payments (Stripe's bundled tax/reporting product) is on
        // by default on some accounts and requires every product to carry
        // a real tax code, or every session creation 400s. Which tax code
        // is correct depends on how you register for tax (a real business
        // decision, not one to guess at here) — disabled until you make
        // that call; flip this to your real tax_code + drop this override
        // once you have.
        "managed_payments[enabled]": false,
        // Always create a real Customer object (not just a guest payment) so
        // a later auto-recharge (lib/autoRecharge.ts) has somewhere to store
        // and reuse the card, exactly like Paddle's customer_id capture.
        customer_creation: "always",
        "payment_intent_data[setup_future_usage]": "off_session",
        "metadata[nexaaiUserId]": userId,
        "metadata[packLabel]": packLabel,
        success_url: `${appBaseUrl()}/account/credits.html?checkout=success`,
        cancel_url: `${appBaseUrl()}/account/credits.html?checkout=cancelled`,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Stripe checkout creation failed: ${response.status} ${detail}`);
    }
    const json = (await response.json()) as { id: string; url?: string };
    if (!json.url) {
      throw new Error("Stripe did not return a checkout URL.");
    }
    return { checkoutUrl: json.url, providerReference: json.id };
  },

  async createSubscriptionCheckout({ userId, userEmail, tier }): Promise<CheckoutSession> {
    if (!this.isConfigured()) {
      throw Object.assign(new Error("Stripe is not configured. Set STRIPE_SECRET_KEY and STRIPE_PRICE_ID_* env vars."), {
        code: "PAYMENT_PROVIDER_NOT_CONFIGURED",
      });
    }
    const priceEnvVar = SUBSCRIPTION_PRICE_ENV[tier];
    const priceId = process.env[priceEnvVar];
    if (!priceId) {
      throw Object.assign(new Error(`No Stripe price configured for the ${tier} plan (set ${priceEnvVar}).`), {
        code: "PAYMENT_PROVIDER_NOT_CONFIGURED",
      });
    }

    const response = await fetch(`${API_BASE}/checkout/sessions`, {
      method: "POST",
      headers: authHeaders(),
      body: toForm({
        mode: "subscription",
        "line_items[0][price]": priceId,
        "line_items[0][quantity]": 1,
        customer_email: userEmail,
        "managed_payments[enabled]": false,
        "metadata[nexaaiUserId]": userId,
        "metadata[planTier]": tier,
        // Also stamped onto the resulting Subscription object itself (not
        // just this Checkout Session), so customer.subscription.updated/
        // deleted webhooks — fired long after this session is gone — can
        // still see which NexaAi user and tier they belong to.
        "subscription_data[metadata][nexaaiUserId]": userId,
        "subscription_data[metadata][planTier]": tier,
        // No dedicated plans.html exists on the website (subscription
        // upgrades are initiated from the app, not the site) — land back on
        // the real account settings page rather than a URL nobody serves.
        success_url: `${appBaseUrl()}/account/settings.html?checkout=success`,
        cancel_url: `${appBaseUrl()}/account/settings.html?checkout=cancelled`,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Stripe subscription checkout creation failed: ${response.status} ${detail}`);
    }
    const json = (await response.json()) as { id: string; url?: string };
    if (!json.url) {
      throw new Error("Stripe did not return a checkout URL.");
    }
    return { checkoutUrl: json.url, providerReference: json.id };
  },

  /**
   * Real off-session charge for auto-recharge (lib/autoRecharge.ts) — no
   * checkout, no redirect. Charges the customer's most recently attached
   * card directly via a PaymentIntent, using the reusable payment method
   * saved by setup_future_usage on their first real checkout above. If
   * that customer has no card on file yet, Stripe's own API rejects this,
   * surfaced as a normal thrown error, not silently treated as success.
   */
  async chargeSavedPaymentMethod(stripeCustomerId: string, packLabel: string, userId: string): Promise<{ transactionId: string; status: string }> {
    if (!this.isConfigured()) {
      throw Object.assign(new Error("Stripe is not configured."), { code: "PAYMENT_PROVIDER_NOT_CONFIGURED" });
    }
    const priceEnvVar = PACK_PRICE_ENV[packLabel];
    const priceId = priceEnvVar ? process.env[priceEnvVar] : undefined;
    if (!priceId) {
      throw Object.assign(new Error(`No Stripe price configured for pack ${packLabel} (set ${priceEnvVar}).`), {
        code: "PAYMENT_PROVIDER_NOT_CONFIGURED",
      });
    }

    const priceResponse = await fetch(`${API_BASE}/prices/${priceId}`, { headers: authHeaders() });
    if (!priceResponse.ok) throw new Error(`Stripe price lookup failed: ${priceResponse.status} ${await priceResponse.text()}`);
    const price = (await priceResponse.json()) as { unit_amount: number };

    const pmResponse = await fetch(`${API_BASE}/payment_methods?customer=${encodeURIComponent(stripeCustomerId)}&type=card`, { headers: authHeaders() });
    if (!pmResponse.ok) throw new Error(`Stripe payment method lookup failed: ${pmResponse.status} ${await pmResponse.text()}`);
    const pmJson = (await pmResponse.json()) as { data: { id: string }[] };
    const paymentMethodId = pmJson.data[0]?.id;
    if (!paymentMethodId) {
      throw new Error(`Stripe customer ${stripeCustomerId} has no saved card to auto-recharge.`);
    }

    const response = await fetch(`${API_BASE}/payment_intents`, {
      method: "POST",
      headers: authHeaders(),
      body: toForm({
        amount: price.unit_amount,
        currency: "usd",
        customer: stripeCustomerId,
        payment_method: paymentMethodId,
        off_session: true,
        confirm: true,
        "metadata[nexaaiUserId]": userId,
        "metadata[packLabel]": packLabel,
        "metadata[source]": "auto_recharge",
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Stripe auto-recharge charge failed: ${response.status} ${detail}`);
    }
    const json = (await response.json()) as { id: string; status: string };
    return { transactionId: json.id, status: json.status };
  },

  async cancelSubscription(stripeSubscriptionId: string): Promise<void> {
    if (!this.isConfigured()) {
      throw Object.assign(new Error("Stripe is not configured."), { code: "PAYMENT_PROVIDER_NOT_CONFIGURED" });
    }
    // cancel_at_period_end, not an immediate delete — lets the user keep
    // the plan through what they already paid for, same as Paddle's
    // effective_from: next_billing_period.
    const response = await fetch(`${API_BASE}/subscriptions/${stripeSubscriptionId}`, {
      method: "POST",
      headers: authHeaders(),
      body: toForm({ cancel_at_period_end: true }),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Stripe subscription cancellation failed: ${response.status} ${detail}`);
    }
  },
};
