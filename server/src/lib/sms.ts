let twilioClient: import("twilio").Twilio | null = null;

async function getTwilioClient() {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) return null;
  if (!twilioClient) {
    const { default: Twilio } = await import("twilio");
    twilioClient = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
  return twilioClient;
}

async function sendViaTwilio(toE164: string, body: string): Promise<boolean> {
  const client = await getTwilioClient();
  if (!client || !process.env.TWILIO_FROM_NUMBER) return false;
  await client.messages.create({ to: toE164, from: process.env.TWILIO_FROM_NUMBER, body });
  return true;
}

// Vonage's plain SMS REST API — just an API key/secret (available immediately
// on signup, no compliance-review wait like Twilio's Trust Hub) and an
// alphanumeric sender ID (e.g. "PullMarket"), which most countries including
// Australia allow for one-way messages without buying a dedicated number.
// https://developer.vonage.com/en/api/sms
async function sendViaVonage(toE164: string, body: string): Promise<boolean> {
  const apiKey = process.env.VONAGE_API_KEY;
  const apiSecret = process.env.VONAGE_API_SECRET;
  if (!apiKey || !apiSecret) return false;

  const from = process.env.VONAGE_FROM || "PullMarket";
  const params = new URLSearchParams({
    api_key: apiKey,
    api_secret: apiSecret,
    to: toE164.replace(/^\+/, ""),
    from,
    text: body,
  });

  const res = await fetch("https://rest.nexmo.com/sms/json", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const data = (await res.json()) as { messages?: Array<{ status: string; "error-text"?: string }> };
  const first = data.messages?.[0];
  if (!first || first.status !== "0") {
    throw new Error(`Vonage SMS failed: ${first?.["error-text"] ?? "unknown error"}`);
  }
  return true;
}

/**
 * Sends an SMS via whichever real provider is configured (Vonage preferred,
 * then Twilio), or logs the code to the console so local development / demo
 * runs still work end-to-end without any SMS account at all.
 */
export async function sendSms(toE164: string, body: string): Promise<void> {
  if (await sendViaVonage(toE164, body)) return;
  if (await sendViaTwilio(toE164, body)) return;
  console.log(`[sms:DEV — no SMS provider configured] To: ${toE164} | ${body}`);
}
