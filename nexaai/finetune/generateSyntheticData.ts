// Generates synthetic (user_message, assistant_response) training pairs in
// NexaAi's real answer format, for fine-tuning your own Llama model —
// see finetune/README.md for the full pipeline and the important note on
// which "teacher" model this should (and shouldn't) be.
//
// Usage:
//   tsx finetune/generateSyntheticData.ts --count=15
//   tsx finetune/generateSyntheticData.ts --count=25 --category=car_trouble
//   tsx finetune/generateSyntheticData.ts --count=10 --out=finetune/data/my-run.jsonl
//
// Output is one JSON object per line (JSONL), in OpenAI/ShareGPT chat format
// — directly usable by Axolotl's `chat_template` dataset type or trivially
// convertible for Unsloth.

import "dotenv/config";
import fs from "fs";
import path from "path";
import { TOPICS, type AnswerMode, type Topic } from "./topics";
import { generateWithTeacher, describeActiveProvider } from "./lib/teacherProvider";

const ANSWER_COUNTS: Record<AnswerMode, number> = { strong: 1, extra: 2, normal: 3 };

const NEXAAI_PERSONA = `You are NexaAi, a friendly, extremely capable AI assistant character living inside the NexaAi app. \
You help users get things done, step by step, on absolutely any topic.

Formatting rules, always follow them:
- Repeat back a short, cleaned-up version of what the user asked (as if correcting their typos) at the top, in italics using _underscores_.
- Give exactly {{ANSWER_COUNT}} distinct answer(s)/approach(es), each as its own section.
- Each answer section starts with a **bold heading** naming the approach (use **double asterisks**).
- Under each heading: a one-line description, then a numbered list of concrete steps ("1. ", "2. ", etc.), then a short "Where to start" line.
- If a relevant image would help, describe in [brackets] what image should be shown — never invent a fake URL.
- Keep tone confident and clear, never wishy-washy, but never invent facts you're not confident about — say so plainly instead.`;

const KIND_ADDENDUM: Record<Topic["kind"], string> = {
  text: "",
  who_is_lookup:
    "\n\nThe user is asking 'who is' a person. Answer only with genuinely public, well-established information. Do not fabricate details you're not confident about — say so plainly instead of guessing.",
  assistance_request:
    "\n\nThe user needs real-world assistance (e.g. a car problem). Give clear DIY troubleshooting steps AND mention that finding the closest specific business is handled by the app's own lookup feature, not by inventing a name/address.",
  camera_ask:
    "\n\nThe user has attached a photo and described its contents in [brackets] as part of their message — answer as if you'd seen that photo.",
};

function buildSystemPrompt(topic: Topic, answerMode: AnswerMode): string {
  return NEXAAI_PERSONA.replace("{{ANSWER_COUNT}}", String(ANSWER_COUNTS[answerMode])) + KIND_ADDENDUM[topic.kind];
}

function weightedPick(weights: Record<AnswerMode, number>): AnswerMode {
  const entries = Object.entries(weights) as [AnswerMode, number][];
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let r = Math.random() * total;
  for (const [mode, w] of entries) {
    if (r < w) return mode;
    r -= w;
  }
  return entries[0][0];
}

function parseArgs() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
      const [key, value] = arg.replace(/^--/, "").split("=");
      return [key, value ?? "true"];
    }),
  );
  return {
    count: Number(args.count ?? 15),
    category: args.category as string | undefined,
    out: (args.out as string) ?? `finetune/data/synthetic-${Date.now()}.jsonl`,
    delayMs: Number(args["delay-ms"] ?? 350),
  };
}

function extractJson(raw: string): { user_message: string; assistant_response: string } | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    if (typeof parsed.user_message === "string" && typeof parsed.assistant_response === "string") return parsed;
    return null;
  } catch {
    return null;
  }
}

const GENERATION_INSTRUCTIONS = (topic: Topic, seeds: string[], answerMode: AnswerMode) => `\
You are helping build a fine-tuning dataset for an AI app called NexaAi.

Task category: ${topic.category} — ${topic.description}

Here are some real example user messages in this category (for inspiration only — invent a NEW one, don't copy these):
${seeds.map((s) => `- "${s}"`).join("\n")}

Do two things:
1. Invent ONE new, realistic user message in this category — different phrasing/scenario from the examples above.
2. Write NexaAi's ideal reply to that message, following the persona/formatting rules in the system prompt exactly (${ANSWER_COUNTS[answerMode]} answer section(s)).

Reply with ONLY a JSON object, no other text, no markdown code fences:
{"user_message": "...", "assistant_response": "..."}`;

async function main() {
  const { count, category, out, delayMs } = parseArgs();
  const topics = category ? TOPICS.filter((t) => t.category === category) : TOPICS;
  if (topics.length === 0) {
    console.error(`No topic matches category "${category}". Known categories: ${TOPICS.map((t) => t.category).join(", ")}`);
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  console.log(`Teacher provider: ${describeActiveProvider()}`);
  console.log(`Generating ${count} examples per topic across ${topics.length} topic(s) -> ${out}\n`);

  let written = 0;
  let failed = 0;

  for (const topic of topics) {
    for (let i = 0; i < count; i++) {
      const answerMode = weightedPick(topic.answerModeWeights);
      const systemPrompt = buildSystemPrompt(topic, answerMode);
      const seeds = topic.seedPrompts.slice(0, 5);

      let parsed: { user_message: string; assistant_response: string } | null = null;
      for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
        try {
          const raw = await generateWithTeacher(systemPrompt, GENERATION_INSTRUCTIONS(topic, seeds, answerMode), { temperature: 1.05 });
          parsed = extractJson(raw);
        } catch (err) {
          console.warn(`  [${topic.category}] attempt ${attempt + 1} failed: ${err instanceof Error ? err.message : err}`);
        }
      }

      if (!parsed) {
        failed++;
        console.warn(`  [${topic.category}] ${i + 1}/${count} — skipped (couldn't parse a valid example)`);
        continue;
      }

      const record = {
        category: topic.category,
        kind: topic.kind,
        answerMode,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: parsed.user_message },
          { role: "assistant", content: parsed.assistant_response },
        ],
      };
      fs.appendFileSync(out, JSON.stringify(record) + "\n");
      written++;
      console.log(`  [${topic.category}] ${i + 1}/${count} — "${parsed.user_message.slice(0, 60)}..."`);

      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  console.log(`\nDone. Wrote ${written} examples (${failed} skipped) to ${out}`);
  console.log(`Next: tsx finetune/validateDataset.ts ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
