import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { apiJson } from "./api";

// react-native-iap is a native module with no web build — same dynamic-
// import-on-native-only pattern used for react-native-webrtc/InCallManager
// elsewhere in this app, so importing this file never touches the web
// bundle. Real Apple StoreKit purchases only — there is deliberately no
// Stripe purchase flow anywhere in the native app (see SubscriptionScreen)
// because Apple requires IAP for digital in-app perks like Pro membership.
let iapModule: typeof import("react-native-iap") | null = null;
async function loadIap() {
  if (!iapModule) iapModule = await import("react-native-iap");
  return iapModule;
}

// Set once the Pro subscription product has been created in App Store
// Connect (see the setup checklist) — until then this stays empty and the
// purchase button simply never becomes available, rather than trying to
// buy a product that doesn't exist yet.
const PRODUCT_ID = (Constants.expoConfig?.extra?.APPLE_IAP_PRODUCT_ID as string) || "";

interface ApplePurchaseState {
  available: boolean;
  priceLabel: string | null;
  purchasing: boolean;
  restoring: boolean;
  purchase: () => Promise<void>;
  restore: () => Promise<boolean>;
}

export function useApplePurchase(): ApplePurchaseState {
  const [available, setAvailable] = useState(false);
  const [priceLabel, setPriceLabel] = useState<string | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const connectedRef = useRef(false);

  useEffect(() => {
    if (Platform.OS !== "ios" || !PRODUCT_ID) return;
    let cancelled = false;
    void (async () => {
      try {
        const iap = await loadIap();
        await iap.initConnection();
        connectedRef.current = true;
        const products = await iap.fetchProducts({ skus: [PRODUCT_ID], type: "subs" });
        if (cancelled) return;
        const match = (products ?? []).find((p) => p.id === PRODUCT_ID);
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
  }, []);

  // The client never decides on its own whether a purchase "counts" —
  // every purchase (new or restored) is verified server-side against
  // Apple's own signed transaction data before Pro activates (see
  // POST /api/subscription/apple/verify), the same way a Stripe purchase
  // is only ever trusted once the webhook confirms it, not just because
  // the client says checkout succeeded.
  const verifyWithServer = useCallback((purchaseToken: string) => apiJson<{ active: boolean }>("POST", "/api/subscription/apple/verify", { jws: purchaseToken }), []);

  const purchase = useCallback(async () => {
    if (!PRODUCT_ID) throw new Error("Pro isn't available for purchase yet.");
    const iap = await loadIap();
    setPurchasing(true);
    try {
      await new Promise<void>((resolve, reject) => {
        const successSub = iap.purchaseUpdatedListener((p) => {
          if (p.productId !== PRODUCT_ID) return;
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
        iap.requestPurchase({ request: { apple: { sku: PRODUCT_ID } }, type: "subs" }).catch((err: unknown) => {
          successSub.remove();
          errorSub.remove();
          reject(err instanceof Error ? err : new Error("Couldn't start the purchase."));
        });
      });
    } finally {
      setPurchasing(false);
    }
  }, [verifyWithServer]);

  const restore = useCallback(async () => {
    setRestoring(true);
    try {
      const iap = await loadIap();
      const purchases = await iap.getAvailablePurchases();
      const match = purchases.find((p) => p.productId === PRODUCT_ID);
      if (!match?.purchaseToken) return false;
      await verifyWithServer(match.purchaseToken);
      return true;
    } finally {
      setRestoring(false);
    }
  }, [verifyWithServer]);

  return { available, priceLabel, purchasing, restoring, purchase, restore };
}
