import { Router } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "../db";
import { users, usageWindows } from "@shared/schema";
import { signUserToken, requireAuth, type AuthedRequest } from "../middleware/auth";
import { grantCredits } from "../lib/credits";
import { resolveCapabilities } from "../lib/capabilities";
import { isOwnerAccount } from "../middleware/owner";

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

  await db.insert(usageWindows).values({
    userId: user.id,
    weekStartAt: new Date(),
    dayStartAt: new Date(),
  });
  await grantCredits(db, user.id, TRIAL_GRANT_CENTS, { kind: "trial_grant", note: "2-day free trial grant" });

  res.status(201).json({ token: signUserToken(user.id), user: publicUser(user) });
});

const loginSchema = z.object({ email: z.string().email(), password: z.string() });
authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const [user] = await db.select().from(users).where(eq(users.email, parsed.data.email));
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  res.json({ token: signUserToken(user.id), user: publicUser(user) });
});

authRouter.get("/me", requireAuth, async (req: AuthedRequest, res) => {
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
  themeId: z.enum(["galaxy_violet", "nebula_rose", "deep_ocean", "solar_amber"]).optional(),
  defaultFocusMode: z.enum(["quick", "build", "auto", "gorilla"]).optional(),
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
  const { passwordHash, ...rest } = user;
  return { ...rest, capabilities: resolveCapabilities(user.capabilities), isOwner: isOwnerAccount(user.email, user.phone) };
}
