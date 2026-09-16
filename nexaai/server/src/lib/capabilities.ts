import { DEFAULT_CAPABILITIES, type NexaCapabilities } from "@shared/schema";
import type { OwnerSettingsRow } from "./ownerSettings";

/** Merges a user's stored capabilities JSON with the defaults, so a partially-set or empty blob still behaves correctly. */
export function resolveCapabilities(raw: unknown): NexaCapabilities {
  const stored = (raw ?? {}) as Partial<NexaCapabilities>;
  return { ...DEFAULT_CAPABILITIES, ...stored };
}

/**
 * Applies the owner panel's real, app-wide kill switches on top of a
 * user's own resolved capabilities — an AND, never an OR: a feature the
 * owner has turned off is off for this user even if their own toggle is
 * on, and a feature the owner left on is still governed entirely by the
 * user's own setting. Use this for actual gating decisions; keep using
 * plain resolveCapabilities() when just reading back a user's own stored
 * preference (e.g. GET /api/auth/me, the PATCH capabilities merge) — those
 * must reflect what the user actually has set, not the owner's overlay.
 */
export function applyOwnerOverrides(caps: NexaCapabilities, settings: OwnerSettingsRow): NexaCapabilities {
  return {
    ...caps,
    webLookup: caps.webLookup && settings.webLookupEnabled,
    whoIsLookup: caps.whoIsLookup && settings.webLookupEnabled,
    topicImages: caps.topicImages && settings.webLookupEnabled,
    voiceChat: caps.voiceChat && settings.voiceChatEnabled,
    agentBuilder: caps.agentBuilder && settings.agentBuilderEnabled,
    smartBuild: caps.smartBuild && settings.smartBuildEnabled,
  };
}
