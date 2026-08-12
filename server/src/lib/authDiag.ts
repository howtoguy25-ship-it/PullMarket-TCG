// TEMPORARY — in-memory ring buffer of authenticateToken lookups that found
// no matching user row, so the exact userId embedded in a failing request's
// token can be inspected directly instead of guessed at. Deleted along with
// routes/internalDiag.ts once the root cause is found.
interface FailedLookup {
  userId: string;
  tokenVersion: number;
  path: string;
  method: string;
  time: string;
}

const buffer: FailedLookup[] = [];
const MAX = 50;

export function recordFailedLookup(entry: FailedLookup): void {
  buffer.push(entry);
  if (buffer.length > MAX) buffer.shift();
}

export function getFailedLookups(): FailedLookup[] {
  return buffer;
}
