// Real, generic MCP connectors — a user pastes any real Model Context
// Protocol server's URL (their own tools, a public MCP server, anything
// speaking the real protocol) and NexaAi connects to it for real via
// lib/mcp/client.ts, exactly like Claude's own "Add custom connector".
// Discovered tools are cached here and fed into the model's real tool-use
// loop during chat (see lib/anthropic.ts + routes/chat.ts).
import { Router } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { mcpServers } from "@shared/schema";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { discoverMcpTools } from "../lib/mcp/client";

export const mcpRouter = Router();
mcpRouter.use(requireAuth);

function publicRow(row: typeof mcpServers.$inferSelect) {
  const { bearerToken, ...rest } = row;
  return { ...rest, hasToken: !!bearerToken, toolCount: Array.isArray(row.tools) ? row.tools.length : 0 };
}

async function tryDiscover(id: string, url: string, bearerToken: string | null) {
  try {
    const tools = await discoverMcpTools(url, bearerToken);
    await db
      .update(mcpServers)
      .set({ status: "connected", tools, lastError: null, lastConnectedAt: new Date() })
      .where(eq(mcpServers.id, id));
  } catch (err: any) {
    await db
      .update(mcpServers)
      .set({ status: "error", lastError: err?.message ?? "Couldn't connect to that MCP server." })
      .where(eq(mcpServers.id, id));
  }
}

mcpRouter.get("/", async (req: AuthedRequest, res) => {
  const rows = await db.select().from(mcpServers).where(eq(mcpServers.userId, req.userId!));
  res.json({ servers: rows.map(publicRow) });
});

const createSchema = z.object({
  name: z.string().min(1).max(80),
  url: z.string().url(),
  bearerToken: z.string().max(4000).optional(),
});
mcpRouter.post("/", async (req: AuthedRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { name, url, bearerToken } = parsed.data;

  const [row] = await db
    .insert(mcpServers)
    .values({ userId: req.userId!, name, url, bearerToken: bearerToken ?? null })
    .returning();
  await tryDiscover(row.id, url, bearerToken ?? null);

  const [updated] = await db.select().from(mcpServers).where(eq(mcpServers.id, row.id));
  res.status(201).json({ server: publicRow(updated) });
});

mcpRouter.post("/:id/reconnect", async (req: AuthedRequest, res) => {
  const [row] = await db.select().from(mcpServers).where(and(eq(mcpServers.id, req.params.id), eq(mcpServers.userId, req.userId!)));
  if (!row) return res.status(404).json({ error: "MCP connector not found" });

  await tryDiscover(row.id, row.url, row.bearerToken);
  const [updated] = await db.select().from(mcpServers).where(eq(mcpServers.id, row.id));
  res.json({ server: publicRow(updated) });
});

const updateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  url: z.string().url().optional(),
  bearerToken: z.string().max(4000).nullable().optional(),
  enabled: z.boolean().optional(),
});
mcpRouter.patch("/:id", async (req: AuthedRequest, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const [existing] = await db.select().from(mcpServers).where(and(eq(mcpServers.id, req.params.id), eq(mcpServers.userId, req.userId!)));
  if (!existing) return res.status(404).json({ error: "MCP connector not found" });

  const { name, url, bearerToken, enabled } = parsed.data;
  await db
    .update(mcpServers)
    .set({
      ...(name !== undefined ? { name } : {}),
      ...(url !== undefined ? { url } : {}),
      ...(bearerToken !== undefined ? { bearerToken } : {}),
      ...(enabled !== undefined ? { enabled } : {}),
    })
    .where(eq(mcpServers.id, existing.id));

  // A changed URL or token invalidates the cached tool list — re-verify now
  // rather than leaving a stale "connected" status pointing at old tools.
  if (url !== undefined || bearerToken !== undefined) {
    await tryDiscover(existing.id, url ?? existing.url, bearerToken !== undefined ? bearerToken : existing.bearerToken);
  }

  const [updated] = await db.select().from(mcpServers).where(eq(mcpServers.id, existing.id));
  res.json({ server: publicRow(updated) });
});

mcpRouter.delete("/:id", async (req: AuthedRequest, res) => {
  await db.delete(mcpServers).where(and(eq(mcpServers.id, req.params.id), eq(mcpServers.userId, req.userId!)));
  res.status(204).end();
});
