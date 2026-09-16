// Shared find-or-create logic for every social sign-in provider
// (apple.ts/google.ts/github.ts) — one real account per person regardless
// of which button they tapped, matching the same trial-grant treatment a
// normal email signup gets in routes/auth.ts.

import crypto from "crypto";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "../../db";
import { users } from "@shared/schema";
import { signUserToken } from "../../middleware/auth";
import { grantCredits } from "../credits";

const TRIAL_DAYS = 2;
const TRIAL_GRANT_CENTS = 500;

export type SocialProviderColumn = "appleUserId" | "googleAuthId" | "githubAuthId" | "phone";

/**
 * Finds the user already linked to this provider identity, else links an
 * existing account with a matching (real, provider-confirmed) email, else
 * creates a brand-new account. A social-only account still gets a real
 * passwordHash — a cryptographically random one nobody is ever told, since
 * the column is NOT NULL and password login just isn't offered for it.
 */
export async function findOrCreateSocialUser(
  providerColumn: SocialProviderColumn,
  providerUserId: string,
  email: string | null,
  displayName: string,
): Promise<typeof users.$inferSelect> {
  const [byProvider] = await db.select().from(users).where(eq(users[providerColumn], providerUserId));
  if (byProvider) return byProvider;

  if (email) {
    const [byEmail] = await db.select().from(users).where(eq(users.email, email));
    if (byEmail) {
      const [linked] = await db.update(users).set({ [providerColumn]: providerUserId }).where(eq(users.id, byEmail.id)).returning();
      return linked;
    }
  }

  const randomPasswordHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  // Phone sign-in has no email at all — build a synthetic, unique, RFC-clean
  // placeholder from the digits of the number rather than reusing the
  // AuthId/UserId-stripping trick meant for the OAuth providers below.
  const syntheticEmail =
    providerColumn === "phone"
      ? `phone-${providerUserId.replace(/\D/g, "")}@phone.nexaai.internal`
      : `${providerUserId}@${providerColumn.replace("AuthId", "").replace("UserId", "")}.nexaai.internal`;
  const [created] = await db
    .insert(users)
    .values({
      email: email ?? syntheticEmail,
      passwordHash: randomPasswordHash,
      displayName,
      trialEndsAt,
      [providerColumn]: providerUserId,
      ...(providerColumn === "phone" ? { phoneVerifiedAt: new Date() } : {}),
    })
    .returning();

  await grantCredits(db, created.id, TRIAL_GRANT_CENTS, { kind: "trial_grant", note: "2-day free trial grant" });
  return created;
}

export function issueTokenForSocialUser(userId: string, tokenVersion: number): string {
  return signUserToken(userId, tokenVersion);
}
