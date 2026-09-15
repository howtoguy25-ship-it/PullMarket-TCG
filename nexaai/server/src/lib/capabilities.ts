import { DEFAULT_CAPABILITIES, type NexaCapabilities } from "@shared/schema";
import type { OwnerSettingsRow } from "./ownerSettings";

/** Merges a user's stored capabilities JSON with the defaults, so a partially-set or empty blob still behaves correctly. */
export function resolveCapabilities(raw: unknown): NexaCapabilities {
  const stored = (raw ?? {}) as Partial<NexaCapabilities>;
  return { ...DEFAULT_CAPABILITIES, ...stored };
}

/**
 * Layers the owner panel's app-wide kill switches on top of a user's own
 * resolved capabilities, for gating decisions only (chat.ts/voice.ts/
 * agents.ts checkpoints) — never for `GET /api/auth/me` or the capabilities
 * PATCH merge in auth.ts, which must keep reflecting the user's own stored
 * preference regardless of the owner's current override. ANDs each flag so
 * the owner can only ever turn something MORE off, never force it on for a
 * user who already turned it off themselves.
 */
export function applyOwnerOverrides(caps: NexaCapabilities, settings: OwnerSettingsRow): NexaCapabilities {
  return {
    ...caps,
    webLookup: caps.webLookup && settings.webLookupEnabled,
    whoIsLookup: caps.whoIsLookup && settings.webLookupEnabled,
    voiceChat: caps.voiceChat && settings.voiceChatEnabled,
    agentBuilder: caps.agentBuilder && settings.agentBuilderEnabled,
    topicImages: caps.topicImages && settings.topicImagesEnabled,
  };
}
