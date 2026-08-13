// AI-assisted "custom tracking" verification — for third-party sellers
// shipping via a courier outside the fixed COURIER_PATTERNS list
// (Australia Post/DHL/FedEx). The seller declares which business the
// tracking number is from; Claude is asked whether that number's format
// is actually consistent with a real tracking number from that business.
//
// This is pattern-matching against known tracking-number formats Claude
// has seen, same as the hardcoded regexes for the other couriers — it is
// NOT a live lookup against any carrier's API, and can't confirm a package
// is real or moving. Every result is stored and shown as a disclosed note
// for exactly that reason (see routes/orders.ts, customTrackingNote).
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001";
const TIMEOUT_MS = 8000;

export function isCarrierDetectionConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export interface CarrierDetectionResult {
  detectedBusiness: string;
  matchesDeclared: boolean;
  confidence: "high" | "medium" | "low";
  reasoning: string;
}

const SYSTEM_PROMPT = `You verify shipping tracking numbers for PullMarket TCG, a peer-to-peer trading card marketplace. A seller has entered a tracking number and told you which shipping business it's supposedly from. Your job is ONLY to judge whether the tracking number's format (length, character pattern, checksum structure, known prefixes) is actually consistent with a real tracking number issued by that business, based on publicly documented tracking-number formats you know of (postal services, couriers, freight forwarders, marketplace-integrated shipping like eBay/AliExpress/Temu international shipping, etc. — from any country).

Respond with ONLY a JSON object, no other text:
{"detectedBusiness": "the specific business/carrier this format most likely actually belongs to, or the declared name if you can't tell otherwise", "matchesDeclared": boolean, "confidence": "high"|"medium"|"low", "reasoning": "one short sentence"}

Be reasonably lenient — many legitimate couriers and marketplace shipping programs use formats you may not have exact confirmation of. Only set matchesDeclared=false when the format clearly contradicts the declared business (wrong length, wrong character set, or it clearly matches a well-known DIFFERENT carrier's format instead) or the tracking number is obviously fake/nonsensical (e.g. "test123", all the same digit, way too short). When genuinely unsure, prefer matchesDeclared=true with confidence="low" rather than blocking a legitimate seller.`;

/** Returns null when detection can't run (not configured, network/parse
 * failure) — callers should treat null as "AI verification unavailable"
 * and handle it explicitly (this feature requires a real verdict to mean
 * anything, unlike moderation which can silently no-op). */
export async function detectCarrier(trackingNumber: string, declaredBusiness: string): Promise<CarrierDetectionResult | null> {
  if (!isCarrierDetectionConfigured()) return null;
  const trimmedNumber = trackingNumber.trim();
  const trimmedBusiness = declaredBusiness.trim();
  if (!trimmedNumber || !trimmedBusiness) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 200,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: `Tracking number: ${trimmedNumber.slice(0, 100)}\nDeclared business: ${trimmedBusiness.slice(0, 100)}` }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error("Carrier detection API call failed:", res.status, await res.text().catch(() => ""));
      return null;
    }
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const raw = data.content?.find((b) => b.type === "text")?.text;
    if (!raw) return null;

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as Partial<CarrierDetectionResult>;
    const confidence: CarrierDetectionResult["confidence"] = ["high", "medium", "low"].includes(parsed.confidence as string)
      ? (parsed.confidence as CarrierDetectionResult["confidence"])
      : "low";
    return {
      detectedBusiness: typeof parsed.detectedBusiness === "string" && parsed.detectedBusiness.trim() ? parsed.detectedBusiness.slice(0, 200) : trimmedBusiness,
      matchesDeclared: !!parsed.matchesDeclared,
      confidence,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning.slice(0, 500) : "",
    };
  } catch (err) {
    console.error("Carrier detection failed:", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
