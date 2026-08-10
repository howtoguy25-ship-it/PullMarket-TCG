import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { users } from "@shared/schema";
import { eq, or, sql } from "drizzle-orm";
import { issueOtp, verifyOtp } from "../lib/otp";
import { signAuthToken } from "../lib/jwt";
import { authenticateToken } from "../middleware/auth";
import { OAuth2Client } from "google-auth-library";
import { getStripe, isStripeConfigured } from "../lib/stripeClient";

const router = Router();

const E164_RE = /^\+[1-9]\d{6,14}$/; // covers every country calling code
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isOwnerIdentity(phoneNumber?: string | null, email?: string | null): boolean {
  const ownerPhone = process.env.OWNER_PHONE_NUMBER;
  const ownerEmail = process.env.OWNER_EMAIL;
  if (ownerPhone && phoneNumber === ownerPhone) return true;
  if (ownerEmail && email && email.toLowerCase() === ownerEmail.toLowerCase()) return true;
  return false;
}

// ── Request OTP (phone, any country code, or email) ──────────────────────
router.post("/otp/request", async (req, res) => {
  const schema = z.object({
    destination: z.string().min(3),
    channel: z.enum(["sms", "email"]),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid request" });

  const { destination, channel } = parsed.data;
  if (channel === "sms" && !E164_RE.test(destination)) {
    return res.status(400).json({ message: "Enter a phone number in international format, e.g. +61412345678" });
  }
  if (channel === "email" && !EMAIL_RE.test(destination)) {
    return res.status(400).json({ message: "Enter a valid email address" });
  }

  const [existing] = await db
    .select()
    .from(users)
    .where(channel === "sms" ? eq(users.phoneNumber, destination) : eq(users.email, destination));

  await issueOtp(destination, channel, existing ? "signin" : "signup");
  res.json({ isNewUser: !existing });
});

// ── Verify OTP → sign in (existing user) or return a signup ticket ──────
router.post("/otp/verify", async (req, res) => {
  const schema = z.object({
    destination: z.string().min(3),
    channel: z.enum(["sms", "email"]),
    code: z.string().length(6),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid request" });

  const { destination, channel, code } = parsed.data;
  const ok = await verifyOtp(destination, code);
  if (!ok) return res.status(400).json({ message: "That code is invalid or has expired" });

  const [existing] = await db
    .select()
    .from(users)
    .where(channel === "sms" ? eq(users.phoneNumber, destination) : eq(users.email, destination));

  if (existing) {
    const token = signAuthToken({ userId: existing.id, tokenVersion: existing.tokenVersion ?? 0 });
    return res.json({ status: "signed_in", token, user: existing });
  }

  // New identity, verified — client now needs to collect a username to finish signup.
  res.json({ status: "needs_username", destination, channel });
});

// ── Finish signup: verified destination + chosen username ───────────────
router.post("/signup/complete", async (req, res) => {
  const schema = z.object({
    destination: z.string().min(3),
    channel: z.enum(["sms", "email"]),
    username: z
      .string()
      .min(3)
      .max(24)
      .regex(/^[a-zA-Z0-9_]+$/, "Letters, numbers, and underscores only"),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid request" });

  const { destination, channel, username } = parsed.data;

  const [usernameTaken] = await db.select().from(users).where(eq(users.username, username));
  if (usernameTaken) return res.status(409).json({ message: "That username is already taken" });

  const isOwner = isOwnerIdentity(channel === "sms" ? destination : null, channel === "email" ? destination : null);

  const [user] = await db
    .insert(users)
    .values({
      username,
      phoneNumber: channel === "sms" ? destination : null,
      email: channel === "email" ? destination : null,
      displayName: username,
      isOwner,
    })
    .returning();

  const token = signAuthToken({ userId: user.id, tokenVersion: user.tokenVersion ?? 0 });
  res.json({ token, user });
});

// ── Google Sign-In ────────────────────────────────────────────────────────
// Shared by both the native id-token flow and the web authorization-code
// flow below: looks up (or flags as new) the Google account behind a
// verified idToken.
async function resolveGoogleIdentity(idToken: string, clientId: string, res: import("express").Response) {
  const client = new OAuth2Client(clientId);
  const ticket = await client.verifyIdToken({ idToken, audience: clientId });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email) {
    res.status(400).json({ message: "Could not verify Google account" });
    return;
  }

  const [existing] = await db.select().from(users).where(eq(users.googleId, payload.sub));
  if (existing) {
    const token = signAuthToken({ userId: existing.id, tokenVersion: existing.tokenVersion ?? 0 });
    res.json({ status: "signed_in", token, user: existing });
    return;
  }

  const [byEmail] = await db.select().from(users).where(eq(users.email, payload.email));
  if (byEmail) {
    const [updated] = await db.update(users).set({ googleId: payload.sub }).where(eq(users.id, byEmail.id)).returning();
    const token = signAuthToken({ userId: updated.id, tokenVersion: updated.tokenVersion ?? 0 });
    res.json({ status: "signed_in", token, user: updated });
    return;
  }

  res.json({ status: "needs_username", googleId: payload.sub, email: payload.email, displayName: payload.name, avatarUrl: payload.picture });
}

// Native flow (future EAS build): client already holds a verified Google idToken.
router.post("/google", async (req, res) => {
  const schema = z.object({ idToken: z.string().min(10) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid request" });

  const clientId = process.env.GOOGLE_WEB_CLIENT_ID;
  if (!clientId) {
    return res.status(503).json({
      message: "Google Sign-In isn't configured yet. Set GOOGLE_WEB_CLIENT_ID (see .env.example) to enable it.",
    });
  }

  try {
    await resolveGoogleIdentity(parsed.data.idToken, clientId, res);
  } catch (err) {
    console.error("Google sign-in failed:", err);
    res.status(400).json({ message: "Google sign-in failed" });
  }
});

// Web flow: browser popup (Google Identity Services authorization-code UX)
// hands the client a one-time code instead of an idToken, since GIS's popup
// code flow is far less prone to being blocked by browser privacy features
// than the One Tap / idToken flow. The server exchanges it for tokens.
router.post("/google/code", async (req, res) => {
  const schema = z.object({ code: z.string().min(10) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid request" });

  const clientId = process.env.GOOGLE_WEB_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(503).json({
      message: "Google Sign-In isn't configured yet. Set GOOGLE_WEB_CLIENT_ID and GOOGLE_CLIENT_SECRET (see .env.example) to enable it.",
    });
  }

  try {
    // "postmessage" is the redirect_uri Google expects for its JS popup code flow.
    const codeClient = new OAuth2Client(clientId, clientSecret, "postmessage");
    const { tokens } = await codeClient.getToken(parsed.data.code);
    if (!tokens.id_token) return res.status(400).json({ message: "Google sign-in failed" });
    await resolveGoogleIdentity(tokens.id_token, clientId, res);
  } catch (err) {
    console.error("Google sign-in (code exchange) failed:", err);
    res.status(400).json({ message: "Google sign-in failed" });
  }
});

router.post("/google/signup/complete", async (req, res) => {
  const schema = z.object({
    googleId: z.string(),
    email: z.string().email(),
    displayName: z.string().optional(),
    avatarUrl: z.string().optional(),
    username: z.string().min(3).max(24).regex(/^[a-zA-Z0-9_]+$/),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid request" });
  const { googleId, email, displayName, avatarUrl, username } = parsed.data;

  const [usernameTaken] = await db.select().from(users).where(eq(users.username, username));
  if (usernameTaken) return res.status(409).json({ message: "That username is already taken" });

  const isOwner = isOwnerIdentity(null, email);

  const [user] = await db
    .insert(users)
    .values({ username, googleId, email, displayName: displayName || username, avatarUrl, isOwner })
    .returning();

  const token = signAuthToken({ userId: user.id, tokenVersion: user.tokenVersion ?? 0 });
  res.json({ token, user });
});

// ── Current user ──────────────────────────────────────────────────────────
router.get("/me", authenticateToken, async (req, res) => {
  res.json(req.user);
});

// ── Delete account ────────────────────────────────────────────────────────
router.post("/account/delete", authenticateToken, async (req, res) => {
  const userId = req.user!.id;
  await db
    .update(users)
    .set({
      deletedAt: new Date(),
      username: `deleted_${userId.slice(0, 8)}`,
      phoneNumber: null,
      email: null,
      googleId: null,
      displayName: "Deleted user",
      avatarUrl: null,
      pushToken: null,
      tokenVersion: sql`${users.tokenVersion} + 1`,
    })
    .where(eq(users.id, userId));
  res.json({ status: "deleted" });
});

// ── Stripe Identity verification (KYC before selling) ─────────────────────
router.post("/identity/start", authenticateToken, async (req, res) => {
  if (!isStripeConfigured()) {
    return res.status(503).json({ message: "Identity verification isn't configured yet. Set STRIPE_SECRET_KEY (see .env.example)." });
  }
  try {
    const stripe = getStripe();
    const session = await stripe.identity.verificationSessions.create({
      type: "document",
      options: { document: { require_matching_selfie: true } },
      metadata: { userId: req.user!.id },
    });
    await db
      .update(users)
      .set({ identityVerificationStatus: "pending", identityVerificationSessionId: session.id })
      .where(eq(users.id, req.user!.id));
    res.json({ url: session.url, clientSecret: session.client_secret });
  } catch (err) {
    console.error("Failed to start identity verification:", err);
    res.status(500).json({ message: "Could not start identity verification" });
  }
});

router.get("/identity/status", authenticateToken, async (req, res) => {
  res.json({
    status: req.user!.identityVerificationStatus,
    verifiedAt: req.user!.identityVerifiedAt,
  });
});

export default router;
