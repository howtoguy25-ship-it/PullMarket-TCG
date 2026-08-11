import nodemailer from "nodemailer";

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (!process.env.SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      // Without these, a misconfigured or unreachable SMTP host hangs the
      // whole request for nodemailer's multi-minute defaults instead of
      // failing fast with a clear error.
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 8000,
    });
  }
  return transporter;
}

/**
 * Sends an email if SMTP_* env vars are configured; otherwise logs to the
 * console so local development / demo runs still work end-to-end without
 * requiring real SMTP credentials.
 */
export async function sendEmail(opts: { to: string; subject: string; text: string; html?: string }): Promise<void> {
  const client = getTransporter();
  if (!client) {
    console.log(`[mailer:DEV — no SMTP configured] To: ${opts.to} | Subject: ${opts.subject}\n${opts.text}`);
    return;
  }
  await client.sendMail({
    from: process.env.SMTP_FROM || "PullMarket TCG <no-reply@pullmarket.app>",
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
  });
}
