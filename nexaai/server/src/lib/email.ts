// Real transactional email via Resend (resend.com) — one API key, one HTTP
// call, no SMTP setup. Currently used for exactly one thing: the "forgot
// password" reset link (routes/auth.ts). Until RESEND_API_KEY is set, this
// honestly reports itself as not configured rather than pretending to send
// mail — same pattern as every other real-but-needs-a-key feature in this
// app (OpenAI, Gemini, Paddle, ...).
//
// Setup required (real, your own Resend account):
//   1. resend.com -> API Keys -> Create API Key -> set RESEND_API_KEY.
//   2. (Optional, recommended) resend.com -> Domains -> verify asknexaai.com,
//      then set RESEND_FROM_EMAIL to an address on that domain, e.g.
//      "NexaAi <noreply@asknexaai.com>". Until a domain is verified, Resend
//      only delivers from its own onboarding@resend.dev sender, which is
//      what RESEND_FROM_EMAIL defaults to below.

export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

function fromAddress(): string {
  return process.env.RESEND_FROM_EMAIL || "NexaAi <onboarding@resend.dev>";
}

/** Real POST to Resend's API. Throws on a genuine send failure — callers decide whether that should surface to the end user or just get logged. */
export async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: fromAddress(), to, subject, html }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.message ?? `Resend rejected the email (${response.status}).`);
  }
}
