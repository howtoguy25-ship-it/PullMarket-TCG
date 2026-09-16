// Real polling loop that drives x_dm agents — X doesn't confirm a
// real-time webhook (Account Activity API push) available outside its old
// Enterprise tier, so this is the honest working alternative: on an
// interval, check every connected X account for a business with an active
// x_dm agent, ask X's real API what's new since the last check, and draft
// + send/queue exactly like the webhook-driven platforms.
//
// 90s is a deliberate choice, not a default: DM events are billed
// per-action under X's pay-per-use model, so polling faster costs real
// money per connected account for no real gain in a chat-support context
// (a customer typing a DM doesn't need a sub-90s response). Tune via
// X_DM_POLL_INTERVAL_MS if your usage pattern genuinely needs tighter
// latency and you've priced that in.

import { eq, and } from "drizzle-orm";
import { db } from "../../db";
import { agents, connectors, users } from "@shared/schema";
import { isXConfigured, refreshXAccessToken } from "../connectors/x";
import { runAgentTurn, type AgentConfig } from "./agentRunner";
import { listNewXDmEvents } from "./xApi";
import { resolveCapabilities } from "../capabilities";

const POLL_INTERVAL_MS = Number(process.env.X_DM_POLL_INTERVAL_MS) || 90_000;

async function getValidAccessToken(connector: typeof connectors.$inferSelect): Promise<string | null> {
  if (!connector.accessToken) return null;
  const expiresAt = connector.tokenExpiresAt?.getTime() ?? 0;
  if (expiresAt > Date.now() + 60_000) return connector.accessToken; // still valid for at least another minute

  if (!connector.refreshToken) return null; // can't refresh — connection needs reconnecting (offline.access wasn't granted, or was revoked)
  try {
    const refreshed = await refreshXAccessToken(connector.refreshToken);
    await db
      .update(connectors)
      .set({
        accessToken: refreshed.access_token,
        refreshToken: refreshed.refresh_token ?? connector.refreshToken,
        tokenExpiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
      })
      .where(eq(connectors.id, connector.id));
    return refreshed.access_token;
  } catch (err) {
    console.error(`X token refresh failed for connector ${connector.id}:`, err);
    return null;
  }
}

async function pollOneConnector(connector: typeof connectors.$inferSelect) {
  const accessToken = await getValidAccessToken(connector);
  if (!accessToken) return;

  const meta = connector.providerMetadata as { userId?: string; lastSeenDmEventId?: string | null };
  if (!meta.userId) return;

  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.userId, connector.userId), eq(agents.kind, "x_dm"), eq(agents.isActive, true)));
  if (!agent) return; // owner hasn't activated an X agent

  const [ownerUser] = await db.select().from(users).where(eq(users.id, connector.userId));
  if (!ownerUser || !resolveCapabilities(ownerUser.capabilities).agentBuilder) return;

  let events;
  try {
    events = await listNewXDmEvents(accessToken, meta.lastSeenDmEventId ?? null);
  } catch (err) {
    console.error(`X DM poll failed for connector ${connector.id}:`, err);
    return;
  }
  if (!events.length) return;

  const config = agent.config as AgentConfig;
  for (const event of events) {
    if (event.senderId === meta.userId) continue; // our own sent message, not an inbound one

    try {
      await runAgentTurn({
        agentId: agent.id,
        agentKind: agent.kind,
        config,
        userId: connector.userId,
        platform: "x",
        externalConversationId: event.senderId,
        incomingMessage: event.text,
      });
    } catch (err) {
      console.error(`X DM handling failed for event ${event.id}:`, err);
    }
  }

  await db
    .update(connectors)
    .set({ providerMetadata: { ...meta, lastSeenDmEventId: events[events.length - 1].id } })
    .where(eq(connectors.id, connector.id));
}

let pollHandle: ReturnType<typeof setInterval> | null = null;

/** Called once from index.ts at server startup — no-ops entirely if X isn't configured. */
export function startXDmPoller() {
  if (!isXConfigured() || pollHandle) return;
  pollHandle = setInterval(async () => {
    const connectedX = await db.select().from(connectors).where(and(eq(connectors.provider, "x"), eq(connectors.status, "connected")));
    for (const connector of connectedX) {
      await pollOneConnector(connector).catch((err) => console.error("X DM poller error:", err));
    }
  }, POLL_INTERVAL_MS);
}
