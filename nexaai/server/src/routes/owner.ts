// Real owner panel — every number here is a live aggregate query against
// the actual tables, not mock data. Gated by requireOwner (allowlist check
// on the logged-in account's email/phone against OWNER_EMAIL/OWNER_PHONE).

import { Router } from "express";
import { sql, eq, desc, count } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { users, creditTransactions, messages, chatSessions, agents, connectors, voiceTurns, projects, apiKeys, reasoningEffortCapEnum } from "@shared/schema";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { requireOwner } from "../middleware/owner";
import { getOwnerSettings, updateOwnerSettings } from "../lib/ownerSettings";

export const ownerRouter = Router();
ownerRouter.use(requireAuth, requireOwner);

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
    db
      .select({ id: messages.id, role: messages.role, kind: messages.kind, content: messages.content, createdAt: messages.createdAt, sessionId: messages.sessionId })
      .from(messages)
      .innerJoin(chatSessions, eq(messages.sessionId, chatSessions.id))
      .where(eq(chatSessions.userId, userId))
      .orderBy(desc(messages.createdAt))
      .limit(100),
  ]);

  res.json({ sessions: sessionRows, projects: projectRows, agents: agentRows, connectors: connectorRows, recentMessages });
});

// ---------------------------------------------------------------------------
// AI Controls — real, app-wide kill switches + a reasoning-effort ceiling.
// See lib/ownerSettings.ts for the singleton row these read/write and
// lib/capabilities.ts's applyOwnerOverrides / lib/anthropic.ts's
// REASONING_CAP_CEILING for where each one is actually enforced.
// ---------------------------------------------------------------------------

ownerRouter.get("/settings", async (_req: AuthedRequest, res) => {
  res.json({ settings: await getOwnerSettings() });
});

const settingsPatchSchema = z.object({
  webLookupEnabled: z.boolean().optional(),
  voiceChatEnabled: z.boolean().optional(),
  agentBuilderEnabled: z.boolean().optional(),
  memoryEnabled: z.boolean().optional(),
  newSignupsEnabled: z.boolean().optional(),
  topicImagesEnabled: z.boolean().optional(),
  reasoningEffortCap: z.enum(reasoningEffortCapEnum.enumValues).nullable().optional(),
});
ownerRouter.patch("/settings", async (req: AuthedRequest, res) => {
  const parsed = settingsPatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const settings = await updateOwnerSettings(parsed.data);
  res.json({ settings });
});

// ---------------------------------------------------------------------------
// Billing — real credit-ledger data (this app bills in one-time credit
// packs via Paddle/Apple IAP, not recurring subscriptions — see
// lib/payments/paddle.ts — so "billing" here is the real transaction ledger
// and plan-tier distribution, not fabricated subscription rows).
// ---------------------------------------------------------------------------

ownerRouter.get("/billing", async (_req: AuthedRequest, res) => {
  const [transactionRows, planCountRows, revenueByProviderRows] = await Promise.all([
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
        providerReference: creditTransactions.providerReference,
        note: creditTransactions.note,
        createdAt: creditTransactions.createdAt,
      })
      .from(creditTransactions)
      .innerJoin(users, eq(creditTransactions.userId, users.id))
      .orderBy(desc(creditTransactions.createdAt))
      .limit(300),
    db.select({ planTier: users.planTier, n: count() }).from(users).groupBy(users.planTier),
    db
      .select({ provider: creditTransactions.paymentProvider, total: sql<number>`coalesce(sum(${creditTransactions.amountCents}), 0)` })
      .from(creditTransactions)
      .where(sql`${creditTransactions.amountCents} > 0`)
      .groupBy(creditTransactions.paymentProvider),
  ]);

  res.json({
    transactions: transactionRows,
    planCounts: Object.fromEntries(planCountRows.map((r) => [r.planTier, r.n])),
    revenueByProviderCents: Object.fromEntries(revenueByProviderRows.map((r) => [r.provider ?? "unknown", r.total])),
  });
});

// ---------------------------------------------------------------------------
// Reports — real 30-day day-by-day aggregates (SQL date_trunc against the
// live tables), not sampled or estimated.
// ---------------------------------------------------------------------------

ownerRouter.get("/reports", async (_req: AuthedRequest, res) => {
  const since = sql`now() - interval '30 days'`;

  const [signupsByDay, revenueByDay, messagesByDay] = await Promise.all([
    db
      .select({ day: sql<string>`date_trunc('day', ${users.createdAt})`, n: count() })
      .from(users)
      .where(sql`${users.createdAt} >= ${since}`)
      .groupBy(sql`date_trunc('day', ${users.createdAt})`)
      .orderBy(sql`date_trunc('day', ${users.createdAt})`),
    db
      .select({ day: sql<string>`date_trunc('day', ${creditTransactions.createdAt})`, totalCents: sql<number>`coalesce(sum(${creditTransactions.amountCents}), 0)` })
      .from(creditTransactions)
      .where(sql`${creditTransactions.amountCents} > 0 and ${creditTransactions.createdAt} >= ${since}`)
      .groupBy(sql`date_trunc('day', ${creditTransactions.createdAt})`)
      .orderBy(sql`date_trunc('day', ${creditTransactions.createdAt})`),
    db
      .select({ day: sql<string>`date_trunc('day', ${messages.createdAt})`, n: count() })
      .from(messages)
      .where(sql`${messages.createdAt} >= ${since}`)
      .groupBy(sql`date_trunc('day', ${messages.createdAt})`)
      .orderBy(sql`date_trunc('day', ${messages.createdAt})`),
  ]);

  res.json({ signupsByDay, revenueByDay, messagesByDay });
});

// ---------------------------------------------------------------------------
// AI Bots — every custom agent across every user, with a real owner-level
// pause/activate override on the exact same `isActive` column
// routes/agents.ts and routes/webhooks/meta.ts already enforce.
// ---------------------------------------------------------------------------

ownerRouter.get("/agents", async (_req: AuthedRequest, res) => {
  const rows = await db
    .select({
      id: agents.id,
      name: agents.name,
      kind: agents.kind,
      isActive: agents.isActive,
      createdAt: agents.createdAt,
      userId: agents.userId,
      userEmail: users.email,
      userDisplayName: users.displayName,
    })
    .from(agents)
    .innerJoin(users, eq(agents.userId, users.id))
    .orderBy(desc(agents.createdAt))
    .limit(300);
  res.json({ agents: rows });
});

const ownerAgentPatchSchema = z.object({ isActive: z.boolean() });
ownerRouter.patch("/agents/:id", async (req: AuthedRequest, res) => {
  const parsed = ownerAgentPatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const [agent] = await db.update(agents).set({ isActive: parsed.data.isActive }).where(eq(agents.id, req.params.id)).returning();
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  res.json({ agent });
});
