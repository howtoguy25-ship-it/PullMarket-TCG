import { Router } from "express";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { agents, agentPendingDrafts, users } from "@shared/schema";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { dryRunAgent, sendPlatformMessage, type AgentConfig } from "../lib/agents/agentRunner";
import { resolveCapabilities } from "../lib/capabilities";

export const agentsRouter = Router();
agentsRouter.use(requireAuth);

async function requireAgentBuilderCapability(req: AuthedRequest, res: import("express").Response, next: import("express").NextFunction) {
  const [user] = await db.select().from(users).where(eq(users.id, req.userId!));
  if (!user) return res.status(404).json({ error: "User not found" });
  if (!resolveCapabilities(user.capabilities).agentBuilder) {
    return res.status(403).json({ error: "capability_disabled", message: "Agent builder is turned off in Capabilities settings." });
  }
  next();
}

agentsRouter.get("/", async (req: AuthedRequest, res) => {
  const rows = await db.select().from(agents).where(eq(agents.userId, req.userId!));
  res.json({ agents: rows });
});

const createSchema = z.object({
  name: z.string().min(1).max(80),
  kind: z.enum(["instagram_dm", "whatsapp_autoresponder", "generic_webhook", "custom"]),
  instructions: z.string().min(1).max(2000),
  autoSend: z.boolean().default(false),
});
agentsRouter.post("/", requireAgentBuilderCapability, async (req: AuthedRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { name, kind, instructions, autoSend } = parsed.data;
  const [agent] = await db
    .insert(agents)
    .values({ userId: req.userId!, name, kind, config: { instructions, autoSend } })
    .returning();
  res.status(201).json({ agent });
});

const updateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  isActive: z.boolean().optional(),
  instructions: z.string().min(1).max(2000).optional(),
  autoSend: z.boolean().optional(),
});
agentsRouter.patch("/:id", async (req: AuthedRequest, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const [existing] = await db.select().from(agents).where(and(eq(agents.id, req.params.id), eq(agents.userId, req.userId!)));
  if (!existing) return res.status(404).json({ error: "Agent not found" });

  const config = { ...(existing.config as AgentConfig) };
  if (parsed.data.instructions !== undefined) config.instructions = parsed.data.instructions;
  if (parsed.data.autoSend !== undefined) config.autoSend = parsed.data.autoSend;

  const [agent] = await db
    .update(agents)
    .set({
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
      config,
    })
    .where(eq(agents.id, req.params.id))
    .returning();
  res.json({ agent });
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
  res.json({ drafts: rows });
});

agentsRouter.post("/pending-drafts/:id/approve", async (req: AuthedRequest, res) => {
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
