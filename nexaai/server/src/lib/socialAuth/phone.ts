// Real phone-number sign-in via Twilio Verify — a dedicated Verify Service
// for one-time SMS codes, distinct from the per-user Twilio connector
// (lib/connectors/twilio.ts, which wires a *user's own* Twilio account to
// receive phone calls). This one is app-level: NexaAi's own Twilio account
// sends the OTP that proves someone owns the phone number they typed in.
//
// Setup required (real, your own Twilio account):
//   1. twilio.com/console -> copy the Account SID + Auth Token.
//   2. Verify -> Services -> Create new Service (any friendly name, e.g.
//      "NexaAi sign-in") -> copy its Service SID (starts with "VA").
//   3. Set TWILIO_VERIFY_ACCOUNT_SID / TWILIO_VERIFY_AUTH_TOKEN /
//      TWILIO_VERIFY_SERVICE_SID.
// Until all three are set, phone sign-in honestly reports itself as not
// configured (same pattern as Google/GitHub sign-in) rather than pretending
// to send a code.

const API_BASE = "https://verify.twilio.com/v2";

export function isPhoneAuthConfigured(): boolean {
  return !!(process.env.TWILIO_VERIFY_ACCOUNT_SID && process.env.TWILIO_VERIFY_AUTH_TOKEN && process.env.TWILIO_VERIFY_SERVICE_SID);
}

function authHeader(): string {
  const auth = Buffer.from(`${process.env.TWILIO_VERIFY_ACCOUNT_SID}:${process.env.TWILIO_VERIFY_AUTH_TOKEN}`).toString("base64");
  return `Basic ${auth}`;
}

/** E.164 only (e.g. +14155552671) — the format both Twilio and the client's phone input use. */
export const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

/** Sends a real SMS code via Twilio Verify. Throws with a message safe to show the user on failure (e.g. an invalid/unreachable number). */
export async function startPhoneVerification(phone: string): Promise<void> {
  const response = await fetch(`${API_BASE}/Services/${process.env.TWILIO_VERIFY_SERVICE_SID}/Verifications`, {
    method: "POST",
    headers: { Authorization: authHeader(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: phone, Channel: "sms" }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.message ?? "Couldn't send a code to that number. Double-check it and try again.");
  }
}

/** Checks a real code against Twilio Verify. Returns true only on a genuine "approved" status. */
export async function checkPhoneVerification(phone: string, code: string): Promise<boolean> {
  const response = await fetch(`${API_BASE}/Services/${process.env.TWILIO_VERIFY_SERVICE_SID}/VerificationCheck`, {
    method: "POST",
    headers: { Authorization: authHeader(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: phone, Code: code }),
  });
  if (!response.ok) return false;
  const body = (await response.json().catch(() => null)) as { status?: string } | null;
  return body?.status === "approved";
}
