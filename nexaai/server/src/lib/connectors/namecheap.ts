// Real Namecheap connection — manual credential entry, not OAuth, because
// Namecheap's API genuinely has no OAuth flow: it authenticates by API
// key + username + an IP address you've whitelisted on your Namecheap
// account, the same real constraint that makes WhatsApp Cloud API a manual
// flow too (see lib/connectors/meta.ts's header for that one). This is the
// real, standard way third-party apps use the Namecheap API.
//
// Setup required (real, on the user's own Namecheap account):
//   1. ap.www.namecheap.com/settings/tools/apiaccess -> enable API access,
//      generate an API key, and whitelist this server's outbound IP.
//   2. Enter that API key + Namecheap username in the Connectors screen.

import { eq, and } from "drizzle-orm";
import { db } from "../../db";
import { connectors } from "@shared/schema";

const API_BASE = "https://api.namecheap.com/xml.response";

/** Real verification call against Namecheap's actual API (namecheap.users.getBalances is a harmless read). */
export async function connectNamecheapManually(
  userId: string,
  apiUser: string,
  apiKey: string,
  clientIp: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const params = new URLSearchParams({
    ApiUser: apiUser,
    ApiKey: apiKey,
    UserName: apiUser,
    ClientIp: clientIp,
    Command: "namecheap.users.getBalances",
  });

  let xml: string;
  try {
    const response = await fetch(`${API_BASE}?${params.toString()}`);
    xml = await response.text();
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Couldn't reach Namecheap's API." };
  }

  if (xml.includes('Status="ERROR"')) {
    const match = xml.match(/<Error[^>]*>([^<]+)<\/Error>/);
    return { ok: false, message: match ? match[1] : "Namecheap rejected those credentials." };
  }
  if (!xml.includes('Status="OK"')) {
    return { ok: false, message: "Unexpected response from Namecheap's API — double-check the API key, username, and whitelisted IP." };
  }

  const values = {
    status: "connected" as const,
    externalAccountLabel: apiUser,
    accessToken: apiKey,
    providerMetadata: { apiUser, clientIp },
    connectedAt: new Date(),
  };
  const [existing] = await db.select().from(connectors).where(and(eq(connectors.userId, userId), eq(connectors.provider, "namecheap")));
  if (existing) {
    await db.update(connectors).set(values).where(eq(connectors.id, existing.id));
  } else {
    await db.insert(connectors).values({ userId, provider: "namecheap", ...values });
  }
  return { ok: true };
}
