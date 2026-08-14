import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { apiJson } from "./api";

// react-native-iap is a native module with no web build — same dynamic-
// import-on-native-only pattern used for react-native-webrtc/InCallManager
// elsewhere in this app, so importing this file never touches the web
// bundle. Real Apple StoreKit purchases only — there is deliberately no
// Stripe purchase flow anywhere in the native app (see SubscriptionScreen,
// RemoveAdsScreen) because Apple requires IAP for digital in-app perks.
let iapModule: typeof import("react-native-iap") | null = null;
async function loadIap() {
  if (!iapModule) iapModule = await import("react-native-iap");
  return iapModule;
}

interface UseApplePurchaseOptions {
  // Empty until the product has been created in App Store Connect — the
  // purchase button simply never becomes available, rather than trying to
  // buy a product that doesn't exist yet (see the callers for where each
  // product id comes from).
  productId: string;
  // "subs" for PullMarket Pro's recurring membership, "in-app" for Remove
  // Ads' one-time non-consumable purchase.
  type: "subs" | "in-app";
  // Server route that verifies the signed transaction against Apple before
  // trusting the purchase — same pattern as a Stripe webhook confirming a
  // Checkout Session rather than trusting the client's word alone.
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

  // The client never decides on its own whether a purchase "counts" —
  // every purchase (new or restored) is verified server-side against
  // Apple's own signed transaction data before the perk activates, the same
  // way a Stripe purchase is only ever trusted once the webhook confirms
  // it, not just because the client says checkout succeeded.
  const verifyWithServer = useCallback((purchaseToken: string) => apiJson("POST", verifyEndpoint, { jws: purchaseToken }), [verifyEndpoint]);

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
              await iap.finishTransaction({ purchase: p, isConsumable: false });
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

interface CatalogItem {
  available: boolean;
  priceLabel: string | null;
}

interface ApplePurchaseCatalogState {
  catalog: Record<string, CatalogItem>;
  purchasingId: string | null;
  // Server verify endpoint is supplied per-call rather than fixed at hook
  // setup, since one catalog hook covers several products (Boost's tiers)
  // that all verify against the same route but need to name themselves.
  purchase: (productId: string, verifyEndpoint: string) => Promise<void>;
}

/** Same idea as useApplePurchase above, but for a set of interchangeable
 * consumable products bought one at a time — Boost's tiers, where a seller
 * might buy several different-length boosts over time on the same account,
 * so (unlike Remove Ads/Pro) nothing here is ever "already owned" or
 * restorable. */
export function useApplePurchaseCatalog(productIds: string[]): ApplePurchaseCatalogState {
  const [catalog, setCatalog] = useState<Record<string, CatalogItem>>({});
  const [purchasingId, setPurchasingId] = useState<string | null>(null);
  const connectedRef = useRef(false);
  const idsKey = productIds.join(",");

  useEffect(() => {
    if (Platform.OS !== "ios" || productIds.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const iap = await loadIap();
        await iap.initConnection();
        connectedRef.current = true;
        const products = await iap.fetchProducts({ skus: productIds, type: "in-app" });
        if (cancelled) return;
        const next: Record<string, CatalogItem> = {};
        for (const id of productIds) {
          const match = (products ?? []).find((p) => p.id === id);
          next[id] = { available: !!match, priceLabel: match?.displayPrice ?? null };
        }
        setCatalog(next);
      } catch (err) {
        console.error("Apple IAP catalog init failed:", err);
      }
    })();
    return () => {
      cancelled = true;
      if (connectedRef.current) {
        connectedRef.current = false;
        void loadIap().then((iap) => iap.endConnection());
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const purchase = useCallback(async (productId: string, verifyEndpoint: string) => {
    const iap = await loadIap();
    setPurchasingId(productId);
    try {
      await new Promise<void>((resolve, reject) => {
        const successSub = iap.purchaseUpdatedListener((p) => {
          if (p.productId !== productId) return;
          void (async () => {
            try {
              if (!p.purchaseToken) throw new Error("No purchase token returned by the App Store.");
              await apiJson("POST", verifyEndpoint, { jws: p.purchaseToken });
              // Consumable — unlike Remove Ads' finishTransaction, this one
              // tells Apple the product is used up so it can be bought
              // again (another boost, another listing, another day).
              await iap.finishTransaction({ purchase: p, isConsumable: true });
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
        iap.requestPurchase({ request: { apple: { sku: productId } }, type: "in-app" }).catch((err: unknown) => {
          successSub.remove();
          errorSub.remove();
          reject(err instanceof Error ? err : new Error("Couldn't start the purchase."));
        });
      });
    } finally {
      setPurchasingId(null);
    }
  }, []);

  return { catalog, purchasingId, purchase };
}
