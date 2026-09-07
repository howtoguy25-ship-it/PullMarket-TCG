// Weekly/daily session-limit clock, matching the product spec:
//  - Weekly limit resets every Monday 05:00, Australia/Sydney time (AEST/AEDT),
//    for every user regardless of their own timezone.
//  - A session that's being "forced" (messages fired back-to-back with
//    little gap) needs longer to "rest" than one used smoothly.
//  - The example given: it's 1pm, credits have been used smoothly for
//    1-2 hours, and the balance is about to run out at 2:47pm -> the next
//    reset lands on the nearest half-hour/hour boundary after that (3:30pm
//    or 4pm) depending on how hard the session was pushed.
//
// The spec's numeric example is illustrative, not a formula, so this is an
// explicit, documented interpretation of it rather than a guess hidden in
// code: round the "credits ran out" timestamp up to the next 30-minute
// boundary, then add one extra 30-minute slot for a smoothly-paced session
// or two extra slots (i.e. a full hour more) for a forced/rapid-fire one.

const SYDNEY_TZ = "Australia/Sydney";
const THIRTY_MIN_MS = 30 * 60 * 1000;

/** Sydney wall-clock time for an instant, using Intl so it stays correct across DST. */
function sydneyParts(date: Date) {
  const fmt = new Intl.DateTimeFormat("en-AU", {
    timeZone: SYDNEY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return parts as Record<string, string>;
}

/** The UTC offset (in minutes) Sydney is currently observing, for the given instant. */
function sydneyOffsetMinutes(date: Date): number {
  const utcAsSydneyWall = new Date(
    date.toLocaleString("en-US", { timeZone: SYDNEY_TZ }),
  );
  return Math.round((utcAsSydneyWall.getTime() - date.getTime()) / 60000);
}

/** Next Monday 05:00 Sydney time, strictly after `from`. */
export function nextWeeklyResetAt(from: Date): Date {
  const parts = sydneyParts(from);
  const weekdayIndex: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };
  const currentWeekday = weekdayIndex[parts.weekday];
  const daysUntilMonday = (8 - currentWeekday) % 7 || 7;

  // Build "next Monday 05:00" as a naive Sydney wall-clock value, then
  // convert to a real UTC instant using that day's Sydney offset.
  const naiveLocal = new Date(
    Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day) + daysUntilMonday,
      5,
      0,
      0,
    ),
  );
  const offsetMin = sydneyOffsetMinutes(from);
  const candidate = new Date(naiveLocal.getTime() - offsetMin * 60000);

  // If today already IS Monday and it's before 05:00 Sydney time, the reset
  // is *today* at 05:00, not seven days out.
  if (currentWeekday === 1) {
    const todayFiveAm = new Date(
      Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), 5, 0, 0),
    );
    const todayFiveAmUtc = new Date(todayFiveAm.getTime() - offsetMin * 60000);
    if (todayFiveAmUtc.getTime() > from.getTime()) return todayFiveAmUtc;
  }
  return candidate;
}

/** Start of the current Sydney calendar day, as a UTC instant. */
export function startOfSydneyDay(from: Date): Date {
  const parts = sydneyParts(from);
  const offsetMin = sydneyOffsetMinutes(from);
  const midnight = new Date(
    Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), 0, 0, 0),
  );
  return new Date(midnight.getTime() - offsetMin * 60000);
}

export type SessionPace = "smooth" | "forced";

/**
 * When a session exhausts its credits/time at `ranOutAt`, compute when it's
 * allowed to resume. Smooth usage rests one 30-minute slot; forced/rapid
 * usage rests a full extra hour so the model genuinely gets a longer break.
 */
export function computeRestUntil(ranOutAt: Date, pace: SessionPace): Date {
  const msIntoSlot = ranOutAt.getTime() % THIRTY_MIN_MS;
  const roundedUp = new Date(ranOutAt.getTime() + (THIRTY_MIN_MS - msIntoSlot));
  const extraSlots = pace === "forced" ? 2 : 1;
  return new Date(roundedUp.getTime() + extraSlots * THIRTY_MIN_MS);
}

/** Human string for banners: "resets at 4:00 PM AEST" style, always in Sydney time. */
export function formatSydneyTime(date: Date): string {
  const fmt = new Intl.DateTimeFormat("en-AU", {
    timeZone: SYDNEY_TZ,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const offsetMin = sydneyOffsetMinutes(date);
  const label = offsetMin === 600 ? "AEST" : offsetMin === 660 ? "AEDT" : "Sydney time";
  return `${fmt.format(date)} ${label}`;
}

/** Same instant formatted in the viewer's own timezone, for the in-app banner subtext. */
export function formatInTimezone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).format(date);
}
