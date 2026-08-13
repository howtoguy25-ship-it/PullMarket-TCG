import fs from "fs";
import path from "path";
import { SignedDataVerifier, Environment, VerificationException } from "@apple/app-store-server-library";
import type { JWSTransactionDecodedPayload, ResponseBodyV2DecodedPayload } from "@apple/app-store-server-library";

// Apple's own root CA (public data — the same file anyone can download
// from apple.com/certificateauthority — not a secret). This is all
// SignedDataVerifier needs to cryptographically verify that a JWS really
// was signed by Apple, with no App Store Connect API key required: a key
// is only needed for proactively *calling* Apple's API (refund history,
// extending renewal dates, etc.), not for verifying data Apple already
// signed and handed to a device or sent to a webhook.
const ROOT_CERT_PATH = path.resolve(process.cwd(), "server/assets/apple/AppleRootCA-G3.cer");

export function isAppleIapConfigured(): boolean {
  return !!process.env.APPLE_IAP_PRODUCT_ID;
}

export function getAppleIapProductId(): string {
  return process.env.APPLE_IAP_PRODUCT_ID || "";
}

// Remove Ads — a separate one-time (non-consumable) IAP product, distinct
// from the Pro subscription product above.
export function isAppleRemoveAdsConfigured(): boolean {
  return !!process.env.APPLE_IAP_REMOVE_ADS_PRODUCT_ID;
}

export function getAppleRemoveAdsProductId(): string {
  return process.env.APPLE_IAP_REMOVE_ADS_PRODUCT_ID || "";
}

// The app's bundle id is fixed (see app.config.js ios.bundleIdentifier);
// the numeric App Store Connect app id only matters for notification
// verification's cross-check and is public info (same value already
// committed in eas.json's submit.production.ios.ascAppId).
const BUNDLE_ID = "com.pullmarket.tcg";
const APP_APPLE_ID = process.env.APPLE_APP_STORE_ID ? Number(process.env.APPLE_APP_STORE_ID) : 6800160283;

let verifierProduction: SignedDataVerifier | null = null;
let verifierSandbox: SignedDataVerifier | null = null;

function getVerifier(environment: Environment): SignedDataVerifier {
  const rootCert = fs.readFileSync(ROOT_CERT_PATH);
  const verifier = new SignedDataVerifier([rootCert], true, environment, BUNDLE_ID, APP_APPLE_ID);
  if (environment === Environment.PRODUCTION) verifierProduction = verifier;
  else verifierSandbox = verifier;
  return verifier;
}

// A TestFlight build's purchases are always Sandbox transactions, while a
// real App Store release's are Production — rather than requiring an env
// var to track which is currently true (easy to forget to flip), just try
// Production first and fall back to Sandbox on an environment mismatch.
// Both verifications are equally strong; this only picks which Apple
// environment a given signed blob actually belongs to.
async function verifyWithFallback<T>(verify: (v: SignedDataVerifier) => Promise<T>): Promise<T> {
  try {
    return await verify(verifierProduction ?? getVerifier(Environment.PRODUCTION));
  } catch (err) {
    if (err instanceof VerificationException) {
      return await verify(verifierSandbox ?? getVerifier(Environment.SANDBOX));
    }
    throw err;
  }
}

export async function verifyAppleTransaction(signedTransaction: string): Promise<JWSTransactionDecodedPayload> {
  return verifyWithFallback((v) => v.verifyAndDecodeTransaction(signedTransaction));
}

export async function verifyAppleNotification(signedPayload: string): Promise<ResponseBodyV2DecodedPayload> {
  return verifyWithFallback((v) => v.verifyAndDecodeNotification(signedPayload));
}

/**
 * Apple's transaction payload doesn't carry a simple "status" enum the way
 * Stripe subscriptions do — a transaction is active if it hasn't expired
 * and hasn't been revoked (refunded/family-sharing-revoked). `EXPIRED` for
 * anything else, which the caller maps onto 'canceled' (there's no
 * meaningful "past_due" analogue at the transaction level — Apple retries
 * failed renewals on its own and either succeeds, issuing a new
 * transaction, or the subscription lapses to expired).
 */
export function isAppleTransactionActive(payload: JWSTransactionDecodedPayload): boolean {
  if (payload.revocationDate) return false;
  if (!payload.expiresDate) return false;
  return payload.expiresDate > Date.now();
}
