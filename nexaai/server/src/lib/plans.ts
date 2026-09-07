// Plan tier definitions: Beginner (free trial) / Pro (3x) / Max (5x).
// "Speed and strength" multipliers translate into two real, measurable
// knobs against the Claude API: which model tier answers the question, and
// how much thinking budget / max_tokens it gets — not a fake "x3" label.

export type PlanTier = "beginner" | "pro" | "max";

export interface PlanDefinition {
  tier: PlanTier;
  displayName: string;
  tagline: string;
  priceCentsPerMonth: number | null; // null = not sold as a subscription (beginner is free-trial + pay-as-you-go credits)
  strengthMultiplier: number; // 1x / 3x / 5x per the product spec
  model: string; // Claude model id used for this tier
  maxOutputTokens: number;
  extendedThinking: boolean;
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
    model: "claude-haiku-4-5-20251001",
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

export const CREDIT_PACKS = [
  { label: "$35", priceCents: 3500, bonusCents: 0 },
  { label: "$80", priceCents: 8000, bonusCents: 500 },
  { label: "$115", priceCents: 11500, bonusCents: 1500 },
  { label: "$175", priceCents: 17500, bonusCents: 3000 },
] as const;

export const GRACE_OVERAGE_CENTS = 100; // "use up to $1 more then immediately pause"
