import { DEFAULT_CAPABILITIES, type NexaCapabilities } from "@shared/schema";

/** Merges a user's stored capabilities JSON with the defaults, so a partially-set or empty blob still behaves correctly. */
export function resolveCapabilities(raw: unknown): NexaCapabilities {
  const stored = (raw ?? {}) as Partial<NexaCapabilities>;
  return { ...DEFAULT_CAPABILITIES, ...stored };
}
