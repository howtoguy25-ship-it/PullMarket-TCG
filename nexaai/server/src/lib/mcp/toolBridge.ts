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

// Real "authorise control": a name-based heuristic for which MCP tools take
// an action with a side effect (create/change/delete/send something out
// there) versus ones that only read. There's no universal MCP metadata for
// this, so a tool's own name/description is the honest signal available —
// same idea Claude's own connector permissions use. When a server's
// requireApproval is on (the default — see shared/src/schema.ts's
// mcpServers.requireApproval), matching tools are left out of what the
// model is given entirely, so it cannot call them, not just discouraged
// from it. The user turns this off per-server in Connectors once they
// actually want NexaAi acting there.
const MUTATING_VERBS = /\b(create|update|delete|remove|write|push|deploy|send|post|publish|set|edit|modify|insert|add|invite|cancel|charge|pay|transfer)\b/i;

/** snake_case/kebab-case tool names ("delete_record") have no whitespace for \b to land on around an underscore/hyphen — normalize those to spaces first so the word-boundary regex actually sees each word. */
function isMutatingTool(tool: McpToolDef): boolean {
  const normalizedName = tool.name.replace(/[_-]+/g, " ");
  return MUTATING_VERBS.test(normalizedName) || MUTATING_VERBS.test(tool.description ?? "");
}

export interface McpToolBridge {
  tools: Anthropic.Tool[];
  runner?: (name: string, input: unknown) => Promise<string>;
  /** Real tools that exist on a connected server but were withheld from the model because that server still requires approval. Surfaced to chat.ts so it can tell the user plainly, rather than silently doing less. */
  gatedToolNames: string[];
}

const EMPTY_BRIDGE: McpToolBridge = { tools: [], gatedToolNames: [] };

/** Real tools from every enabled, currently-connected MCP server for this user, namespaced so two servers can't collide on a tool name. */
export async function buildMcpToolBridge(userId: string): Promise<McpToolBridge> {
  const servers = await db
    .select()
    .from(mcpServers)
    .where(and(eq(mcpServers.userId, userId), eq(mcpServers.enabled, true), eq(mcpServers.status, "connected")));
  if (!servers.length) return EMPTY_BRIDGE;

  const tools: Anthropic.Tool[] = [];
  const gatedToolNames: string[] = [];
  const dispatch = new Map<string, { url: string; bearerToken: string | null; originalName: string }>();

  for (const server of servers) {
    const slug = slugify(server.name);
    for (const tool of (server.tools as McpToolDef[] | null) ?? []) {
      if (server.requireApproval && isMutatingTool(tool)) {
        gatedToolNames.push(`${server.name}: ${tool.name}`);
        continue;
      }
      const combinedName = `mcp_${slug}_${tool.name}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 128);
      tools.push({
        name: combinedName,
        description: `[${server.name} — real MCP connector] ${tool.description ?? ""}`.slice(0, 1024),
        input_schema: (tool.inputSchema as Anthropic.Tool.InputSchema) ?? { type: "object", properties: {} },
      });
      dispatch.set(combinedName, { url: server.url, bearerToken: server.bearerToken, originalName: tool.name });
    }
  }
  if (!tools.length && !gatedToolNames.length) return EMPTY_BRIDGE;

  return {
    tools,
    gatedToolNames,
    runner: async (name, input) => {
      const entry = dispatch.get(name);
      if (!entry) return "Unknown tool.";
      return callMcpTool(entry.url, entry.bearerToken, entry.originalName, input);
    },
  };
}
