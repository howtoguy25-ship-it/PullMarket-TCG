// Real, per-conversation "the owner is handling this one themselves right
// now" state — see shared/src/schema.ts's agentConversationTakeovers for
// why this exists and how it's detected (Meta's message_echoes for
// Instagram/Messenger; a manual "I've got this" button everywhere else).
// A conversation stays silenced for a real 5-minute window from the most
// recent genuine human reply/manual takeover, refreshed on each one — not
// a one-shot flag that immediately expires or never clears.

import { eq, and } from "drizzle-orm";
import { db } from "../../db";
import { agentConversationTakeovers, agents } from "@shared/schema";

export const TAKEOVER_WINDOW_MS = 5 * 60 * 1000;

export async function isHumanTakeoverActive(agentId: string, externalConversationId: string): Promise<boolean> {
  const [row] = await db
    .select()
    .from(agentConversationTakeovers)
    .where(and(eq(agentConversationTakeovers.agentId, agentId), eq(agentConversationTakeovers.externalConversationId, externalConversationId)));
  return !!row && row.takeoverUntil.getTime() > Date.now();
}

/** Starts or refreshes the 5-minute silence window for one conversation. Returns the new expiry. */
export async function startOrExtendHumanTakeover(agentId: string, externalConversationId: string): Promise<Date> {
  const takeoverUntil = new Date(Date.now() + TAKEOVER_WINDOW_MS);
  const [existing] = await db
    .select()
    .from(agentConversationTakeovers)
    .where(and(eq(agentConversationTakeovers.agentId, agentId), eq(agentConversationTakeovers.externalConversationId, externalConversationId)));
  if (existing) {
    await db.update(agentConversationTakeovers).set({ takeoverUntil, updatedAt: new Date() }).where(eq(agentConversationTakeovers.id, existing.id));
  } else {
    await db.insert(agentConversationTakeovers).values({ agentId, externalConversationId, takeoverUntil });
  }
  return takeoverUntil;
}

/** Ends the silence window immediately — the owner explicitly handing the conversation back to the agent. */
export async function endHumanTakeover(agentId: string, externalConversationId: string): Promise<void> {
  await db
    .delete(agentConversationTakeovers)
    .where(and(eq(agentConversationTakeovers.agentId, agentId), eq(agentConversationTakeovers.externalConversationId, externalConversationId)));
}

export async function isAgentPaused(agentId: string): Promise<boolean> {
  const [row] = await db.select({ isPaused: agents.isPaused }).from(agents).where(eq(agents.id, agentId));
  return !!row?.isPaused;
}
