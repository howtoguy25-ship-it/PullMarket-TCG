// Real owner panel — every number here is a live aggregate query against
// the actual tables, not mock data. Gated by requireOwner (allowlist check
// on the logged-in account's email/phone against OWNER_EMAIL/OWNER_PHONE).

import { Router } from "express";
import { z } from "zod";
import { sql, eq, desc, count } from "drizzle-orm";
import { db } from "../db";
import { users, creditTransactions, creditDisputes, messages, chatSessions, agents, connectors, voiceTurns, projects, apiKeys, reasoningEffortCapEnum, planTierEnum } from "@shared/schema";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { requireOwner, isOwnerAccount } from "../middleware/owner";
import { grantCredits, getCreditBalanceCents } from "../lib/credits";
import { getOwnerSettings, updateOwnerSettings } from "../lib/ownerSettings";
import { isChatConfigured } from "../lib/anthropic";
import { isGoogleSignInConfigured } from "../lib/socialAuth/google";
import { isGithubSignInConfigured } from "../lib/socialAuth/github";
import { isPhoneAuthConfigured } from "../lib/socialAuth/phone";
import { isAppleIapConfigured } from "../lib/payments/appleIap";
import { stripeProvider } from "../lib/payments/stripe";
import { paddleProvider } from "../lib/payments/paddle";
import { isEmailConfigured } from "../lib/email";
import { isSelfHostedConfigured } from "../lib/selfHostedModel";
import { isGeminiConfigured } from "../lib/geminiModel";
import { isSpeechToTextConfigured } from "../lib/voice/speechToText";
import { isTextToSpeechConfigured } from "../lib/voice/textToSpeech";
import { isWhoIsSearchConfigured } from "../lib/whoIsSearch";
import { isMetaConfigured } from "../lib/connectors/meta";
import { isSlackConfigured } from "../lib/connectors/slack";
import { isXConfigured } from "../lib/connectors/x";
import { isNotionConfigured } from "../lib/connectors/notion";
import { isGitHubConnectorConfigured } from "../lib/connectors/github";
import { isGoogleConnectorConfigured } from "../lib/connectors/google";
import { isVercelConnectorConfigured } from "../lib/connectors/vercel";
import { isNetlifyConnectorConfigured } from "../lib/connectors/netlify";
import { isStripeConnectorConfigured } from "../lib/connectors/stripe";
import { isSiteSparkConnectorConfigured, isSiteSparkApiConfigured } from "../lib/connectors/sitespark";

export const ownerRouter = Router();
ownerRouter.use(requireAuth, requireOwner);

// ---------------------------------------------------------------------------
// Status — real, live configuration checks for every feature that depends
// on a real credential (API key, OAuth client, etc.), calling each
// feature's own isXConfigured() the exact same way its real code path
// already does — never a static checklist that can drift from what's
// actually wired up on THIS server, right now.
// ---------------------------------------------------------------------------

ownerRouter.get("/status", async (_req: AuthedRequest, res) => {
  res.json({
    groups: [
      {
        label: "Core AI",
        items: [
          { name: "Claude chat (Anthropic API)", configured: isChatConfigured() },
          { name: "Beginner-tier self-hosted model", configured: isSelfHostedConfigured() },
          { name: "Gemini (voice reasoning speed-lane)", configured: isGeminiConfigured() },
          { name: "Who-is web search deep-dive", configured: isWhoIsSearchConfigured() },
        ],
      },
      {
        label: "Sign-in",
        items: [
          { name: "Google sign-in", configured: isGoogleSignInConfigured() },
          { name: "GitHub sign-in", configured: isGithubSignInConfigured() },
          { name: "Phone sign-in (Twilio Verify)", configured: isPhoneAuthConfigured() },
          { name: "Password reset email", configured: isEmailConfigured() },
          { name: "Apple In-App Purchase (iOS plans/credits)", configured: isAppleIapConfigured() },
        ],
      },
      {
        label: "Payments",
        items: [
          { name: "Stripe (active web/Android provider)", configured: stripeProvider.isConfigured() },
          { name: "Paddle (dormant fallback provider)", configured: paddleProvider.isConfigured() },
        ],
      },
      {
        label: "Voice",
        items: [
          { name: "Speech-to-text (OpenAI Whisper)", configured: isSpeechToTextConfigured() },
          { name: "Text-to-speech (OpenAI)", configured: isTextToSpeechConfigured() },
        ],
      },
      {
        label: "Connectors (Connectors screen)",
        items: [
          { name: "Meta (Instagram/WhatsApp agents)", configured: isMetaConfigured() },
          { name: "Slack", configured: isSlackConfigured() },
          { name: "X (Twitter)", configured: isXConfigured() },
          { name: "Notion", configured: isNotionConfigured() },
          { name: "GitHub (repo push, separate from sign-in)", configured: isGitHubConnectorConfigured() },
          { name: "Google Calendar", configured: isGoogleConnectorConfigured() },
          { name: "Vercel", configured: isVercelConnectorConfigured() },
          { name: "Netlify", configured: isNetlifyConnectorConfigured() },
          { name: "Stripe Connect (users' own accounts)", configured: isStripeConnectorConfigured() },
          { name: "SiteSpark OAuth", configured: isSiteSparkConnectorConfigured() },
          { name: "SiteSpark API (site generation)", configured: isSiteSparkApiConfigured() },
        ],
      },
    ],
  });
});

ownerRouter.get("/settings", async (_req: AuthedRequest, res) => {
  res.json({ settings: await getOwnerSettings() });
});

const settingsPatchSchema = z.object({
  webLookupEnabled: z.boolean().optional(),
  voiceChatEnabled: z.boolean().optional(),
  agentBuilderEnabled: z.boolean().optional(),
  memoryEnabled: z.boolean().optional(),
  smartBuildEnabled: z.boolean().optional(),
  newSignupsEnabled: z.boolean().optional(),
  reasoningEffortCap: z.enum(reasoningEffortCapEnum.enumValues).nullable().optional(),
});
ownerRouter.patch("/settings", async (req: AuthedRequest, res) => {
  const parsed = settingsPatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.json({ settings: await updateOwnerSettings(parsed.data) });
});

ownerRouter.get("/overview", async (_req: AuthedRequest, res) => {
  const [[userCount], [revenue], [messageCount], [voiceTurnCount], [activeAgentCount], [projectCount], [apiKeyCount], connectorRows] = await Promise.all([
    db.select({ n: count() }).from(users),
    db.select({ total: sql<number>`coalesce(sum(${creditTransactions.amountCents}), 0)` }).from(creditTransactions).where(sql`${creditTransactions.amountCents} > 0`),
    db.select({ n: count() }).from(messages),
    db.select({ n: count() }).from(voiceTurns),
    db.select({ n: count() }).from(agents).where(eq(agents.isActive, true)),
    db.select({ n: count() }).from(projects),
    db.select({ n: count() }).from(apiKeys),
    db.select({ provider: connectors.provider, n: count() }).from(connectors).where(eq(connectors.status, "connected")).groupBy(connectors.provider),
  ]);

  res.json({
    totalUsers: userCount.n,
    totalRevenueCents: revenue.total,
    totalMessages: messageCount.n,
    totalVoiceTurns: voiceTurnCount.n,
    activeAgents: activeAgentCount.n,
    totalProjects: projectCount.n,
    totalApiKeys: apiKeyCount.n,
    connectedByProvider: Object.fromEntries(connectorRows.map((r) => [r.provider, r.n])),
  });
});

ownerRouter.get("/users", async (_req: AuthedRequest, res) => {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      phone: users.phone,
      planTier: users.planTier,
      createdAt: users.createdAt,
      trialEndsAt: users.trialEndsAt,
      isSuspended: users.isSuspended,
      suspendedReason: users.suspendedReason,
    })
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(200);

  const balances = await db
    .select({ userId: creditTransactions.userId, balance: sql<number>`coalesce(sum(${creditTransactions.amountCents}), 0)` })
    .from(creditTransactions)
    .groupBy(creditTransactions.userId);
  const balanceByUser = new Map(balances.map((b) => [b.userId, b.balance]));

  res.json({ users: rows.map((u) => ({ ...u, creditBalanceCents: balanceByUser.get(u.id) ?? 0 })) });
});

ownerRouter.get("/users/:id/history", async (req: AuthedRequest, res) => {
  const userId = req.params.id;
  const [sessionRows, projectRows, agentRows, connectorRows, recentMessages] = await Promise.all([
    db.select().from(chatSessions).where(eq(chatSessions.userId, userId)).orderBy(desc(chatSessions.startedAt)).limit(50),
    db.select().from(projects).where(eq(projects.userId, userId)).orderBy(desc(projects.updatedAt)),
    db.select().from(agents).where(eq(agents.userId, userId)),
    db.select().from(connectors).where(eq(connectors.userId, userId)),
    // Deliberately unfiltered by hiddenAt — the owner panel's whole point is
    // to be the one place the FULL, permanent record stays visible, even for
    // messages a user has "deleted" from their own History screen (a real
    // soft delete — see shared/src/schema.ts's messages.hiddenAt). `hiddenAt`
    // itself is returned so the owner UI can mark which ones that was.
    db
      .select({
        id: messages.id,
        role: messages.role,
        kind: messages.kind,
        content: messages.content,
        metadata: messages.metadata,
        createdAt: messages.createdAt,
        hiddenAt: messages.hiddenAt,
        sessionId: messages.sessionId,
      })
      .from(messages)
      .innerJoin(chatSessions, eq(messages.sessionId, chatSessions.id))
      .where(eq(chatSessions.userId, userId))
      .orderBy(desc(messages.createdAt))
      .limit(300),
  ]);

  res.json({ sessions: sessionRows, projects: projectRows, agents: agentRows, connectors: connectorRows, recentMessages });
});

// Real, permanent audit trail of every "report an issue" a user has filed —
// approved and declined alike, each with its real reasoning (lib/creditDisputes.ts
// never fabricates one). This is the human safety net: /override below lets
// the owner manually flip a declined dispute the AI got wrong.
ownerRouter.get("/disputes", async (_req: AuthedRequest, res) => {
  const rows = await db
    .select({
      id: creditDisputes.id,
      userId: creditDisputes.userId,
      userEmail: users.email,
      userDisplayName: users.displayName,
      creditTransactionId: creditDisputes.creditTransactionId,
      description: creditDisputes.description,
      status: creditDisputes.status,
      reasoning: creditDisputes.reasoning,
      refundedCents: creditDisputes.refundedCents,
      createdAt: creditDisputes.createdAt,
    })
    .from(creditDisputes)
    .innerJoin(users, eq(creditDisputes.userId, users.id))
    .orderBy(desc(creditDisputes.createdAt))
    .limit(200);
  res.json({ disputes: rows });
});

// Manually approve a dispute the automated review declined — the real
// human-in-the-loop override. Refunds the exact amount of the transaction
// the dispute was filed against; a no-op if it's already been refunded
// (grantCredits' own providerReference dedup covers that).
ownerRouter.post("/disputes/:id/override", async (req: AuthedRequest, res) => {
  const [dispute] = await db.select().from(creditDisputes).where(eq(creditDisputes.id, req.params.id));
  if (!dispute) return res.status(404).json({ error: "Dispute not found" });
  if (dispute.status === "approved") return res.json({ ok: true, alreadyApproved: true });
  if (!dispute.creditTransactionId) return res.status(400).json({ error: "This dispute has no linked charge to refund." });

  const [transaction] = await db.select().from(creditTransactions).where(eq(creditTransactions.id, dispute.creditTransactionId));
  if (!transaction) return res.status(400).json({ error: "The original charge for this dispute no longer exists." });

  const refundedCents = Math.abs(transaction.amountCents);
  await grantCredits(db, dispute.userId, refundedCents, {
    kind: "refund",
    providerReference: `dispute-override:${transaction.id}`,
    note: "Owner override — manually approved after automated review declined",
  });
  await db
    .update(creditDisputes)
    .set({ status: "approved", refundedCents, reasoning: `${dispute.reasoning} (Owner override: manually approved.)` })
    .where(eq(creditDisputes.id, dispute.id));

  res.json({ ok: true, refundedCents });
});

// ---------------------------------------------------------------------------
// Billing — real transactions across every user (not one account's own
// Credits screen), plus a real plan-subscription breakdown, both straight
// off creditTransactions/users, the same tables Credits/Plans themselves
// read from.
// ---------------------------------------------------------------------------

ownerRouter.get("/billing", async (_req: AuthedRequest, res) => {
  const [transactionRows, [planCounts], subscriptionRows] = await Promise.all([
    db
      .select({
        id: creditTransactions.id,
        userId: creditTransactions.userId,
        userEmail: users.email,
        userDisplayName: users.displayName,
        kind: creditTransactions.kind,
        amountCents: creditTransactions.amountCents,
        packLabel: creditTransactions.packLabel,
        paymentProvider: creditTransactions.paymentProvider,
        note: creditTransactions.note,
        createdAt: creditTransactions.createdAt,
      })
      .from(creditTransactions)
      .innerJoin(users, eq(creditTransactions.userId, users.id))
      .orderBy(desc(creditTransactions.createdAt))
      .limit(300),
    db
      .select({
        beginner: sql<number>`count(*) filter (where ${users.planTier} = 'beginner')`,
        pro: sql<number>`count(*) filter (where ${users.planTier} = 'pro')`,
        max: sql<number>`count(*) filter (where ${users.planTier} = 'max')`,
      })
      .from(users),
    // Every user currently on a real, active paid subscription — plan
    // tier alone doesn't say WHICH provider is charging them or when it
    // next renews/expires, which is exactly what billing needs to see.
    db
      .select({
        userId: users.id,
        userEmail: users.email,
        userDisplayName: users.displayName,
        planTier: users.planTier,
        planSource: users.planSource,
        planCurrentPeriodEnd: users.planCurrentPeriodEnd,
        planPaddleSubscriptionId: users.planPaddleSubscriptionId,
        planStripeSubscriptionId: users.planStripeSubscriptionId,
        planAppleOriginalTransactionId: users.planAppleOriginalTransactionId,
      })
      .from(users)
      .where(sql`${users.planSource} is not null`)
      .orderBy(desc(users.planCurrentPeriodEnd)),
  ]);

  res.json({ transactions: transactionRows, planCounts, subscriptions: subscriptionRows });
});

// ---------------------------------------------------------------------------
// Reports — real day-by-day aggregates for the last 30 days, computed with
// date_trunc against the actual rows (no separately-maintained analytics
// table to drift out of sync).
// ---------------------------------------------------------------------------

ownerRouter.get("/reports", async (_req: AuthedRequest, res) => {
  const [signupsByDay, revenueByDay, messagesByDay] = await Promise.all([
    db
      .select({ day: sql<string>`to_char(date_trunc('day', ${users.createdAt}), 'YYYY-MM-DD')`, n: count() })
      .from(users)
      .where(sql`${users.createdAt} > now() - interval '30 days'`)
      .groupBy(sql`date_trunc('day', ${users.createdAt})`)
      .orderBy(sql`date_trunc('day', ${users.createdAt})`),
    db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${creditTransactions.createdAt}), 'YYYY-MM-DD')`,
        cents: sql<number>`coalesce(sum(${creditTransactions.amountCents}), 0)`,
      })
      .from(creditTransactions)
      .where(sql`${creditTransactions.amountCents} > 0 and ${creditTransactions.createdAt} > now() - interval '30 days'`)
      .groupBy(sql`date_trunc('day', ${creditTransactions.createdAt})`)
      .orderBy(sql`date_trunc('day', ${creditTransactions.createdAt})`),
    db
      .select({ day: sql<string>`to_char(date_trunc('day', ${messages.createdAt}), 'YYYY-MM-DD')`, n: count() })
      .from(messages)
      .where(sql`${messages.createdAt} > now() - interval '30 days'`)
      .groupBy(sql`date_trunc('day', ${messages.createdAt})`)
      .orderBy(sql`date_trunc('day', ${messages.createdAt})`),
  ]);

  res.json({ signupsByDay, revenueByDay, messagesByDay });
});

// ---------------------------------------------------------------------------
// AI Bots — every custom agent across every user (Agent Builder feature),
// with a real owner override to pause/deactivate any of them app-wide.
// isActive/isPaused are the exact same real columns agentRunner.ts reads
// when deciding whether to reply — this isn't a separate "owner view" flag.
// ---------------------------------------------------------------------------

ownerRouter.get("/agents", async (_req: AuthedRequest, res) => {
  const rows = await db
    .select({
      id: agents.id,
      userId: agents.userId,
      userEmail: users.email,
      userDisplayName: users.displayName,
      name: agents.name,
      kind: agents.kind,
      isActive: agents.isActive,
      isPaused: agents.isPaused,
      createdAt: agents.createdAt,
    })
    .from(agents)
    .innerJoin(users, eq(agents.userId, users.id))
    .orderBy(desc(agents.createdAt))
    .limit(300);
  res.json({ agents: rows });
});

const agentTogglePatchSchema = z.object({
  isActive: z.boolean().optional(),
  isPaused: z.boolean().optional(),
});
ownerRouter.patch("/agents/:id", async (req: AuthedRequest, res) => {
  const parsed = agentTogglePatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const [agent] = await db.select().from(agents).where(eq(agents.id, req.params.id));
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  const [updated] = await db.update(agents).set(parsed.data).where(eq(agents.id, req.params.id)).returning();
  res.json({ agent: updated });
});

// ---------------------------------------------------------------------------
// Real per-user leverage — every action below takes effect immediately on
// the account's real, live state (middleware/auth.ts's requireAuth reads
// isSuspended/tokenVersion on every authenticated request; the credit
// ledger and planTier are read live everywhere else already reads them).
// Never allowed to target the owner's own account, so the owner can't
// accidentally lock themselves out.
// ---------------------------------------------------------------------------

async function loadTargetUser(res: import("express").Response, userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return null;
  }
  if (isOwnerAccount(user.email, user.phone)) {
    res.status(400).json({ error: "cannot_target_owner", message: "The owner account can't be targeted by these actions." });
    return null;
  }
  return user;
}

const suspendSchema = z.object({ suspended: z.boolean(), reason: z.string().max(500).optional() });
ownerRouter.patch("/users/:id/suspend", async (req: AuthedRequest, res) => {
  const parsed = suspendSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const target = await loadTargetUser(res, req.params.id);
  if (!target) return;

  const [updated] = await db
    .update(users)
    .set({
      isSuspended: parsed.data.suspended,
      suspendedReason: parsed.data.suspended ? (parsed.data.reason ?? null) : null,
      suspendedAt: parsed.data.suspended ? new Date() : null,
    })
    .where(eq(users.id, target.id))
    .returning();
  res.json({ user: { id: updated.id, isSuspended: updated.isSuspended, suspendedReason: updated.suspendedReason, suspendedAt: updated.suspendedAt } });
});

// Real forced sign-out — every JWT already issued for this account embeds
// the tokenVersion it was signed with (middleware/auth.ts), so bumping it
// here makes requireAuth reject every one of them on the account's very
// next request, on every device, without needing a separate revocation
// list or waiting for the token's own 30-day expiry.
ownerRouter.post("/users/:id/force-logout", async (req: AuthedRequest, res) => {
  const target = await loadTargetUser(res, req.params.id);
  if (!target) return;
  const [updated] = await db
    .update(users)
    .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
    .where(eq(users.id, target.id))
    .returning({ tokenVersion: users.tokenVersion });
  res.json({ tokenVersion: updated.tokenVersion });
});

const creditAdjustSchema = z.object({ amountCents: z.number().int().refine((n) => n !== 0, "amountCents can't be 0"), note: z.string().max(300).optional() });
ownerRouter.post("/users/:id/credits", async (req: AuthedRequest, res) => {
  const parsed = creditAdjustSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const target = await loadTargetUser(res, req.params.id);
  if (!target) return;

  // grantCredits accepts a negative amountCents just as well as a positive
  // one — it's a real ledger insert either way (kind "adjustment"), so a
  // debit here shows up in this user's own Credits history exactly like
  // any other real transaction, not a hidden side-channel adjustment.
  await grantCredits(db, target.id, parsed.data.amountCents, { kind: "adjustment", note: parsed.data.note ?? "Owner credit adjustment" });
  const balanceAfterCents = await getCreditBalanceCents(db, target.id);
  res.json({ balanceAfterCents });
});

const planOverrideSchema = z.object({ planTier: z.enum(planTierEnum.enumValues) });
ownerRouter.patch("/users/:id/plan", async (req: AuthedRequest, res) => {
  const parsed = planOverrideSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const target = await loadTargetUser(res, req.params.id);
  if (!target) return;

  // A real, direct override — the same planTier column every plan-gated
  // checkpoint (chat.ts's focus-mode gating, plans.ts's PLAN_DEFINITIONS
  // lookup) already reads, bypassing payment entirely. Deliberately doesn't
  // touch planSource/planStripeSubscriptionId/planPaddleSubscriptionId/planAppleOriginalTransactionId
  // — those stay whatever real billing relationship (or lack of one) the
  // account actually has; this only changes which tier they're treated as.
  const [updated] = await db.update(users).set({ planTier: parsed.data.planTier }).where(eq(users.id, target.id)).returning({ planTier: users.planTier });
  res.json({ planTier: updated.planTier });
});

// Real, owner-initiated account deletion — the exact same DELETE FROM
// users routes/auth.ts's own self-serve delete-account does, relying on
// the same real onDelete:"cascade" foreign keys to remove every dependent
// row (sessions, messages, agents, credits, connectors, etc.) in one
// statement. No password confirmation here since the owner isn't the
// account holder — requireOwner's allowlist gate is the real authorization
// check for this action.
ownerRouter.delete("/users/:id", async (req: AuthedRequest, res) => {
  const target = await loadTargetUser(res, req.params.id);
  if (!target) return;
  await db.delete(users).where(eq(users.id, target.id));
  res.status(204).end();
});
