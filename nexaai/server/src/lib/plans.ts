// Plan tier definitions: Beginner (free trial) / Pro (3x) / Max (5x).
// "Speed and strength" multipliers translate into two real, measurable
// knobs against the Claude API: which model tier answers the question, and
// how much thinking budget / max_tokens it gets — not a fake "x3" label.

export type PlanTier = "beginner" | "pro" | "max";

// Beginner runs on your own self-hosted fine-tuned Llama (see
// finetune/ and lib/selfHostedModel.ts) — it costs you GPU-hosting money
// per hour regardless of usage, so capping it to the free tier bounds your
// cost there. Pro/Max keep calling the real Anthropic API, funded by those
// users' subscription revenue, so paying users get frontier-model quality.
export type ModelProvider = "self_hosted" | "anthropic";

export interface PlanDefinition {
  tier: PlanTier;
  displayName: string;
  tagline: string;
  priceCentsPerMonth: number | null; // null = not sold as a subscription (beginner is free-trial + pay-as-you-go credits)
  strengthMultiplier: number; // 1x / 3x / 5x per the product spec
  provider: ModelProvider;
  model: string; // Claude model id, or your self-hosted vLLM served-model-name
  maxOutputTokens: number;
  extendedThinking: boolean; // only meaningful for provider: "anthropic" — self-hosted Llama has no equivalent API param
  weeklySessionSecondsCap: number; // "12-15 session minutes a week"
  dailySessionCountCap: number; // "3-4 uses of session limit every day"
  colors: { primary: string; secondary: string; glow: string };
}

export const PLAN_DEFINITIONS: Record<PlanTier, PlanDefinition> = {
  beginner: {
    tier: "beginner",
    displayName: "Beginner",
    tagline: "2 days free, full access — then pay-as-you-go credits",
    priceCentsPerMonth: null,
    strengthMultiplier: 1,
    provider: "self_hosted",
    model: "nexaai-llama3-8b",
    maxOutputTokens: 1024,
    extendedThinking: false,
    weeklySessionSecondsCap: 12 * 60,
    dailySessionCountCap: 3,
    colors: { primary: "#6C7BFF", secondary: "#3B3F72", glow: "#8F9BFF" },
  },
  pro: {
    tier: "pro",
    displayName: "Pro",
    tagline: "3x faster, sharper answers",
    priceCentsPerMonth: 2999,
    strengthMultiplier: 3,
    provider: "anthropic",
    model: "claude-sonnet-5",
    maxOutputTokens: 2048,
    extendedThinking: false,
    weeklySessionSecondsCap: 14 * 60,
    dailySessionCountCap: 4,
    colors: { primary: "#B06CFF", secondary: "#4B2E7A", glow: "#D9A8FF" },
  },
  max: {
    tier: "max",
    displayName: "Max",
    tagline: "5x stronger — the smartest, most confident version of NexaAi",
    priceCentsPerMonth: 7999,
    strengthMultiplier: 5,
    provider: "anthropic",
    model: "claude-opus-5",
    maxOutputTokens: 4096,
    extendedThinking: true,
    weeklySessionSecondsCap: 15 * 60,
    dailySessionCountCap: 4,
    colors: { primary: "#FFB347", secondary: "#7A4A1E", glow: "#FFD79A" },
  },
};

// Answer-mode toggle: how many answers NexaAi returns per question.
export type AnswerMode = "strong" | "extra" | "normal";

export interface AnswerModeDefinition {
  mode: AnswerMode;
  answerCount: number;
  label: string;
  description: string;
}

export const ANSWER_MODE_DEFINITIONS: Record<AnswerMode, AnswerModeDefinition> = {
  strong: {
    mode: "strong",
    answerCount: 1,
    label: "Strong answer",
    description: "One straight-to-the-point, confident answer.",
  },
  extra: {
    mode: "extra",
    answerCount: 2,
    label: "Extra info",
    description: "Two answers — the direct one, plus more context to help you understand.",
  },
  normal: {
    mode: "normal",
    answerCount: 3,
    label: "Normal (3 answers)",
    description: "Three answers so you can compare approaches.",
  },
};

export function resolveAnswerCount(mode: AnswerMode, explicitlyRequestedCount?: number): number {
  // "If they ask for certain amount then automatically approve" — a user
  // typing "give me 5 answers" overrides their saved toggle for that message.
  if (explicitlyRequestedCount && explicitlyRequestedCount > 0 && explicitlyRequestedCount <= 6) {
    return explicitlyRequestedCount;
  }
  return ANSWER_MODE_DEFINITIONS[mode].answerCount;
}

// ---------------------------------------------------------------------------
// Focus/power modes — a second axis on top of the plan tier. The plan tier
// says which Claude model answers you; the focus mode says how hard it
// tries on THIS message, using Claude's real extended-thinking parameter
// (not a cosmetic label) and a real credit-cost multiplier.
// ---------------------------------------------------------------------------

export type FocusMode = "quick" | "build" | "auto" | "gorilla";

export interface FocusModeDefinition {
  mode: FocusMode;
  label: string;
  tagline: string;
  minPlanTier: PlanTier; // gates access — see isFocusModeAllowed
  creditMultiplier: number; // multiplies the base per-message credit cost
  thinkingBudgetTokens: number | null; // forces Claude's real extended-thinking budget on; null defers to the plan's own setting
  promptAddendum: string;
}

const PLAN_TIER_RANK: Record<PlanTier, number> = { beginner: 0, pro: 1, max: 2 };

export function isFocusModeAllowed(tier: PlanTier, mode: FocusMode): boolean {
  return PLAN_TIER_RANK[tier] >= PLAN_TIER_RANK[FOCUS_MODE_DEFINITIONS[mode].minPlanTier];
}

export const FOCUS_MODE_DEFINITIONS: Record<FocusMode, FocusModeDefinition> = {
  quick: {
    mode: "quick",
    label: "Quick",
    tagline: "Fast everyday edits & tasks",
    minPlanTier: "beginner",
    creditMultiplier: 1,
    thinkingBudgetTokens: null,
    promptAddendum:
      "\n\nFocus mode: QUICK. Be fast and to the point — this is an everyday edit or small task, not a project. " +
      "Skip long preambles and give the direct fix/answer first.",
  },
  build: {
    mode: "build",
    label: "Build",
    tagline: "Complex, multi-step builds",
    minPlanTier: "beginner",
    creditMultiplier: 1.5,
    thinkingBudgetTokens: 4000,
    promptAddendum:
      "\n\nFocus mode: BUILD. This is a complex or multi-step build/task. Think through the architecture or sequence " +
      "of steps carefully before answering, and structure the answer as a clear plan the user could actually execute.",
  },
  auto: {
    mode: "auto",
    label: "Auto",
    tagline: "Autonomous tasks & builds",
    minPlanTier: "pro",
    creditMultiplier: 2.5,
    thinkingBudgetTokens: 8000,
    promptAddendum:
      "\n\nFocus mode: AUTO. Act autonomously within this one reply: don't stop to ask clarifying questions unless " +
      "truly blocked — make the most reasonable assumptions explicit and deliver a COMPLETE result (full code, full " +
      "steps, nothing left as 'exercise for the user') in this single turn. Note plainly, once, that this simulates " +
      "autonomy through careful single-turn planning — it is not a sandboxed multi-step execution loop that can " +
      "actually run code or click through steps on its own.",
  },
  gorilla: {
    mode: "gorilla",
    label: "Gorilla",
    tagline: "Maximum power — more credits",
    minPlanTier: "max",
    creditMultiplier: 4,
    thinkingBudgetTokens: 16000,
    promptAddendum:
      "\n\nFocus mode: GORILLA — maximum effort. Give this everything: the deepest, most thorough, most confident " +
      "version of your answer, with the extra insight and polish someone wouldn't expect. Don't hedge or pad — every " +
      "sentence should earn its place.",
  },
};

export const CREDIT_PACKS = [
  { label: "$35", priceCents: 3500, bonusCents: 0 },
  { label: "$80", priceCents: 8000, bonusCents: 500 },
  { label: "$115", priceCents: 11500, bonusCents: 1500 },
  { label: "$175", priceCents: 17500, bonusCents: 3000 },
] as const;

export const GRACE_OVERAGE_CENTS = 100; // "use up to $1 more then immediately pause"
