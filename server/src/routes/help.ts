import { Router } from "express";
import { z } from "zod";
import { authenticateToken } from "../middleware/auth";

const router = Router();
router.use(authenticateToken);

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-5-20250929";
const TIMEOUT_MS = 20000;

function isHelpAssistantConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

const SYSTEM_PROMPT = `You are the in-app help assistant for PullMarket TCG, a peer-to-peer marketplace app (iOS/Android/web) for buying and selling Pokémon and One Piece trading cards. Answer questions about how to use the app, concisely and warmly.

What the app does:
- Browse/search listings by franchise (Pokémon or One Piece), buy cards, add to cart or favorites, checkout with a card via Stripe.
- Sell cards: create a listing with photos, price, and condition from the Sell tab. Sellers must complete Stripe Connect payout setup and identity verification before a listing can go live.
- Orders: buyers and sellers track orders and shipping from Orders. Sellers add tracking info; there's an AI-assisted custom/third-party tracking verification.
- Prices tab: live market price lookups for cards, in AUD.
- Chat: message other users about a listing or in general. Supports reply, delete-for-me, delete-for-everyone (within 24h), forwarding, blocking, muting a conversation (5 min to forever), archiving, and swipe gestures on the chat list (swipe left for mute/delete, swipe right to archive).
- Friend requests and following: users can send friend requests and follow each other; followers list is visible on profiles.
- Voice/video calling between users from a chat.
- PullMarket Pro ($19.99/mo): follower system, a verified badge, a 48-hour listing boost on every new listing, and better search placement. Manage/cancel from Profile > PullMarket Pro (Stripe billing portal on web, or Apple subscription management on iOS).
- Remove Ads ($39.99 one-time): removes all ads app-wide. Purchasable via Stripe on web or Apple In-App Purchase on iOS; "Restore purchases" is available on the Remove Ads screen.
- Reporting: users can report a listing, an order, a conversation, a specific message, or a user for scams, harassment, or inappropriate content — reviewed by the PullMarket team.
- Notifications: new messages, friend requests, price alerts (configurable per franchise), order updates.
- Account: sign in via phone OTP, email OTP, Google, or Apple. Delete account available in Profile with a 30-day grace period and re-authentication.

Guidelines:
- Be concise — a few sentences, not an essay, unless the user asks for detail.
- If asked about something you don't have specifics on (a specific order, a payment dispute, a bug, account access issues), tell them to use the in-app Report feature (on the relevant listing/order/user) for anything needing a human, or contact support at Sales@pullmarkettcg.com.
- Never invent policies, prices, or refund terms you're not told here. Never ask for or handle passwords, card numbers, or verification codes — the app never needs those in chat.
- You cannot take actions in the app yourself (you can't cancel an order, issue a refund, or change a setting) — only explain how the user can do it themselves.`;

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

// Simple per-user in-memory limiter — good enough for a single Render
// instance; see the Redis note on the other per-user limiters in this
// codebase if this ever needs to survive a multi-instance deploy.
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const requestLog = new Map<string, number[]>();

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const recent = (requestLog.get(userId) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  requestLog.set(userId, recent);
  return recent.length > RATE_LIMIT_MAX;
}

router.post("/chat", async (req, res) => {
  if (!isHelpAssistantConfigured()) {
    return res.status(503).json({ message: "The help assistant isn't configured yet. Email Sales@pullmarkettcg.com in the meantime." });
  }
  if (isRateLimited(req.user!.id)) {
    return res.status(429).json({ message: "You've sent a lot of messages — try again in a bit, or email Sales@pullmarkettcg.com." });
  }

  const schema = z.object({
    messages: z
      .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) }))
      .min(1)
      .max(40),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid request" });

  const turns: ChatTurn[] = parsed.data.messages;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const apiRes = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 600,
        system: SYSTEM_PROMPT,
        messages: turns.map((t) => ({ role: t.role, content: t.content })),
      }),
      signal: controller.signal,
    });

    if (!apiRes.ok) {
      console.error("Help assistant API call failed:", apiRes.status, await apiRes.text().catch(() => ""));
      return res.status(502).json({ message: "The help assistant is temporarily unavailable. Try again shortly." });
    }

    const data = (await apiRes.json()) as { content?: { type: string; text?: string }[] };
    const reply = data.content?.find((b) => b.type === "text")?.text;
    if (!reply) return res.status(502).json({ message: "The help assistant didn't return a response. Try again." });

    res.json({ reply });
  } catch (err) {
    console.error("Help assistant request failed:", err);
    res.status(504).json({ message: "The help assistant timed out. Try again." });
  } finally {
    clearTimeout(timer);
  }
});

export default router;
