// Real "Sign in with Apple" — verifies the identityToken the native
// expo-apple-authentication modal hands back to the client, against
// Apple's own public signing keys. No app-side secret is needed for this
// (unlike Google/GitHub sign-in below): Apple signs the token with a key
// only it holds, and anyone can verify it against Apple's published JWKS —
// so this is always "configured", the moment the app ships the real
// bundle identifier below.
//
// The bundle identifier must be the app's real one (the audience Apple
// stamped the token for) — reuses the same override point as
// lib/payments/appleIap.ts for consistency.

import { createRemoteJWKSet, jwtVerify } from "jose";

const BUNDLE_ID = process.env.APPLE_IAP_BUNDLE_ID || "com.nexaai.chat";
const APPLE_JWKS = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));

export interface AppleIdentity {
  appleUserId: string;
  email: string | null;
}

export async function verifyAppleIdentityToken(identityToken: string): Promise<AppleIdentity> {
  const { payload } = await jwtVerify(identityToken, APPLE_JWKS, {
    issuer: "https://appleid.apple.com",
    audience: BUNDLE_ID,
  });
  const appleUserId = payload.sub;
  if (!appleUserId) throw new Error("Apple identity token has no subject");
  const email = typeof payload.email === "string" ? payload.email : null;
  return { appleUserId, email };
}
