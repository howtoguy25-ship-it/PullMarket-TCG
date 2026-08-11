import type { Request, Response, NextFunction } from "express";
import { verifyAuthToken } from "../lib/jwt";
import { db } from "../db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { User } from "@shared/schema";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export async function authenticateToken(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: "Not authenticated" });

  try {
    const payload = verifyAuthToken(token);
    const [user] = await db.select().from(users).where(eq(users.id, payload.userId));
    if (!user) return res.status(401).json({ message: "Not authenticated" });
    // Tokens are always signed with tokenVersion normalized to 0 (see
    // signAuthToken callers: `existing.tokenVersion ?? 0`) — normalize the
    // DB side the same way, or an account whose token_version column is
    // NULL (e.g. an older row from before this column existed) would fail
    // this check on every single request, immediately after every sign-in,
    // regardless of method, with no visible error.
    if ((user.tokenVersion ?? 0) !== payload.tokenVersion) return res.status(401).json({ message: "Session expired" });
    if (user.isSuspended) return res.status(403).json({ message: "This account has been suspended", suspensionReason: user.suspensionReason });
    if (user.deletedAt) return res.status(410).json({ message: "Account deleted" });

    req.user = user;
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired session" });
  }
}

export function requireOwner(req: Request, res: Response, next: NextFunction) {
  if (!req.user?.isOwner) return res.status(403).json({ message: "Owner access only" });
  next();
}
