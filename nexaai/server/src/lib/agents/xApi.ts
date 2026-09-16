// Real send + read against X's API v2 — what agentRunner.ts's
// sendPlatformMessage and lib/agents/xPoller.ts's polling loop actually
// call, once an account is connected (lib/connectors/x.ts). Billed
// per-action under X's pay-per-use model — see that file's header.

const X_API_BASE = "https://api.x.com/2";

/** Sends a real DM. `recipientUserId` is the X numeric user ID (from dm_events' sender_id), not a @handle. */
export async function sendXDirectMessage(accessToken: string, recipientUserId: string, text: string): Promise<void> {
  const response = await fetch(`${X_API_BASE}/dm_conversations/with/${recipientUserId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) throw new Error(`X DM send failed: ${response.status} ${await response.text()}`);
}

export interface XDmEvent {
  id: string;
  text: string;
  senderId: string;
  createdAt: string;
}

/**
 * Lists recent DM events (newest first, per X's default ordering),
 * stopping once it reaches `sinceId` (the last event this poller already
 * processed) so a caller only gets genuinely new messages. Returns them in
 * chronological order (oldest of the new batch first) for the caller to
 * process in order.
 */
export async function listNewXDmEvents(accessToken: string, sinceId: string | null): Promise<XDmEvent[]> {
  const params = new URLSearchParams({
    "dm_event.fields": "id,text,sender_id,created_at,event_type",
    max_results: "50",
  });
  const response = await fetch(`${X_API_BASE}/dm_events?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`X DM events fetch failed: ${response.status} ${await response.text()}`);
  const json = (await response.json()) as { data?: { id: string; text?: string; sender_id?: string; created_at: string; event_type?: string }[] };

  const events: XDmEvent[] = [];
  for (const e of json.data ?? []) {
    if (e.id === sinceId) break; // reached the last one we already saw
    if (!e.text || !e.sender_id || e.event_type !== "MessageCreate") continue;
    events.push({ id: e.id, text: e.text, senderId: e.sender_id, createdAt: e.created_at });
  }
  return events.reverse(); // oldest-of-the-new-batch first
}
