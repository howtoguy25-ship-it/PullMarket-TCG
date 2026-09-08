// Owner-panel gate — an allowlist check against the logged-in account's own
// email/phone, per the user's explicit choice: no separate login system,
// just a server-side check on top of normal auth. Stored as env vars
// (OWNER_EMAIL / OWNER_PHONE) rather than hardcoded, so this file has no PII
// in it and the check is portable across environments.

import type { Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users } from "@shared/schema";
import type { AuthedRequest } from "./auth";

function normalizePhone(phone: string): string {
  return phone.replace(/[\s()-]/g, "");
}

export function isOwnerAccount(email: string, phone: string | null): boolean {
  const ownerEmail = process.env.OWNER_EMAIL?.toLowerCase().trim();
  const ownerPhone = process.env.OWNER_PHONE ? normalizePhone(process.env.OWNER_PHONE) : undefined;
  if (ownerEmail && email.toLowerCase().trim() === ownerEmail) return true;
  if (ownerPhone && phone && normalizePhone(phone) === ownerPhone) return true;
  return false;
}

/** Mount after requireAuth. 403s anyone whose account isn't the configured owner identity. */
export async function requireOwner(req: AuthedRequest, res: Response, next: NextFunction) {
  const [user] = await db.select().from(users).where(eq(users.id, req.userId!));
  if (!user || !isOwnerAccount(user.email, user.phone)) {
    return res.status(403).json({ error: "not_owner", message: "This area is restricted to the app owner." });
  }
  next();
}
