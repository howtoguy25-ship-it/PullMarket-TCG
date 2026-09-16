// Real send against Slack's Web API — what agentRunner.ts's
// sendPlatformMessage does for kind "slack_dm" once a workspace is
// connected. Needs the real bot scopes granted at OAuth time (see
// lib/connectors/slack.ts) — no separate app review process for Slack,
// unlike Meta's platforms.

export async function sendSlackMessage(botToken: string, channelId: string, text: string): Promise<void> {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${botToken}` },
    body: JSON.stringify({ channel: channelId, text }),
  });
  const json = (await response.json()) as { ok: boolean; error?: string };
  if (!response.ok || !json.ok) throw new Error(`Slack send failed: ${json.error ?? response.status}`);
}
