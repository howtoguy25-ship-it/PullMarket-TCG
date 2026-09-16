import { Router } from "express";
import crypto from "crypto";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { agents, agentKindEnum, agentPendingDrafts, users } from "@shared/schema";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { dryRunAgent, sendPlatformMessage, classifyReplyExample, assistWithAgentBuilder, type AgentConfig, type SampleReply } from "../lib/agents/agentRunner";
import { resolveCapabilities } from "../lib/capabilities";
import { getOwnerSettings } from "../lib/ownerSettings";
import { startOrExtendHumanTakeover, endHumanTakeover, isHumanTakeoverActive } from "../lib/agents/humanTakeover";

export const agentsRouter = Router();
agentsRouter.use(requireAuth);

async function requireAgentBuilderCapability(req: AuthedRequest, res: import("express").Response, next: import("express").NextFunction) {
  const [user] = await db.select().from(users).where(eq(users.id, req.userId!));
  if (!user) return res.status(404).json({ error: "User not found" });
  if (!resolveCapabilities(user.capabilities).agentBuilder) {
    return res.status(403).json({ error: "capability_disabled", message: "Agent builder is turned off in Capabilities settings." });
  }
  if (!(await getOwnerSettings()).agentBuilderEnabled) {
    return res.status(403).json({ error: "capability_disabled", message: "Agent builder is temporarily turned off." });
  }
  next();
}

agentsRouter.get("/", async (req: AuthedRequest, res) => {
  const rows = await db.select().from(agents).where(eq(agents.userId, req.userId!));
  res.json({ agents: rows });
});

const sampleReplySchema = z.object({ text: z.string().min(1).max(300), category: z.enum(["welcome", "faq"]) });

const createSchema = z.object({
  name: z.string().min(1).max(80),
  kind: z.enum(agentKindEnum.enumValues),
  instructions: z.string().min(1).max(2000),
  tone: z.string().max(500).optional(),
  autoSend: z.boolean().default(false),
  sampleReplies: z.array(sampleReplySchema).max(5).optional(),
});
agentsRouter.post("/", requireAgentBuilderCapability, async (req: AuthedRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { name, kind, instructions, tone, autoSend, sampleReplies } = parsed.data;
  // A generic_webhook agent's real inbound URL is authenticated by this
  // random token in the path — see routes/webhooks/agent.ts — generated
  // once here, never client-supplied.
  const config: AgentConfig = {
    instructions,
    ...(tone?.trim() ? { tone: tone.trim() } : {}),
    autoSend,
    ...(sampleReplies?.length ? { sampleReplies } : {}),
    ...(kind === "generic_webhook" ? { webhookToken: crypto.randomBytes(16).toString("hex") } : {}),
  };
  const [agent] = await db.insert(agents).values({ userId: req.userId!, name, kind, config }).returning();
  res.status(201).json({ agent });
});

const updateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  isActive: z.boolean().optional(),
  // The real "stay out of my way" switch — see schema.ts's agents.isPaused.
  // A separate field from isActive: this doesn't disconnect or delete
  // anything, it just silences replies until switched back off.
  isPaused: z.boolean().optional(),
  instructions: z.string().min(1).max(2000).optional(),
  tone: z.string().max(500).optional(),
  autoSend: z.boolean().optional(),
  sampleReplies: z.array(sampleReplySchema).max(5).optional(),
});
agentsRouter.patch("/:id", async (req: AuthedRequest, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  // Only activation itself needs the live capability check — editing an
  // already-inactive agent's instructions, or turning one off, should still
  // work even with the capability off. The inbound webhook (routes/webhooks/
  // meta.ts) re-checks this at message time too, since a user can disable
  // the capability after an agent is already active.
  if (parsed.data.isActive === true) {
    const [user] = await db.select().from(users).where(eq(users.id, req.userId!));
    if (!user || !resolveCapabilities(user.capabilities).agentBuilder) {
      return res.status(403).json({ error: "capability_disabled", message: "Agent builder is turned off in Capabilities settings." });
    }
    if (!(await getOwnerSettings()).agentBuilderEnabled) {
      return res.status(403).json({ error: "capability_disabled", message: "Agent builder is temporarily turned off." });
    }
  }

  const [existing] = await db.select().from(agents).where(and(eq(agents.id, req.params.id), eq(agents.userId, req.userId!)));
  if (!existing) return res.status(404).json({ error: "Agent not found" });

  const config = { ...(existing.config as AgentConfig) };
  if (parsed.data.instructions !== undefined) config.instructions = parsed.data.instructions;
  if (parsed.data.tone !== undefined) config.tone = parsed.data.tone.trim() || undefined;
  if (parsed.data.autoSend !== undefined) config.autoSend = parsed.data.autoSend;
  if (parsed.data.sampleReplies !== undefined) config.sampleReplies = parsed.data.sampleReplies;

  const [agent] = await db
    .update(agents)
    .set({
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
      ...(parsed.data.isPaused !== undefined ? { isPaused: parsed.data.isPaused } : {}),
      config,
    })
    .where(eq(agents.id, req.params.id))
    .returning();
  res.json({ agent });
});

// Real classification (Claude, not a keyword guess) for one sample reply
// as the user adds it — see agentRunner.ts's classifyReplyExample.
const classifySchema = z.object({ text: z.string().min(1).max(300) });
agentsRouter.post("/classify-reply", requireAgentBuilderCapability, async (req: AuthedRequest, res) => {
  const parsed = classifySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const category = await classifyReplyExample(parsed.data.text);
  res.json({ category });
});

// The Agent Builder's own "not sure what to write?" AI assistant — a real
// Claude conversation that ends in a structured suggestion once it has
// enough to propose one. See agentRunner.ts's assistWithAgentBuilder.
const assistSchema = z.object({
  message: z.string().min(1).max(2000),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).max(20).default([]),
});
agentsRouter.post("/assist", requireAgentBuilderCapability, async (req: AuthedRequest, res) => {
  const parsed = assistSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const result = await assistWithAgentBuilder(parsed.data.message, parsed.data.history);
  res.json(result);
});

agentsRouter.delete("/:id", async (req: AuthedRequest, res) => {
  await db.delete(agents).where(and(eq(agents.id, req.params.id), eq(agents.userId, req.userId!)));
  res.status(204).end();
});

const dryRunSchema = z.object({ incomingMessage: z.string().min(1).max(2000) });
agentsRouter.post("/:id/dry-run", requireAgentBuilderCapability, async (req: AuthedRequest, res) => {
  const parsed = dryRunSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const [agent] = await db.select().from(agents).where(and(eq(agents.id, req.params.id), eq(agents.userId, req.userId!)));
  if (!agent) return res.status(404).json({ error: "Agent not found" });

  const draftReply = await dryRunAgent(agent.kind, agent.config as AgentConfig, parsed.data.incomingMessage);
  res.json({ draftReply });
});

// Pending drafts — real inbound messages a connected agent drafted a reply
// to but didn't send automatically (autoSend is off), waiting for the
// business owner's approval. See routes/webhooks/meta.ts for where these
// get created.
agentsRouter.get("/pending-drafts", async (req: AuthedRequest, res) => {
  const rows = await db
    .select()
    .from(agentPendingDrafts)
    .where(and(eq(agentPendingDrafts.userId, req.userId!), eq(agentPendingDrafts.status, "pending")))
    .orderBy(desc(agentPendingDrafts.createdAt));
  // Real live state, not derived from the draft row itself — lets the
  // Agents screen show "You're live on this chat" instead of an approval
  // prompt for a conversation the owner (or a teammate) is already
  // actively handling through the platform's own app.
  const drafts = await Promise.all(
    rows.map(async (row) => ({ ...row, humanTakeoverActive: await isHumanTakeoverActive(row.agentId, row.externalConversationId) })),
  );
  res.json({ drafts });
});

agentsRouter.post("/pending-drafts/:id/approve", requireAgentBuilderCapability, async (req: AuthedRequest, res) => {
  const [draft] = await db
    .select()
    .from(agentPendingDrafts)
    .where(and(eq(agentPendingDrafts.id, req.params.id), eq(agentPendingDrafts.userId, req.userId!)));
  if (!draft) return res.status(404).json({ error: "Draft not found" });
  if (draft.status !== "pending") return res.status(409).json({ error: "Draft already resolved" });

  const [agent] = await db.select().from(agents).where(eq(agents.id, draft.agentId));
  if (!agent) return res.status(404).json({ error: "Agent no longer exists" });

  try {
    await sendPlatformMessage(req.userId!, agent.kind, draft.externalConversationId, draft.draftReply);
  } catch (err: any) {
    return res.status(502).json({ error: "send_failed", message: err.message ?? "Failed to send the reply." });
  }

  const [updated] = await db
    .update(agentPendingDrafts)
    .set({ status: "approved", resolvedAt: new Date() })
    .where(eq(agentPendingDrafts.id, draft.id))
    .returning();
  res.json({ draft: updated });
});

agentsRouter.post("/pending-drafts/:id/reject", async (req: AuthedRequest, res) => {
  const [updated] = await db
    .update(agentPendingDrafts)
    .set({ status: "rejected", resolvedAt: new Date() })
    .where(and(eq(agentPendingDrafts.id, req.params.id), eq(agentPendingDrafts.userId, req.userId!)))
    .returning();
  if (!updated) return res.status(404).json({ error: "Draft not found" });
  res.json({ draft: updated });
});

// Manual "I'm chatting this one myself" — the deliberate counterpart to the
// automatic Meta-echo detection (routes/webhooks/meta.ts): works for every
// agent kind, including the platforms (WhatsApp, Slack, X) that don't have
// a real echo/native-inbox signal NexaAi can detect on its own. Real 5
// minutes of silence on that one conversation, same window either way.
agentsRouter.post("/:id/conversations/:externalConversationId/takeover", async (req: AuthedRequest, res) => {
  const [agent] = await db.select().from(agents).where(and(eq(agents.id, req.params.id), eq(agents.userId, req.userId!)));
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  const takeoverUntil = await startOrExtendHumanTakeover(agent.id, req.params.externalConversationId);
  res.json({ takeoverUntil });
});

agentsRouter.post("/:id/conversations/:externalConversationId/release", async (req: AuthedRequest, res) => {
  const [agent] = await db.select().from(agents).where(and(eq(agents.id, req.params.id), eq(agents.userId, req.userId!)));
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  await endHumanTakeover(agent.id, req.params.externalConversationId);
  res.status(204).end();
});
