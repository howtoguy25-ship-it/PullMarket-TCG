export interface CheckoutSession {
  checkoutUrl: string;
  providerReference: string;
}

export interface PaymentProvider {
  name: string;
  isConfigured(): boolean;
  /** Creates a hosted checkout for a credit-pack purchase; returns a URL to redirect the user to. */
  createCreditCheckout(params: {
    userId: string;
    userEmail: string;
    priceCents: number;
    packLabel: string;
  }): Promise<CheckoutSession>;
  /** Creates a hosted checkout for a Pro/Max recurring subscription; returns a URL to redirect the user to. */
  createSubscriptionCheckout(params: {
    userId: string;
    userEmail: string;
    tier: "pro" | "max";
  }): Promise<CheckoutSession>;
  /** Cancels a user's active subscription at the provider (effective at the end of the current billing period). */
  cancelSubscription(paddleSubscriptionId: string): Promise<void>;
}
