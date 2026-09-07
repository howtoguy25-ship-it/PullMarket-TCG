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
}
