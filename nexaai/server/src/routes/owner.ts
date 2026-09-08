// Real owner panel — every number here is a live aggregate query against
// the actual tables, not mock data. Gated by requireOwner (allowlist check
// on the logged-in account's email/phone against OWNER_EMAIL/OWNER_PHONE).

import { Router } from "express";
import { sql, eq, desc, count } from "drizzle-orm";
import { db } from "../db";
import { users, creditTransactions, messages, chatSessions, agents, connectors, voiceTurns, projects, apiKeys } from "@shared/schema";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { requireOwner } from "../middleware/owner";

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
