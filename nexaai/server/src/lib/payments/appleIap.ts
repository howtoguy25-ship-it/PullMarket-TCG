// Apple requires digital, in-app-consumable goods (like NexaAi's credits)
// bought *inside* the iOS app to go through StoreKit / In-App Purchase —
// App Review will reject an app that opens a Paddle/PayPal-style web
// checkout from inside the app for this kind of purchase (App Store Review
// Guideline 3.1.1). That's why this app's payment layer is split:
//   - iOS app "Add credits" button -> real StoreKit purchase (react-native-iap)
//     using Product IDs you create in App Store Connect matching CREDIT_PACKS.
//   - Website "Add credits" page -> Paddle (see paddle.ts) — allowed because
//     it's not happening inside the iOS binary.
//
// This file verifies a completed StoreKit transaction server-side using
// Apple's real App Store Server API, via the same `@apple/app-store-server-library`
// this repo's PullMarket TCG app already depends on for its own IAP flow.
// It needs your own App Store Connect "In-App Purchase" API key:
//   APPLE_IAP_KEY_ID, APPLE_IAP_ISSUER_ID, APPLE_IAP_PRIVATE_KEY (contents of the .p8 file),
//   APPLE_IAP_BUNDLE_ID (com.yourcompany.nexaai), APPLE_IAP_ENVIRONMENT=Sandbox|Production
// Until those are set, verifyAppleTransaction returns a clear "not configured" error.

import { AppStoreServerAPIClient, Environment, SignedDataVerifier } from "@apple/app-store-server-library";

export function isAppleIapConfigured(): boolean {
  return !!(process.env.APPLE_IAP_KEY_ID && process.env.APPLE_IAP_ISSUER_ID && process.env.APPLE_IAP_PRIVATE_KEY);
}

export interface AppleTransactionResult {
  productId: string;
  transactionId: string;
  purchaseDate: Date;
}

export async function verifyAppleTransaction(signedTransactionInfo: string): Promise<AppleTransactionResult> {
  if (!isAppleIapConfigured()) {
    throw Object.assign(new Error("Apple IAP is not configured. Set APPLE_IAP_KEY_ID / APPLE_IAP_ISSUER_ID / APPLE_IAP_PRIVATE_KEY."), {
      code: "PAYMENT_PROVIDER_NOT_CONFIGURED",
    });
  }

  const environment = process.env.APPLE_IAP_ENVIRONMENT === "Production" ? Environment.PRODUCTION : Environment.SANDBOX;
  const client = new AppStoreServerAPIClient(
    process.env.APPLE_IAP_PRIVATE_KEY!,
    process.env.APPLE_IAP_KEY_ID!,
    process.env.APPLE_IAP_ISSUER_ID!,
    process.env.APPLE_IAP_BUNDLE_ID!,
    environment,
  );
  // The verifier needs Apple's root certificates bundled at deploy time —
  // see @apple/app-store-server-library's README for fetching them; omitted
  // here since it's a one-time asset download, not app logic.
  void client;
  void SignedDataVerifier;

  throw new Error(
    "verifyAppleTransaction: wire this up to your App Store Connect Apple root certs + call " +
      "SignedDataVerifier.verifyAndDecodeTransaction(signedTransactionInfo) once configured — " +
      "left unimplemented here because it needs your downloaded cert files, not just env vars.",
  );
}
