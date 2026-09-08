// A pluggable "teacher" model used only to generate synthetic training
// examples for fine-tuning your own Llama model — it never runs inside the
// app itself.
//
// WHY THIS DEFAULTS TO AN OPEN-WEIGHT MODEL, NOT CLAUDE/GPT: both
// Anthropic's and OpenAI's commercial terms of service restrict using their
// models' outputs to train a competing model. Since the whole point of this
// pipeline is training a Llama model to replace a commercial API inside
// NexaAi, generating that training data via Claude/GPT sits in exactly what
// those terms prohibit. Together.ai and Fireworks host large open-weight
// models (no such restriction on their outputs) and expose an
// OpenAI-compatible endpoint, so this defaults to one of those.
//
// The "anthropic" provider below exists for convenience if you explicitly
// want it for something else (e.g. a quick one-off local experiment) — but
// don't use it to build a real training set for the model that's going to
// replace Claude in your app. That's the one thing this file is written to
// steer you away from by default.

export type TeacherProvider = "together" | "fireworks" | "anthropic";

const PROVIDER = (process.env.TEACHER_PROVIDER as TeacherProvider) || "together";

const PROVIDER_DEFAULTS: Record<Exclude<TeacherProvider, "anthropic">, { baseUrl: string; model: string; apiKeyEnv: string }> = {
  together: {
    baseUrl: "https://api.together.xyz/v1",
    model: "meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo",
    apiKeyEnv: "TOGETHER_API_KEY",
  },
  fireworks: {
    baseUrl: "https://api.fireworks.ai/inference/v1",
    model: "accounts/fireworks/models/llama-v3p1-405b-instruct",
    apiKeyEnv: "FIREWORKS_API_KEY",
  },
};

export interface GenerateOptions {
  temperature?: number;
  maxTokens?: number;
}

async function generateOpenAiCompatible(provider: "together" | "fireworks", systemPrompt: string, userPrompt: string, opts: GenerateOptions): Promise<string> {
  const defaults = PROVIDER_DEFAULTS[provider];
  const apiKey = process.env.TEACHER_API_KEY || process.env[defaults.apiKeyEnv];
  if (!apiKey) {
    throw new Error(`Set ${defaults.apiKeyEnv} (or TEACHER_API_KEY) — sign up at ${provider === "together" ? "together.ai" : "fireworks.ai"} to get one.`);
  }
  const baseUrl = process.env.TEACHER_API_BASE_URL || defaults.baseUrl;
  const model = process.env.TEACHER_MODEL || defaults.model;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: opts.temperature ?? 1.0,
      max_tokens: opts.maxTokens ?? 1200,
    }),
  });
  if (!response.ok) throw new Error(`Teacher (${provider}) request failed: ${response.status} ${await response.text()}`);
  const json = (await response.json()) as { choices: { message: { content: string } }[] };
  return json.choices[0].message.content;
}

async function generateAnthropic(systemPrompt: string, userPrompt: string, opts: GenerateOptions): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Set ANTHROPIC_API_KEY to use the anthropic teacher provider.");
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await anthropic.messages.create({
    model: process.env.TEACHER_MODEL || "claude-haiku-4-5-20251001",
    max_tokens: opts.maxTokens ?? 1200,
    temperature: opts.temperature ?? 1.0,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });
  return response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

export async function generateWithTeacher(systemPrompt: string, userPrompt: string, opts: GenerateOptions = {}): Promise<string> {
  if (PROVIDER === "anthropic") return generateAnthropic(systemPrompt, userPrompt, opts);
  return generateOpenAiCompatible(PROVIDER, systemPrompt, userPrompt, opts);
}

export function describeActiveProvider(): string {
  if (PROVIDER === "anthropic") return "anthropic (⚠️ see teacherProvider.ts header — do not use this to build a real training set)";
  const defaults = PROVIDER_DEFAULTS[PROVIDER];
  return `${PROVIDER} (${process.env.TEACHER_MODEL || defaults.model})`;
}
