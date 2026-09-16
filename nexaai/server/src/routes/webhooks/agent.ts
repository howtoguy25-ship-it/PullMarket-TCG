// Real inbound webhook for "generic_webhook" agents — the one agent kind
// that isn't tied to a specific social platform's own OAuth/App Review
// process. Any external caller (a script, Zapier/Make, a website's own
// backend, an SMS gateway, etc.) that knows this agent's unique URL — its
// id plus a random token, both required — can POST a message and get back
// a genuine Claude-drafted reply synchronously. There's no third-party
// account to connect and nothing to wait on Meta for: this is real end to
// end the moment the agent is created and activated.
//
// Unauthenticated by JWT (an external caller has no NexaAi login) — the
// per-agent token in the URL is the real access control, checked below.

import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { agents, users } from "@shared/schema";
import { dryRunAgent, type AgentConfig } from "../../lib/agents/agentRunner";
import { resolveCapabilities } from "../../lib/capabilities";

export const agentWebhookRouter = Router();

const bodySchema = z.object({ message: z.string().min(1).max(4000) });

agentWebhookRouter.post("/:agentId/:token", async (req, res) => {
  const [agent] = await db.select().from(agents).where(eq(agents.id, req.params.agentId));
  if (!agent || agent.kind !== "generic_webhook") return res.status(404).json({ error: "not_found" });

  const config = agent.config as AgentConfig;
  if (!config.webhookToken || config.webhookToken !== req.params.token) {
    return res.status(401).json({ error: "invalid_token" });
  }
  if (!agent.isActive) {
    return res.status(403).json({ error: "agent_inactive", message: "This agent is turned off — activate it in the app first." });
  }

  const [owner] = await db.select().from(users).where(eq(users.id, agent.userId));
  if (!owner || !resolveCapabilities(owner.capabilities).agentBuilder) {
    return res.status(403).json({ error: "capability_disabled", message: "Agent builder is turned off for this account." });
  }

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const draftReply = await dryRunAgent(agent.kind, config, parsed.data.message);
  res.json({ draftReply });
});
