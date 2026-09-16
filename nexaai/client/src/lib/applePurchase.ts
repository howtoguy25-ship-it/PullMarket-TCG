import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { api } from "./api";

// react-native-iap is a native module with no web build — dynamically
// imported so this file never touches the web bundle (same pattern used
// elsewhere in this repo for native-only modules). Real Apple StoreKit
// purchases only: this is the required path for Guideline 3.1.1 — Pro/Max
// subscriptions and credit packs bought inside the iOS app must go through
// StoreKit, not a Paddle web checkout (see lib/payments/appleIap.ts).
let iapModule: typeof import("react-native-iap") | null = null;
async function loadIap() {
  if (!iapModule) iapModule = await import("react-native-iap");
  return iapModule;
}

interface UseApplePurchaseOptions {
  // Empty until the product has been created in App Store Connect and its
  // id set in the server's APPLE_IAP_*_PRODUCT_ID env vars — the purchase
  // button simply never becomes available for an unconfigured product.
  productId: string | null;
  type: "subs" | "in-app";
  // Server route that cryptographically verifies the signed transaction
  // against Apple before trusting the purchase — see routes/plans.ts's
  // /apple/verify and routes/credits.ts's /apple/verify.
  verifyEndpoint: string;
}

interface ApplePurchaseState {
  available: boolean;
  priceLabel: string | null;
  purchasing: boolean;
  restoring: boolean;
  purchase: () => Promise<void>;
  restore: () => Promise<boolean>;
}

export function useApplePurchase({ productId, type, verifyEndpoint }: UseApplePurchaseOptions): ApplePurchaseState {
  const [available, setAvailable] = useState(false);
  const [priceLabel, setPriceLabel] = useState<string | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const connectedRef = useRef(false);

  useEffect(() => {
    if (Platform.OS !== "ios" || !productId) return;
    let cancelled = false;
    void (async () => {
      try {
        const iap = await loadIap();
        await iap.initConnection();
        connectedRef.current = true;
        const products = await iap.fetchProducts({ skus: [productId], type });
        if (cancelled) return;
        const match = (products ?? []).find((p) => p.id === productId);
        if (match) {
          setPriceLabel(match.displayPrice);
          setAvailable(true);
        }
      } catch (err) {
        console.error("Apple IAP init failed:", err);
      }
    })();
    return () => {
      cancelled = true;
      if (connectedRef.current) {
        connectedRef.current = false;
        void loadIap().then((iap) => iap.endConnection());
      }
    };
  }, [productId, type]);

  // The client never decides on its own whether a purchase "counts" — every
  // purchase (new or restored) is verified server-side against Apple's own
  // signed transaction data before the perk activates.
  const verifyWithServer = useCallback(
    (signedTransactionInfo: string) => api(verifyEndpoint, { method: "POST", body: JSON.stringify({ signedTransactionInfo }) }),
    [verifyEndpoint],
  );

  const purchase = useCallback(async () => {
    if (!productId) throw new Error("Not available for purchase yet.");
    const iap = await loadIap();
    setPurchasing(true);
    try {
      await new Promise<void>((resolve, reject) => {
        const successSub = iap.purchaseUpdatedListener((p) => {
          if (p.productId !== productId) return;
          void (async () => {
            try {
              if (!p.purchaseToken) throw new Error("No purchase token returned by the App Store.");
              await verifyWithServer(p.purchaseToken);
              await iap.finishTransaction({ purchase: p, isConsumable: type === "in-app" });
              successSub.remove();
              errorSub.remove();
              resolve();
            } catch (err) {
              successSub.remove();
              errorSub.remove();
              reject(err instanceof Error ? err : new Error("Purchase verification failed."));
            }
          })();
        });
        const errorSub = iap.purchaseErrorListener((err) => {
          successSub.remove();
          errorSub.remove();
          if (iap.isUserCancelledError(err)) resolve();
          else reject(new Error(err.message || "Purchase failed."));
        });
        iap.requestPurchase({ request: { apple: { sku: productId } }, type }).catch((err: unknown) => {
          successSub.remove();
          errorSub.remove();
          reject(err instanceof Error ? err : new Error("Couldn't start the purchase."));
        });
      });
    } finally {
      setPurchasing(false);
    }
  }, [productId, type, verifyWithServer]);

  const restore = useCallback(async () => {
    setRestoring(true);
    try {
      const iap = await loadIap();
      const purchases = await iap.getAvailablePurchases();
      const match = purchases.find((p) => p.productId === productId);
      if (!match?.purchaseToken) return false;
      await verifyWithServer(match.purchaseToken);
      return true;
    } finally {
      setRestoring(false);
    }
  }, [productId, verifyWithServer]);

  return { available, priceLabel, purchasing, restoring, purchase, restore };
}
