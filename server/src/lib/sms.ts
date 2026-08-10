let twilioClient: import("twilio").Twilio | null = null;

async function getTwilioClient() {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) return null;
  if (!twilioClient) {
    const { default: Twilio } = await import("twilio");
    twilioClient = Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
  return twilioClient;
}

/**
 * Sends an SMS if Twilio credentials are configured; otherwise logs the
 * code to the console so local development / demo runs still work
 * end-to-end without a real Twilio account.
 */
export async function sendSms(toE164: string, body: string): Promise<void> {
  const client = await getTwilioClient();
  if (!client || !process.env.TWILIO_FROM_NUMBER) {
    console.log(`[sms:DEV — no Twilio configured] To: ${toE164} | ${body}`);
    return;
  }
  await client.messages.create({ to: toE164, from: process.env.TWILIO_FROM_NUMBER, body });
}
