// Assembles a user's real, connected MCP servers into Anthropic tool
// definitions plus a single dispatcher function — the piece that sits
// between routes/chat.ts (which just wants "tools" + "how to run one") and
// lib/mcp/client.ts (which actually speaks the MCP protocol per server).
import type Anthropic from "@anthropic-ai/sdk";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { mcpServers } from "@shared/schema";
import { callMcpTool, type McpToolDef } from "./client";

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "server";
}

export interface McpToolBridge {
  tools: Anthropic.Tool[];
  runner?: (name: string, input: unknown) => Promise<string>;
}

const EMPTY_BRIDGE: McpToolBridge = { tools: [] };

/** Real tools from every enabled, currently-connected MCP server for this user, namespaced so two servers can't collide on a tool name. */
export async function buildMcpToolBridge(userId: string): Promise<McpToolBridge> {
  const servers = await db
    .select()
    .from(mcpServers)
    .where(and(eq(mcpServers.userId, userId), eq(mcpServers.enabled, true), eq(mcpServers.status, "connected")));
  if (!servers.length) return EMPTY_BRIDGE;

  const tools: Anthropic.Tool[] = [];
  const dispatch = new Map<string, { url: string; bearerToken: string | null; originalName: string }>();

  for (const server of servers) {
    const slug = slugify(server.name);
    for (const tool of (server.tools as McpToolDef[] | null) ?? []) {
      const combinedName = `mcp_${slug}_${tool.name}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 128);
      tools.push({
        name: combinedName,
        description: `[${server.name} — real MCP connector] ${tool.description ?? ""}`.slice(0, 1024),
        input_schema: (tool.inputSchema as Anthropic.Tool.InputSchema) ?? { type: "object", properties: {} },
      });
      dispatch.set(combinedName, { url: server.url, bearerToken: server.bearerToken, originalName: tool.name });
    }
  }
  if (!tools.length) return EMPTY_BRIDGE;

  return {
    tools,
    runner: async (name, input) => {
      const entry = dispatch.get(name);
      if (!entry) return "Unknown tool.";
      return callMcpTool(entry.url, entry.bearerToken, entry.originalName, input);
    },
  };
}
