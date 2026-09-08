// Deterministic (not model-dependent) detector for "build me an agent for
// X" style requests typed straight into normal Chat. Per the product
// direction: chat can KICK OFF an agent, but the Agent Builder section is
// "where the real deal is" — real platform connection, real autoSend
// approval queue, real dry-run testing (see routes/agents.ts). So this
// never tries to build/run the agent inline in chat; it only creates a real
// draft row the user finds waiting in their Agents tab, off (isActive:
// false, autoSend: false) until they review and turn it on there.
import type { AgentKind } from "@shared/schema";

const AGENT_INTENT = /\b(build|create|make|set\s*up|start)\b[^.!?]{0,60}\bagent\b/i;

const PLATFORM_MAP: Array<{ pattern: RegExp; kind: AgentKind; label: string }> = [
  { pattern: /instagram|\big\b|\bdm\b/i, kind: "instagram_dm", label: "Instagram DM" },
  { pattern: /whatsapp/i, kind: "whatsapp_autoresponder", label: "WhatsApp" },
  { pattern: /webhook|website|generic/i, kind: "generic_webhook", label: "Webhook" },
];

export interface DetectedAgentRequest {
  kind: AgentKind;
  label: string;
}

export function detectAgentBuildRequest(text: string): DetectedAgentRequest | null {
  if (!AGENT_INTENT.test(text)) return null;
  const platform = PLATFORM_MAP.find((p) => p.pattern.test(text));
  return platform ? { kind: platform.kind, label: platform.label } : { kind: "custom", label: "Custom" };
}
