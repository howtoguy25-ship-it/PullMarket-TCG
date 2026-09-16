// Real send-message calls against Meta's Graph API — this is what
// agentRunner.ts's sendPlatformMessage now actually does, instead of
// throwing. All three need App Review-approved permissions to message
// anyone who isn't a Tester/Developer on your Meta app — see
// lib/connectors/meta.ts's header for the full explanation.

const GRAPH_VERSION = "v19.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** Shared by Instagram DMs and Facebook Page Messenger — Meta's Send API for both is the same `/me/messages` endpoint, keyed by whichever Page's access token you pass in. */
async function sendPageMessage(pageAccessToken: string, recipientId: string, text: string, label: string): Promise<void> {
  const response = await fetch(`${GRAPH_BASE}/me/messages?access_token=${encodeURIComponent(pageAccessToken)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
  });
  if (!response.ok) throw new Error(`${label} send failed: ${response.status} ${await response.text()}`);
}

export async function sendInstagramMessage(pageAccessToken: string, recipientIgsid: string, text: string): Promise<void> {
  return sendPageMessage(pageAccessToken, recipientIgsid, text, "Instagram");
}

export async function sendFacebookMessage(pageAccessToken: string, recipientPsid: string, text: string): Promise<void> {
  return sendPageMessage(pageAccessToken, recipientPsid, text, "Facebook Messenger");
}

export async function sendWhatsAppMessage(accessToken: string, phoneNumberId: string, toPhone: string, text: string): Promise<void> {
  const response = await fetch(`${GRAPH_BASE}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ messaging_product: "whatsapp", to: toPhone, type: "text", text: { body: text } }),
  });
  if (!response.ok) throw new Error(`WhatsApp send failed: ${response.status} ${await response.text()}`);
}
