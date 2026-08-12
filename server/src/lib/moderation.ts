// AI chat moderation — classifies a message for scam/fraud attempts and
// abusive language using Claude. Moderation never blocks a message from
// sending: it runs after the message is already delivered and only opens
// an owner-review report when something looks wrong (see routes/chat.ts).
// No moderation system catches everything — this flags likely issues for a
// human (the owner) to actually decide on, it doesn't auto-punish anyone.
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5-20251001";
const TIMEOUT_MS = 8000;

export function isModerationConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export type ModerationCategory = "scam" | "harassment" | "inappropriate" | "none";

export interface ModerationResult {
  flagged: boolean;
  category: ModerationCategory;
  reasoning: string;
}

const SYSTEM_PROMPT = `You are a content moderation classifier for PullMarket TCG, a peer-to-peer Pokémon/One Piece trading card marketplace's in-app chat. You review a single chat message and decide if it shows signs of:
- "scam": asking to pay/communicate outside the app, phishing links, fake tracking numbers, requests for gift cards/wire transfers/crypto, too-good-to-be-true offers, impersonating PullMarket staff, or other fraud indicators.
- "harassment": threats, hate speech, sexual harassment, or targeted abuse.
- "inappropriate": sexual content, graphic violence, or other content that doesn't belong on a card-trading marketplace, but isn't harassment or a scam.
- "none": ordinary conversation about cards, prices, shipping, meetups, etc. — including blunt or informal language that isn't actually abusive.

Respond with ONLY a JSON object, no other text: {"flagged": boolean, "category": "scam"|"harassment"|"inappropriate"|"none", "reasoning": "one short sentence"}
Only set flagged=true for a genuine, specific concern — not for slang, sarcasm, or ordinary negotiating. When unsure, prefer flagged=false.`;

/** Returns null (not an error signal) whenever moderation can't run or
 * didn't produce a usable verdict — callers should treat null as "no
 * opinion" and let the message through unflagged, same as if this module
 * weren't configured at all. */
export async function moderateMessage(text: string): Promise<ModerationResult | null> {
  if (!isModerationConfigured()) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

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
        messages: [{ role: "user", content: trimmed.slice(0, 4000) }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error("Moderation API call failed:", res.status, await res.text().catch(() => ""));
      return null;
    }
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const raw = data.content?.find((b) => b.type === "text")?.text;
    if (!raw) return null;

    // Claude is asked for bare JSON but defensively handle a stray code fence.
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as Partial<ModerationResult>;
    const category: ModerationCategory = ["scam", "harassment", "inappropriate", "none"].includes(parsed.category as string)
      ? (parsed.category as ModerationCategory)
      : "none";
    return {
      flagged: !!parsed.flagged && category !== "none",
      category,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning.slice(0, 500) : "",
    };
  } catch (err) {
    console.error("Moderation check failed:", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
