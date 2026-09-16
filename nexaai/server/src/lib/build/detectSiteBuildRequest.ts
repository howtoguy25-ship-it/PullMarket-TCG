// Deterministic (not model-dependent) detector for "hey Nexa, build me a
// website/app" style requests typed straight into normal Chat — the Smart
// Build capability (shared/src/schema.ts's NexaCapabilities.smartBuild).
// Sibling to lib/agents/detectAgentRequest.ts, same shape, different intent:
// this one is about a real site/app, not an auto-reply agent, so it
// deliberately backs off when the message is actually about an agent
// (AGENT_INTENT already owns that case in routes/chat.ts) to avoid the two
// detectors double-handling the same message.

const SITE_BUILD_INTENT =
  /\b(build|create|make|design|set\s*up|start|code)\b[^.!?]{0,80}\b(website|web\s*site|webpage|web\s*page|landing\s*page|(?:html\s+)?page|site|app|application|portfolio)\b/i;

export function detectSiteBuildRequest(text: string): boolean {
  if (/\bagent\b/i.test(text)) return false; // AGENT_INTENT's turf, not this
  return SITE_BUILD_INTENT.test(text);
}
