import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { agents } from "@shared/schema";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { dryRunAgent, type AgentConfig } from "../lib/agents/agentRunner";

export const agentsRouter = Router();
agentsRouter.use(requireAuth);

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
agentsRouter.post("/", async (req: AuthedRequest, res) => {
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
agentsRouter.post("/:id/dry-run", async (req: AuthedRequest, res) => {
  const parsed = dryRunSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const [agent] = await db.select().from(agents).where(and(eq(agents.id, req.params.id), eq(agents.userId, req.userId!)));
  if (!agent) return res.status(404).json({ error: "Agent not found" });

  const draftReply = await dryRunAgent(agent.kind, agent.config as AgentConfig, parsed.data.incomingMessage);
  res.json({ draftReply });
});
