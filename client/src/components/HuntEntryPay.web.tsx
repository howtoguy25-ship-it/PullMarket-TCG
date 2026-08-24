// @stripe/stripe-react-native has no web build, so web redirects through
// Stripe's own hosted Checkout page instead — same split as the
// marketplace's own checkout (see CheckoutForm.web.tsx / BoostListingScreen).
import React, { useState } from "react";
import { Spacing } from "@/constants/theme";
import { Button } from "@/components/ui";
import { apiJson, ApiError } from "@/lib/api";
import { formatPriceCents } from "@/lib/format";

export function HuntEntryPay({ gameId, priceCents }: { gameId: string; priceCents: number; onPaid: () => void }) {
  const [submitting, setSubmitting] = useState(false);

  const handlePay = async () => {
    setSubmitting(true);
    try {
      const returnUrl = `${window.location.origin}/hunt-entry-return?gameId=${gameId}`;
      const { url } = await apiJson<{ url: string }>("POST", `/api/hunt/${gameId}/session`, { returnUrl });
      window.location.href = url;
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : "Couldn't start checkout, please try again.");
      setSubmitting(false);
    }
  };

  return <Button title={submitting ? "Redirecting…" : `Enter for ${formatPriceCents(priceCents)}`} onPress={handlePay} loading={submitting} style={{ marginTop: Spacing.md }} />;
}
