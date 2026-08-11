import jwt from "jsonwebtoken";

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return secret;
}

export interface AuthTokenPayload {
  userId: string;
  tokenVersion: number;
}

// Users expect to stay signed in indefinitely — until they explicitly sign
// out or delete their account, not until an arbitrary token TTL lapses — so
// this is a long-lived session token rather than a short-lived one that
// needs silent refreshing. Sign-out/delete both still work instantly: the
// former discards the token client-side, the latter bumps tokenVersion
// server-side so any copy of the old token stops verifying (see
// middleware/auth.ts).
export function signAuthToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, getSecret(), { expiresIn: "3650d" });
}

export function verifyAuthToken(token: string): AuthTokenPayload {
  return jwt.verify(token, getSecret()) as AuthTokenPayload;
}
