import { desc, eq } from "drizzle-orm";
import { db } from "../db";
import { memoryEntries, users } from "@shared/schema";
import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

const EXTRACT_SYSTEM_PROMPT = `You maintain a long-term memory file about one app user, based on one chat turn.
Decide if this turn revealed a durable fact worth remembering for future conversations — a preference, a
recurring topic, a fact about their life/possessions/goals (e.g. "drives a 2019 Mazda 3", "is learning to bake",
"prefers metric units", "is saving for a house deposit").
Do NOT save: one-off trivia, the assistant's own answer content, anything about health conditions, religion,
sexual orientation, political views, or immigration status.
Reply with exactly one line:
- "NONE" if nothing durable and safe is worth saving, OR
- a single concise third-person sentence (under 20 words) to save, starting with the user's name if known or "User".`;

/**
 * Runs after a completed turn. Uses a cheap/fast model call (never the
 * user's own plan-tier model) to decide whether anything durable and safe
 * is worth remembering, and stores it if so. No-ops entirely if the user
 * has memory turned off.
 */
export async function extractAndStoreMemory(userId: string, sessionId: string, userMessage: string, assistantMessage: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user || !user.memoryEnabled) return;

  const anthropic = getClient();
  if (!anthropic) return; // no API key configured — memory extraction needs the same real Claude access as chat

  let verdict: string;
  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 60,
      system: EXTRACT_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `User said: "${userMessage.slice(0, 500)}"\nNexaAi replied: "${assistantMessage.slice(0, 500)}"`,
        },
      ],
    });
    verdict = response.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
  } catch {
    return; // memory extraction is best-effort; never break the chat turn over it
  }

  if (!verdict || verdict.toUpperCase().startsWith("NONE")) return;

  // A second, cheap heuristic pass isn't worth another API call here — the
  // extraction prompt above already instructs the model to exclude
  // sensitive categories, so anything it *does* return is treated as
  // non-sensitive. If the user has sensitive-topic memory off, that's the
  // enforcement point; there is currently no separate sensitive-content
  // classifier beyond the extraction prompt's own instruction.
  if (!user.includeSensitiveInMemory && looksSensitive(verdict)) return;

  await db.insert(memoryEntries).values({ userId, content: verdict, sourceSessionId: sessionId });
}

const SENSITIVE_KEYWORDS = [
  "health",
  "diagnos",
  "disease",
  "illness",
  "religio",
  "politic",
  "sexual",
  "gender identity",
  "immigration",
  "visa status",
  "disability",
  "pregnan",
];

function looksSensitive(text: string): boolean {
  const lower = text.toLowerCase();
  return SENSITIVE_KEYWORDS.some((kw) => lower.includes(kw));
}

/** Formats the most recent memory entries for injection into a chat system prompt. Returns "" if there's nothing (or memory reference is off). */
export async function getMemoryContext(userId: string): Promise<string> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user || !user.memoryEnabled || !user.referenceChatsEnabled) return "";

  const rows = await db
    .select()
    .from(memoryEntries)
    .where(eq(memoryEntries.userId, userId))
    .orderBy(desc(memoryEntries.createdAt))
    .limit(15);
  if (rows.length === 0) return "";

  return "\n\nWhat you remember about this user from past chats (use naturally, don't just list it back):\n" + rows.map((r) => `- ${r.content}`).join("\n");
}
