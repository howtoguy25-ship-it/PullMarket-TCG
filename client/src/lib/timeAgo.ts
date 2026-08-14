export function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Compact variant for tight chat-row layouts ("2m", "3h", "5d" — no "ago"). */
export function timeAgoShort(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// A message's read-receipt status shown on tapping the ticks. Spelled out
// in full words ("Seen 1 minute ago") rather than the compact "1m" used
// elsewhere, since this is a standalone status line, not a tight list row.
// Once it's been more than a day + an hour since it was seen, the exact
// age stops being useful information — it just permanently reads "Seen".
const SEEN_AGE_CUTOFF_MS = (24 + 1) * 60 * 60 * 1000;

export function formatSeenStatus(readAtIso: string | null): string {
  if (!readAtIso) return "Not seen yet";
  const diffMs = Date.now() - new Date(readAtIso).getTime();
  if (diffMs >= SEEN_AGE_CUTOFF_MS) return "Seen";

  const seconds = Math.max(0, Math.floor(diffMs / 1000));
  if (seconds < 60) return "Seen just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Seen ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  return `Seen ${hours} hour${hours === 1 ? "" : "s"} ago`;
}
