// Real Twilio Voice connection — manual credential entry, not OAuth, because
// Twilio's Account SID + Auth Token pair (from twilio.com/console) *is*
// their real, standard way third-party apps authenticate against the REST
// API — the same pattern as Namecheap's API key (see
// lib/connectors/namecheap.ts's header).
//
// This is what powers the real "call NexaAi's phone number and talk to it"
// feature: once connected, NexaAi auto-configures the user's own Twilio
// phone number's Voice webhook to point at this server, so an inbound call
// to that real number reaches routes/voicePhone.ts.
//
// Setup required (real, on the user's own Twilio account):
//   1. twilio.com/console -> copy the Account SID + Auth Token.
//   2. Buy or use an existing Twilio phone number capable of Voice.
//   3. Enter the Account SID, Auth Token, and that phone number (E.164,
//      e.g. +15551234567) in the Connectors screen — NexaAi verifies the
//      credentials and wires the number's webhook for you.
//   4. Requires APP_BASE_URL to be a real, publicly reachable URL (Twilio's
//      servers must be able to reach it) — see server/.env.example.

import { eq, and } from "drizzle-orm";
import crypto from "crypto";
import { db } from "../../db";
import { connectors } from "@shared/schema";
import { appBaseUrl } from "../appBaseUrl";

const API_BASE = "https://api.twilio.com/2010-04-01";

interface TwilioProviderMetadata {
  phoneNumber: string;
  phoneNumberSid?: string;
  webhookConfigured: boolean;
}

/**
 * Real verification against Twilio's actual REST API (fetching the account
 * resource is a harmless, real read), then — if APP_BASE_URL is set — a
 * real write to point the given number's Voice webhook at this server.
 */
export async function connectTwilioManually(
  userId: string,
  accountSid: string,
  authToken: string,
  phoneNumber: string,
): Promise<{ ok: true; webhookConfigured: boolean } | { ok: false; message: string }> {
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

  let accountResponse: Response;
  try {
    accountResponse = await fetch(`${API_BASE}/Accounts/${accountSid}.json`, {
      headers: { Authorization: `Basic ${auth}` },
    });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Couldn't reach Twilio's API." };
  }
  if (!accountResponse.ok) {
    const body = await accountResponse.json().catch(() => null);
    return { ok: false, message: body?.message ?? "Twilio rejected that Account SID / Auth Token pair." };
  }

  // Find the phone number's own resource SID so we can point its Voice
  // webhook at us — real lookup, not assumed.
  let phoneNumberSid: string | undefined;
  let webhookConfigured = false;
  try {
    const lookupUrl = `${API_BASE}/Accounts/${accountSid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(phoneNumber)}`;
    const lookupResponse = await fetch(lookupUrl, { headers: { Authorization: `Basic ${auth}` } });
    const lookupBody = await lookupResponse.json().catch(() => null);
    phoneNumberSid = lookupBody?.incoming_phone_numbers?.[0]?.sid;
  } catch {
    // Non-fatal — credentials still get saved, just without auto-wiring below.
  }

  if (phoneNumberSid && process.env.APP_BASE_URL) {
    try {
      const webhookUrl = `${appBaseUrl()}/api/voice-phone/incoming`;
      const statusCallbackUrl = `${appBaseUrl()}/api/voice-phone/status`;
      const updateResponse = await fetch(`${API_BASE}/Accounts/${accountSid}/IncomingPhoneNumbers/${phoneNumberSid}.json`, {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ VoiceUrl: webhookUrl, VoiceMethod: "POST", StatusCallback: statusCallbackUrl, StatusCallbackMethod: "POST" }),
      });
      webhookConfigured = updateResponse.ok;
    } catch {
      webhookConfigured = false;
    }
  } else if (!phoneNumberSid) {
    return { ok: false, message: `That Twilio account has no phone number matching ${phoneNumber}. Double-check it's in E.164 format (e.g. +15551234567).` };
  }

  const metadata: TwilioProviderMetadata = { phoneNumber, phoneNumberSid, webhookConfigured };
  const values = {
    status: "connected" as const,
    externalAccountLabel: phoneNumber,
    accessToken: authToken,
    providerMetadata: { accountSid, ...metadata },
    connectedAt: new Date(),
  };
  const [existing] = await db.select().from(connectors).where(and(eq(connectors.userId, userId), eq(connectors.provider, "twilio")));
  if (existing) {
    await db.update(connectors).set(values).where(eq(connectors.id, existing.id));
  } else {
    await db.insert(connectors).values({ userId, provider: "twilio", ...values });
  }
  return { ok: true, webhookConfigured };
}

/**
 * Real signature check for inbound Twilio webhooks (routes/voicePhone.ts),
 * matching Twilio's documented algorithm exactly: HMAC-SHA1 of the full
 * webhook URL plus every POST param (sorted by key, key+value concatenated
 * with no separator), keyed with the account's Auth Token, base64-encoded.
 * https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
export function verifyTwilioSignature(authToken: string, fullUrl: string, params: Record<string, string>, signatureHeader: string | undefined): boolean {
  if (!signatureHeader) return false;
  const sortedKeys = Object.keys(params).sort();
  const data = sortedKeys.reduce((acc, key) => acc + key + params[key], fullUrl);
  const expected = crypto.createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signatureHeader);
  // timingSafeEqual throws on a length mismatch rather than returning false —
  // a forged/garbled signature is almost always the wrong length, so that
  // has to be treated as "not valid", not left to bubble into a 500.
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

/** Finds which NexaAi user owns the Twilio number a call came in on. */
export async function findUserIdByTwilioNumber(toNumber: string): Promise<{ userId: string; authToken: string; accountSid: string } | null> {
  const rows = await db.select().from(connectors).where(eq(connectors.provider, "twilio"));
  const match = rows.find((r) => r.status === "connected" && (r.providerMetadata as TwilioProviderMetadata | null)?.phoneNumber === toNumber);
  if (!match || !match.accessToken) return null;
  const metadata = match.providerMetadata as { accountSid?: string } | null;
  if (!metadata?.accountSid) return null;
  return { userId: match.userId, authToken: match.accessToken, accountSid: metadata.accountSid };
}
