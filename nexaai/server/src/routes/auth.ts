import { Router } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { db } from "../db";
import { users } from "@shared/schema";
import { signUserToken, requireAuth, type AuthedRequest } from "../middleware/auth";
import { grantCredits } from "../lib/credits";
import { resolveCapabilities } from "../lib/capabilities";
import { getOwnerSettings } from "../lib/ownerSettings";
import { isOwnerAccount } from "../middleware/owner";
import { syncExpiredPlan } from "../lib/planExpiry";
import { verifyAppleIdentityToken } from "../lib/socialAuth/apple";
import { isGoogleSignInConfigured, buildGoogleSignInUrl } from "../lib/socialAuth/google";
import { isGithubSignInConfigured, buildGithubSignInUrl } from "../lib/socialAuth/github";
import { findOrCreateSocialUser, issueTokenForSocialUser } from "../lib/socialAuth/common";
import { isPhoneAuthConfigured, startPhoneVerification, checkPhoneVerification, E164_PATTERN } from "../lib/socialAuth/phone";
import { isEmailConfigured, sendEmail } from "../lib/email";
import { appBaseUrl } from "../lib/appBaseUrl";

export const authRouter = Router();

const TRIAL_DAYS = 2;
const TRIAL_GRANT_CENTS = 500; // free credit to actually exercise the app during the 2-day trial

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1).max(60),
  timezone: z.string().default("Australia/Sydney"),
});

authRouter.post("/signup", async (req, res) => {
  // Real, app-wide owner pause switch — scoped to this direct email/password
  // path only (the one most new-account creation actually goes through);
  // social sign-in's find-or-create doesn't have a clean single "is this a
  // brand-new account" checkpoint without deeper changes, so it isn't
  // covered here — a known, deliberate scope limit, not an oversight.
  if (!(await getOwnerSettings()).newSignupsEnabled) {
    return res.status(503).json({ error: "signups_paused", message: "New signups are temporarily paused. Please try again shortly." });
  }
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { email, password, displayName, timezone } = parsed.data;

  const [existing] = await db.select().from(users).where(eq(users.email, email));
  if (existing) return res.status(409).json({ error: "Email already registered" });

  const passwordHash = await bcrypt.hash(password, 10);
  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

  const [user] = await db
    .insert(users)
    .values({ email, passwordHash, displayName, timezone, trialEndsAt })
    .returning();

  // No usageWindows row needed here — middleware/usage.ts creates one
  // lazily (with real defaults) the first time this user's usage is
  // actually checked, rather than pre-seeding an unused row per signup.
  await grantCredits(db, user.id, TRIAL_GRANT_CENTS, { kind: "trial_grant", note: "2-day free trial grant" });

  res.status(201).json({ token: signUserToken(user.id, user.tokenVersion), user: publicUser(user) });
});

const loginSchema = z.object({ email: z.string().email(), password: z.string() });
authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const [user] = await db.select().from(users).where(eq(users.email, parsed.data.email));
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  // Real, immediate rejection here — the same suspension state
  // middleware/auth.ts's requireAuth would otherwise only catch on the
  // user's very first authenticated call after a token is issued.
  if (user.isSuspended) {
    return res.status(403).json({
      error: "account_suspended",
      message: user.suspendedReason ? `Your account is suspended: ${user.suspendedReason}` : "Your account is suspended.",
    });
  }
  res.json({ token: signUserToken(user.id, user.tokenVersion), user: publicUser(user) });
});

// Native "Sign in with Apple" — the client already has the verified
// identity token from expo-apple-authentication's own OS-level modal,
// so this is a single verify-and-issue-token call, no redirect dance.
const appleSignInSchema = z.object({ identityToken: z.string().min(1), fullName: z.string().optional() });
authRouter.post("/apple", async (req, res) => {
  const parsed = appleSignInSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const { appleUserId, email } = await verifyAppleIdentityToken(parsed.data.identityToken);
    const user = await findOrCreateSocialUser("appleUserId", appleUserId, email, parsed.data.fullName || "NexaAi user");
    res.status(201).json({ token: issueTokenForSocialUser(user.id, user.tokenVersion), user: publicUser(user) });
  } catch (err) {
    res.status(401).json({ error: "apple_signin_failed", message: err instanceof Error ? err.message : "Couldn't verify with Apple." });
  }
});

// Real IP-based geolocation for the phone sign-in country picker's default
// (AuthScreen.tsx) — Cloudflare, already sitting in front of every request
// to this app, stamps every request reaching origin with the real GeoIP
// country as `CF-IPCountry`, at zero cost and with no third-party API key
// to manage. Only real on a Cloudflare-proxied deployment (this app's own
// production setup) — on a bare `npm run dev` origin with no CDN in front,
// the header is simply absent and the client falls back to its own
// locale-based guess (lib/countries.ts's detectDefaultCountry).
authRouter.get("/geo", (req, res) => {
  const countryCode = req.header("CF-IPCountry");
  res.json({ countryCode: countryCode && countryCode !== "XX" ? countryCode : null });
});

// Google/GitHub sign-in are browser-redirect flows (WebBrowser.openAuthSessionAsync
// on the client) — these just hand back the real authorize URL, or an
// honest "not configured" if the real OAuth app credentials aren't set.
// Cache-Control: no-store is real, not defensive boilerplate — each authUrl
// embeds a fresh one-time `state` JWT (10-minute expiry) that must never be
// served twice. Express auto-generates an ETag for any JSON body, and with
// no explicit Cache-Control this response is otherwise heuristically
// cacheable — a retry after the first `state` expires (or a shared/edge
// cache) could hand back a stale, already-expired authUrl instead of a
// fresh one, exactly the "worked once, now silently fails" failure mode.
authRouter.get("/google/start", (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!isGoogleSignInConfigured()) {
    return res.status(503).json({ error: "not_configured", message: "Google sign-in isn't set up on this server yet — set GOOGLE_AUTH_CLIENT_ID/_SECRET." });
  }
  // ?platform=web (sent only by the web build, AuthScreen.tsx) tells the
  // callback to redirect back as a real https:// URL on this same origin
  // instead of nexaai://auth-callback, which no browser can ever follow —
  // see socialAuth/google.ts's buildGoogleSignInUrl/redirectToApp.
  const platform = req.query.platform === "web" ? "web" : "native";
  res.json({ authUrl: buildGoogleSignInUrl(platform) });
});
authRouter.get("/github/start", (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!isGithubSignInConfigured()) {
    return res.status(503).json({ error: "not_configured", message: "GitHub sign-in isn't set up on this server yet — set GITHUB_AUTH_CLIENT_ID/_SECRET." });
  }
  const platform = req.query.platform === "web" ? "web" : "native";
  res.json({ authUrl: buildGithubSignInUrl(platform) });
});

// Real phone sign-in via Twilio Verify (lib/socialAuth/phone.ts) — a real
// SMS code is sent and checked server-side; the app never sees or trusts a
// code on its own. Same account for a returning phone number, same
// 2-day-trial treatment as every other new signup.
const phoneStartSchema = z.object({ phone: z.string().regex(E164_PATTERN, "Enter your number in international format, e.g. +14155552671.") });
authRouter.post("/phone/start", async (req, res) => {
  if (!isPhoneAuthConfigured()) {
    return res.status(503).json({ error: "not_configured", message: "Phone sign-in isn't set up on this server yet — set TWILIO_VERIFY_ACCOUNT_SID/_AUTH_TOKEN/_SERVICE_SID." });
  }
  const parsed = phoneStartSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    await startPhoneVerification(parsed.data.phone);
    res.json({ sent: true });
  } catch (err) {
    res.status(502).json({ error: "send_failed", message: err instanceof Error ? err.message : "Couldn't send a code to that number." });
  }
});

const phoneVerifySchema = z.object({
  phone: z.string().regex(E164_PATTERN),
  code: z.string().min(4).max(10),
  displayName: z.string().min(1).max(60).optional(),
});
authRouter.post("/phone/verify", async (req, res) => {
  if (!isPhoneAuthConfigured()) {
    return res.status(503).json({ error: "not_configured", message: "Phone sign-in isn't set up on this server yet — set TWILIO_VERIFY_ACCOUNT_SID/_AUTH_TOKEN/_SERVICE_SID." });
  }
  const parsed = phoneVerifySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const approved = await checkPhoneVerification(parsed.data.phone, parsed.data.code);
  if (!approved) return res.status(401).json({ error: "invalid_code", message: "That code is incorrect or expired. Request a new one." });

  const user = await findOrCreateSocialUser("phone", parsed.data.phone, null, parsed.data.displayName || "NexaAi user");
  res.status(201).json({ token: issueTokenForSocialUser(user.id, user.tokenVersion), user: publicUser(user) });
});

// Real "forgot password" — a genuine one-time token, hashed at rest, mailed
// through Resend (lib/email.ts). Always responds the same way regardless of
// whether the email is actually registered, so this can't be used to probe
// which emails have accounts.
const forgotPasswordSchema = z.object({ email: z.string().email() });
authRouter.post("/forgot-password", async (req, res) => {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const genericResponse = { ok: true, message: "If that email has a NexaAi account, a reset link is on its way." };
  if (!isEmailConfigured()) {
    // Honest about the real reason nothing was sent, without leaking
    // whether the address is registered — same generic body either way.
    return res.json({ ...genericResponse, delivered: false });
  }

  const [user] = await db.select().from(users).where(eq(users.email, parsed.data.email));
  if (user) {
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await db.update(users).set({ passwordResetTokenHash: tokenHash, passwordResetExpiresAt: expiresAt }).where(eq(users.id, user.id));

    const resetUrl = `${appBaseUrl()}/account/reset-password.html?token=${rawToken}&email=${encodeURIComponent(user.email)}`;
    try {
      await sendEmail(
        user.email,
        "Reset your NexaAi password",
        `<p>Someone requested a password reset for your NexaAi account.</p>` +
          `<p><a href="${resetUrl}">Click here to set a new password</a> — this link works for 30 minutes.</p>` +
          `<p>If this wasn't you, you can ignore this email; your password won't change.</p>`,
      );
    } catch (err) {
      // A real Resend failure (bad key, suspended account, etc.) — log it
      // server-side but still return the generic response, never leaking
      // send-provider errors to whoever's hitting this endpoint.
      console.error("[forgot-password] sendEmail failed:", err instanceof Error ? err.message : err);
    }
  }
  res.json({ ...genericResponse, delivered: true });
});

const resetPasswordSchema = z.object({ email: z.string().email(), token: z.string().min(1), newPassword: z.string().min(8) });
authRouter.post("/reset-password", async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const [user] = await db.select().from(users).where(eq(users.email, parsed.data.email));
  if (!user || !user.passwordResetTokenHash || !user.passwordResetExpiresAt || user.passwordResetExpiresAt < new Date()) {
    return res.status(400).json({ error: "invalid_or_expired", message: "That reset link is invalid or has expired. Request a new one." });
  }

  const suppliedHash = crypto.createHash("sha256").update(parsed.data.token).digest("hex");
  const storedHash = Buffer.from(user.passwordResetTokenHash);
  const suppliedHashBuf = Buffer.from(suppliedHash);
  if (storedHash.length !== suppliedHashBuf.length || !crypto.timingSafeEqual(storedHash, suppliedHashBuf)) {
    return res.status(400).json({ error: "invalid_or_expired", message: "That reset link is invalid or has expired. Request a new one." });
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
  await db.update(users).set({ passwordHash, passwordResetTokenHash: null, passwordResetExpiresAt: null }).where(eq(users.id, user.id));
  res.json({ ok: true, message: "Password updated. You can log in with it now." });
});

authRouter.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  // Lazy plan-expiry check — see lib/planExpiry.ts — catches a lapsed
  // Paddle/Apple subscription on the app's own most-frequent touchpoint.
  await syncExpiredPlan(req.userId!);
  const [user] = await db.select().from(users).where(eq(users.id, req.userId!));
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ user: publicUser(user) });
});

const settingsSchema = z.object({
  preferredMapsApp: z.enum(["apple", "google", "trackline"]).optional(),
  voiceCharacterId: z.string().optional(),
  proactiveCheckInEnabled: z.boolean().optional(),
  cameraPermissionGranted: z.boolean().optional(),
  micPermissionGranted: z.boolean().optional(),
  memoryEnabled: z.boolean().optional(),
  referenceChatsEnabled: z.boolean().optional(),
  includeSensitiveInMemory: z.boolean().optional(),
  fontChoice: z.enum(["inter", "fraunces", "space_grotesk"]).optional(),
  themeId: z.enum(["dark", "light"]).optional(),
  defaultFocusMode: z.enum(["quick", "build", "auto", "gorilla"]).optional(),
  autoRechargeEnabled: z.boolean().optional(),
  autoRechargeThresholdCents: z.number().int().min(0).max(10000).optional(),
  autoRechargePackLabel: z.enum(["$35", "$80", "$115", "$175"]).optional(),
});
authRouter.patch("/settings", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const [user] = await db.update(users).set(parsed.data).where(eq(users.id, req.userId!)).returning();
  res.json({ user: publicUser(user) });
});

// Capabilities are stored as one jsonb blob, so a patch must read-merge-write
// rather than overwrite the column (else toggling one feature would silently
// reset every other one to its default).
const capabilitiesPatchSchema = z.object({
  cameraAsk: z.boolean().optional(),
  webLookup: z.boolean().optional(),
  whoIsLookup: z.boolean().optional(),
  agentBuilder: z.boolean().optional(),
  autoSpeak: z.boolean().optional(),
  liveTyping: z.boolean().optional(),
  voiceChat: z.boolean().optional(),
  topicImages: z.boolean().optional(),
  smartBuild: z.boolean().optional(),
});
authRouter.patch("/capabilities", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = capabilitiesPatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const [existing] = await db.select().from(users).where(eq(users.id, req.userId!));
  if (!existing) return res.status(404).json({ error: "User not found" });

  const merged = { ...resolveCapabilities(existing.capabilities), ...parsed.data };
  const [user] = await db.update(users).set({ capabilities: merged }).where(eq(users.id, req.userId!)).returning();
  res.json({ user: publicUser(user) });
});

authRouter.post("/onboarding-complete", requireAuth, async (req: AuthedRequest, res) => {
  const [user] = await db.update(users).set({ onboardingCompletedAt: new Date() }).where(eq(users.id, req.userId!)).returning();
  res.json({ user: publicUser(user) });
});

// Smart Build's two in-chat banners (ChatScreen.tsx) — each dismissal is a
// real, one-time, server-persisted event (same durable pattern as
// onboarding-complete above), optionally carrying the user's on/off choice
// so picking it straight from the banner is a single round trip instead of
// a separate capabilities PATCH.
const smartBuildBannerSchema = z.object({ enabled: z.boolean().optional() });
authRouter.post("/smart-build/intro-seen", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = smartBuildBannerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const [existing] = await db.select().from(users).where(eq(users.id, req.userId!));
  if (!existing) return res.status(404).json({ error: "User not found" });

  const capabilities = parsed.data.enabled === undefined ? undefined : { ...resolveCapabilities(existing.capabilities), smartBuild: parsed.data.enabled };
  const [user] = await db
    .update(users)
    .set({ smartBuildIntroDismissedAt: new Date(), ...(capabilities ? { capabilities } : {}) })
    .where(eq(users.id, req.userId!))
    .returning();
  res.json({ user: publicUser(user) });
});
authRouter.post("/smart-build/followup-seen", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = smartBuildBannerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const [existing] = await db.select().from(users).where(eq(users.id, req.userId!));
  if (!existing) return res.status(404).json({ error: "User not found" });

  const capabilities = parsed.data.enabled === undefined ? undefined : { ...resolveCapabilities(existing.capabilities), smartBuild: parsed.data.enabled };
  const [user] = await db
    .update(users)
    .set({ smartBuildFollowUpDismissedAt: new Date(), ...(capabilities ? { capabilities } : {}) })
    .where(eq(users.id, req.userId!))
    .returning();
  res.json({ user: publicUser(user) });
});

// Real account deletion — requires re-entering the password (a real
// security check, not a formality) and actually deletes the row. Every
// other table's userId column is declared onDelete:"cascade" in
// shared/src/schema.ts, so Postgres itself removes every chat, credit
// transaction, agent, connector, project, memory entry, API key, etc. —
// this isn't a soft "deactivated" flag the data quietly survives.
const deleteAccountSchema = z.object({ password: z.string().min(1) });
authRouter.post("/delete-account", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = deleteAccountSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const [user] = await db.select().from(users).where(eq(users.id, req.userId!));
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    return res.status(401).json({ error: "Incorrect password" });
  }

  await db.delete(users).where(eq(users.id, req.userId!));
  res.status(204).end();
});

function publicUser(user: typeof users.$inferSelect) {
  // paddleCustomerId/autoRechargeInFlightAt are internal auto-recharge
  // plumbing (lib/autoRecharge.ts) — never the client's business. What the
  // client does need is whether it can trust the server to auto-recharge
  // silently (a real saved Stripe payment method on file) versus needing
  // to auto-prompt Apple's own purchase sheet itself — see this file's
  // header comment on autoRechargeEnabled for why those genuinely differ.
  // passwordResetTokenHash/passwordResetExpiresAt are internal
  // forgot-password state (routes/auth.ts's forgot/reset-password) — never
  // the client's business either, even hashed.
  const { passwordHash, paddleCustomerId, stripeCustomerId, autoRechargeInFlightAt, passwordResetTokenHash, passwordResetExpiresAt, ...rest } = user;
  return {
    ...rest,
    capabilities: resolveCapabilities(user.capabilities),
    isOwner: isOwnerAccount(user.email, user.phone),
    hasStripePaymentMethodOnFile: !!stripeCustomerId,
  };
}
