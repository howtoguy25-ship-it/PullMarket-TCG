// Real Claude-style rolling usage window: no fixed daily/weekly clock, no
// per-tier "rest" penalty for fast usage — just a plain N-hour window that
// starts on your first message and caps how many you can send until it
// expires, the same shape Claude's own Free/Pro/Max limits use.

export const USAGE_WINDOW_HOURS = 5;
export const USAGE_WINDOW_MS = USAGE_WINDOW_HOURS * 60 * 60 * 1000;

/** True once `windowStartAt` (or its absence) means there's no active window to check against. */
export function isWindowExpired(windowStartAt: Date | null, now: Date): boolean {
  if (!windowStartAt) return true;
  return now.getTime() - windowStartAt.getTime() >= USAGE_WINDOW_MS;
}

export function windowResetAt(windowStartAt: Date): Date {
  return new Date(windowStartAt.getTime() + USAGE_WINDOW_MS);
}

/** "More available in 2h 14m" / "in 38m" — Claude's own reset-countdown phrasing. */
export function formatCountdown(resetAt: Date, from: Date): string {
  const ms = Math.max(0, resetAt.getTime() - from.getTime());
  const totalMinutes = Math.ceil(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}m`;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

/** The reset instant formatted in the viewer's own timezone, e.g. "4:12 PM EDT". */
export function formatInTimezone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).format(date);
}
