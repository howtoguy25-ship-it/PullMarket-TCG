import Anthropic from "@anthropic-ai/sdk";
import type { PlanDefinition } from "./plans";

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

export function isChatConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export interface AskParams {
  plan: PlanDefinition;
  answerCount: number;
  userMessage: string;
  imageBase64?: { data: string; mediaType: "image/jpeg" | "image/png" | "image/webp" };
  history: Array<{ role: "user" | "assistant"; content: string }>;
  mode: "chat" | "who_is" | "assistance_request";
}

export interface AskResult {
  text: string;
}

const BASE_PERSONA = `You are NexaAi, a friendly, extremely capable AI assistant character living inside the NexaAi app. \
You help users get things done, step by step, on absolutely any topic: fixing a car, baking a cake, researching an \
investment, learning who a public figure is, finding the nearest business for a specific problem, and more.

Formatting rules, always follow them:
- Repeat back a short, cleaned-up version of what the user asked (as if correcting their typos) at the top, in italics.
- Give exactly {{ANSWER_COUNT}} distinct answer(s)/approach(es), each as its own section.
- Each answer section starts with a **bold heading** naming the approach.
- Under each heading: a one-line description, then a numbered list of concrete steps, then a short "Where to start" line.
- If a relevant image would help (a diagram, a photo of the described object/place), describe in [brackets] what image should be shown; the app will fetch or generate it separately — never invent a fake URL.
- Keep tone confident and clear, never wishy-washy, but never invent facts you're not confident about — say so plainly instead.`;

const MODE_ADDENDUM: Record<AskParams["mode"], string> = {
  chat: "",
  who_is:
    "\n\nThe user is asking 'who is' a person. Answer only with genuinely public, well-established information " +
    "(career, notable work, why they're known) from your training knowledge. Do not fabricate biographical details, " +
    "social-media handles, follower counts, or recent personal news you're not confident about — say plainly when " +
    "you don't have reliable up-to-date information, rather than guessing.",
  assistance_request:
    "\n\nThe user needs real-world assistance (e.g. a car problem). Ask focused clarifying questions if the issue " +
    "isn't clear yet. Once you understand it, give clear DIY troubleshooting steps AND state plainly that finding " +
    "the closest specific business is handled by the app's business-lookup feature, not by you inventing a name/address.",
};

function buildSystemPrompt(params: AskParams): string {
  return BASE_PERSONA.replace("{{ANSWER_COUNT}}", String(params.answerCount)) + MODE_ADDENDUM[params.mode];
}

export async function askNexaAi(params: AskParams): Promise<AskResult> {
  const anthropic = getClient();
  if (!anthropic) {
    return {
      text:
        "_NexaAi's brain isn't connected yet._\n\n**Server not configured**\nSet `ANTHROPIC_API_KEY` in the server " +
        "environment to enable real answers (see nexaai/.env.example). Until then this is a placeholder response so " +
        "the rest of the app (credits, session limits, UI) can still be exercised.",
    };
  }

  const userContent: Anthropic.MessageParam["content"] = params.imageBase64
    ? [
        { type: "image", source: { type: "base64", media_type: params.imageBase64.mediaType, data: params.imageBase64.data } },
        { type: "text", text: params.userMessage },
      ]
    : params.userMessage;

  const response = await anthropic.messages.create({
    model: params.plan.model,
    max_tokens: params.plan.maxOutputTokens,
    system: buildSystemPrompt(params),
    messages: [
      ...params.history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: userContent },
    ],
  });

  const text = response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();

  return { text };
}
