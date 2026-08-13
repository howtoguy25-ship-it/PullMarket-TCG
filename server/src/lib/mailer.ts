// Sends email via Resend's HTTPS API (https://resend.com) rather than raw
// SMTP — Render's outbound network blocks SMTP ports outright (confirmed:
// nodemailer hit a hard connection timeout against smtp.gmail.com even with
// valid credentials), so any SMTP host will fail here regardless of
// provider. An HTTPS API call has no such restriction.
const RESEND_API_URL = "https://api.resend.com/emails";

/**
 * Sends an email if RESEND_API_KEY is configured; otherwise logs to the
 * console so local development / demo runs still work end-to-end without
 * requiring real credentials.
 */
export async function sendEmail(opts: { to: string; subject: string; text: string; html?: string }): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[mailer:DEV — no RESEND_API_KEY configured] To: ${opts.to} | Subject: ${opts.subject}\n${opts.text}`);
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.SMTP_FROM || "PullMarket TCG <Sales@pullmarkettcg.com>",
        to: opts.to,
        subject: opts.subject,
        text: opts.text,
        html: opts.html,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Resend API ${res.status}: ${body}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}
