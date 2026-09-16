import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users } from "@shared/schema";

if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET must be set (see nexaai/.env.example)");
}
const JWT_SECRET = process.env.JWT_SECRET;

export interface AuthedRequest extends Request {
  userId?: string;
}

interface TokenPayload {
  sub: string;
  // Real per-user session-invalidation counter (users.tokenVersion) — see
  // requireAuth below and routes/owner.ts's force-logout action.
  tv: number;
}

export function signUserToken(userId: string, tokenVersion: number): string {
  return jwt.sign({ sub: userId, tv: tokenVersion } satisfies TokenPayload, JWT_SECRET, { expiresIn: "30d" });
}

/**
 * Real per-request enforcement of the owner panel's two account-level
 * controls (server/src/routes/owner.ts):
 *   - Suspend: an owner-suspended account is rejected here, on every
 *     authenticated call, not just at login — a token issued before the
 *     suspension still exists and is otherwise perfectly valid.
 *   - Force sign-out: a token's embedded tokenVersion is compared against
 *     the account's current one; bumping it (owner action) makes every
 *     already-issued token fail this check immediately, since there's no
 *     other way to revoke a stateless JWT before its own 30-day expiry.
 * The extra DB lookup this needs (an indexed primary-key read) is the real
 * cost of making both of those genuinely take effect immediately rather
 * than "eventually, once the token expires."
 */
export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing bearer token" });
  }
  let payload: TokenPayload;
  try {
    payload = jwt.verify(header.slice("Bearer ".length), JWT_SECRET) as TokenPayload;
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  try {
    const [user] = await db
      .select({ isSuspended: users.isSuspended, suspendedReason: users.suspendedReason, tokenVersion: users.tokenVersion })
      .from(users)
      .where(eq(users.id, payload.sub));
    if (!user) return res.status(401).json({ error: "Invalid or expired token" });
    if (user.tokenVersion !== payload.tv) {
      return res.status(401).json({ error: "session_revoked", message: "You've been signed out on this device. Please sign in again." });
    }
    if (user.isSuspended) {
      return res.status(403).json({
        error: "account_suspended",
        message: user.suspendedReason ? `Your account is suspended: ${user.suspendedReason}` : "Your account is suspended.",
      });
    }
  } catch {
    return res.status(500).json({ error: "auth_check_failed" });
  }

  req.userId = payload.sub;
  next();
}
