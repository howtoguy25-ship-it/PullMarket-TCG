// Real Model Context Protocol client — the actual @modelcontextprotocol/sdk,
// not a hand-rolled stand-in. A user pastes any real MCP server's URL (their
// own tool server, a public one, anything speaking the real protocol) and
// this connects to it exactly like Claude's own "custom connector" does:
// discover its real tools, and later call them live during a chat turn (see
// lib/anthropic.ts's tool-use loop and routes/chat.ts).
//
// Connects fresh per call rather than pooling a persistent session — simpler
// and correct for a stateless HTTP server, at the cost of a slightly slower
// per-call round trip. Real MCP servers speak the modern Streamable HTTP
// transport; this tries that first and falls back to the older HTTP+SSE
// transport for servers that predate it, per the SDK's own migration guidance.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

export interface McpToolDef {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

const CLIENT_INFO = { name: "nexaai", version: "1.0.0" };

async function connectWithTransport(transport: Transport): Promise<Client> {
  const client = new Client(CLIENT_INFO);
  await client.connect(transport);
  return client;
}

async function connect(url: string, bearerToken?: string | null): Promise<Client> {
  const headers = bearerToken ? { Authorization: `Bearer ${bearerToken}` } : undefined;
  const target = new URL(url);
  try {
    return await connectWithTransport(new StreamableHTTPClientTransport(target, { requestInit: { headers } }));
  } catch {
    // Older MCP servers only support the legacy HTTP+SSE transport.
    return await connectWithTransport(new SSEClientTransport(target, { requestInit: { headers } }));
  }
}

/** Connects, lists the server's real tools, and disconnects. Throws on any real connection/protocol failure — callers surface that as this connector's real status. */
export async function discoverMcpTools(url: string, bearerToken?: string | null): Promise<McpToolDef[]> {
  const client = await connect(url, bearerToken);
  try {
    const { tools } = await client.listTools();
    return tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema as Record<string, unknown> }));
  } finally {
    await client.close().catch(() => {});
  }
}

/** Calls one real tool on a connected MCP server and flattens its result content into plain text for the model. */
export async function callMcpTool(url: string, bearerToken: string | null | undefined, name: string, args: unknown): Promise<string> {
  const client = await connect(url, bearerToken);
  try {
    const result = await client.callTool({ name, arguments: args as Record<string, unknown> });
    const content = Array.isArray(result.content) ? result.content : [];
    const text = content
      .map((block) => {
        if (block.type === "text") return block.text;
        if (block.type === "resource") return "resource" in block ? JSON.stringify(block.resource) : "";
        return `[${block.type} content omitted]`;
      })
      .filter(Boolean)
      .join("\n");
    if (result.isError) return `Tool call failed: ${text || "unknown error"}`;
    return text || "(tool returned no content)";
  } finally {
    await client.close().catch(() => {});
  }
}
