// Real Apple StoreKit transaction verification — cryptographically checks a
// signed transaction against Apple's own root CA, the same way any App
// Store Server Notifications integration does. No App Store Connect API
// key is needed for this (a key is only required to proactively *call*
// Apple's API — refund history, extending renewals, etc.) — verifying data
// Apple already signed and handed to the device only needs its public root
// certificate, bundled at server/assets/apple/AppleRootCA-G3.cer (public
// data, downloadable from apple.com/certificateauthority, not a secret).
//
// Two real product families:
//   - Pro/Max subscriptions (APPLE_IAP_PRO_PRODUCT_ID / APPLE_IAP_MAX_PRODUCT_ID)
//     — auto-renewable, verified in routes/plans.ts's /apple/verify.
//   - Credit packs (APPLE_IAP_CREDITS_35_PRODUCT_ID and friends) — consumable,
//     verified in routes/credits.ts's /apple/verify.
// All product ids must be created in App Store Connect first and match
// CREDIT_PACKS / PLAN_DEFINITIONS exactly — the client's purchase button
// simply doesn't appear for a product id that isn't set.

import fs from "fs";
import path from "path";
import { SignedDataVerifier, Environment, VerificationException, VerificationStatus } from "@apple/app-store-server-library";
import type { JWSTransactionDecodedPayload } from "@apple/app-store-server-library";
import type { PlanTier } from "../plans";

// process.cwd(), not __dirname — see routes/attachments.ts's UPLOADS_DIR
// comment for why an __dirname-relative path breaks in the bundled
// production build (server:build flattens everything into one file at a
// different depth than the dev source tree).
const ROOT_CERT_PATH = path.resolve(process.cwd(), "server/assets/apple/AppleRootCA-G3.cer");

export function isAppleIapConfigured(): boolean {
  return !!(process.env.APPLE_IAP_PRO_PRODUCT_ID || process.env.APPLE_IAP_MAX_PRODUCT_ID);
}

const PLAN_PRODUCT_ENV: Record<"pro" | "max", string> = {
  pro: "APPLE_IAP_PRO_PRODUCT_ID",
  max: "APPLE_IAP_MAX_PRODUCT_ID",
};

/** Maps a verified transaction's productId back to which plan tier it bought, or null if it's not a plan product (e.g. a credit pack). */
export function planTierForAppleProductId(productId: string): Extract<PlanTier, "pro" | "max"> | null {
  if (productId && productId === process.env.APPLE_IAP_PRO_PRODUCT_ID) return "pro";
  if (productId && productId === process.env.APPLE_IAP_MAX_PRODUCT_ID) return "max";
  return null;
}

const CREDIT_PACK_PRODUCT_ENV: Record<string, string> = {
  "$35": "APPLE_IAP_CREDITS_35_PRODUCT_ID",
  "$80": "APPLE_IAP_CREDITS_80_PRODUCT_ID",
  "$115": "APPLE_IAP_CREDITS_115_PRODUCT_ID",
  "$175": "APPLE_IAP_CREDITS_175_PRODUCT_ID",
};

/** Maps a verified transaction's productId back to which credit pack it bought, or null if it's not a credit-pack product. */
export function creditPackForAppleProductId(productId: string): string | null {
  for (const [label, envVar] of Object.entries(CREDIT_PACK_PRODUCT_ENV)) {
    if (productId && productId === process.env[envVar]) return label;
  }
  return null;
}

export function applePlanProductId(tier: "pro" | "max"): string | undefined {
  return process.env[PLAN_PRODUCT_ENV[tier]];
}

export function appleCreditPackProductId(packLabel: string): string | undefined {
  const envVar = CREDIT_PACK_PRODUCT_ENV[packLabel];
  return envVar ? process.env[envVar] : undefined;
}

const BUNDLE_ID = process.env.APPLE_IAP_BUNDLE_ID || "com.nexaai.chat";
const APP_APPLE_ID = process.env.APPLE_APP_STORE_ID ? Number(process.env.APPLE_APP_STORE_ID) : 0;

let verifierProduction: SignedDataVerifier | null = null;
let verifierSandbox: SignedDataVerifier | null = null;

function getVerifier(environment: Environment): SignedDataVerifier {
  const rootCert = fs.readFileSync(ROOT_CERT_PATH);
  const verifier = new SignedDataVerifier([rootCert], true, environment, BUNDLE_ID, APP_APPLE_ID);
  if (environment === Environment.PRODUCTION) verifierProduction = verifier;
  else verifierSandbox = verifier;
  return verifier;
}

// A TestFlight build's purchases are always Sandbox transactions, a real App
// Store release's are Production — rather than requiring an env var to
// track which is currently true (easy to forget to flip on release day),
// try Production first and fall back to Sandbox on an environment mismatch.
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

// VerificationException carries its reason in a `status` enum rather than a
// populated Error.message (the library's own constructor calls bare
// `super()`) — translate it so API error responses actually say something.
function describeVerificationFailure(status: VerificationStatus): string {
  switch (status) {
    case VerificationStatus.INVALID_APP_IDENTIFIER:
      return "This transaction was signed for a different app bundle.";
    case VerificationStatus.INVALID_ENVIRONMENT:
      return "This transaction is from an unexpected App Store environment.";
    case VerificationStatus.INVALID_CHAIN_LENGTH:
    case VerificationStatus.INVALID_CERTIFICATE:
      return "This transaction's signing certificate could not be verified.";
    case VerificationStatus.RETRYABLE_VERIFICATION_FAILURE:
      return "Could not reach Apple to verify this transaction — try again.";
    default:
      return "This transaction could not be verified.";
  }
}

export async function verifyAppleTransaction(signedTransaction: string): Promise<JWSTransactionDecodedPayload> {
  try {
    return await verifyWithFallback((v) => v.verifyAndDecodeTransaction(signedTransaction));
  } catch (err) {
    if (err instanceof VerificationException) {
      throw new Error(describeVerificationFailure(err.status));
    }
    throw err;
  }
}

/**
 * Apple's transaction payload doesn't carry a simple "status" enum the way
 * Stripe/Paddle subscriptions do — a transaction is active if it hasn't
 * expired and hasn't been revoked (refunded/family-sharing-revoked).
 */
export function isAppleTransactionActive(payload: JWSTransactionDecodedPayload): boolean {
  if (payload.revocationDate) return false;
  if (!payload.expiresDate) return true; // consumables (credit packs) never expire — presence of a purchase is enough
  return payload.expiresDate > Date.now();
}
