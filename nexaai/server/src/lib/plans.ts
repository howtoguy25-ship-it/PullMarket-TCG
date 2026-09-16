// Plan tier definitions: Beginner (free trial) / Pro (3x) / Max (5x).
// "Speed and strength" multipliers translate into real, measurable knobs
// against the Claude API: which model answers the question, how much
// thinking budget / max_tokens it gets, and how many messages it allows
// per rolling usage window (see USAGE_WINDOW_HOURS) — not fake labels.

export type PlanTier = "beginner" | "pro" | "max";

// Beginner runs on your own self-hosted fine-tuned Llama (see
// finetune/ and lib/selfHostedModel.ts) — it costs you GPU-hosting money
// per hour regardless of usage, so capping it to the free tier bounds your
// cost there. Pro/Max keep calling the real Anthropic API, funded by those
// users' subscription revenue, so paying users get frontier-model quality.
export type ModelProvider = "self_hosted" | "anthropic";

export interface PlanDefinition {
  tier: PlanTier;
  /** The model's own display name (e.g. "Nexa Ember") — this IS the plan name; each tier maps to exactly one model. */
  displayName: string;
  /** Short plan-tier label shown alongside displayName ("Free trial" / "Pro plan" / "Max plan"). */
  planLabel: string;
  tagline: string;
  priceCentsPerMonth: number | null; // null = not sold as a subscription (beginner is free-trial + pay-as-you-go credits)
  strengthMultiplier: number; // 1x / 3x / 5x — internal knob only (humor-tier threshold in shared/nexaPersona.ts); never shown to users directly
  /** User-facing "Xx" power number (ModeDropdown/PlansScreen) — Ember's own value is the baseline other tiers are compared against ("marketingStrength / Ember's marketingStrength" = "Nx more capable than Ember"). Deliberately decoupled from strengthMultiplier so a marketing number change never shifts real backend behavior. */
  marketingStrength: number;
  /** Longer, purchase-encouraging copy for the Plans upgrade sheet — real, specific claims (never names the underlying model/provider). */
  pitch: string;
  provider: ModelProvider;
  model: string; // Claude model id, or your self-hosted vLLM served-model-name
  maxOutputTokens: number;
  extendedThinking: boolean; // true whenever defaultThinkingBudgetTokens is set — kept as its own field since it's what client copy/UI checks
  /** Real baseline `thinking` budget (tokens) Claude gets on this tier even in Quick focus mode — null means no baseline thinking (a focus mode can still force one; see FocusModeDefinition.thinkingBudgetTokens). Pro's is deliberately lower than Max's: a real but limited amount of extended thinking, not the full budget. */
  defaultThinkingBudgetTokens: number | null;
  /** Real Claude-style rolling-window cap: this many messages per USAGE_WINDOW_HOURS, then a real 403 until it resets. */
  messagesPerWindow: number;
}

export const PLAN_DEFINITIONS: Record<PlanTier, PlanDefinition> = {
  beginner: {
    tier: "beginner",
    displayName: "Nexa Ember",
    planLabel: "Starter",
    tagline: "A small, fast spark to get started — 2 days free, then $39.99/mo or pay-as-you-go credits",
    pitch:
      "Every plan builds up from here. Ember is real, capable, and fast for everyday questions and quick tasks — " +
      "no strings, no credit card required for the free trial. When you're ready for tougher, more detailed work, " +
      "Nova and Zenith are a tap away.",
    priceCentsPerMonth: 3999,
    strengthMultiplier: 1,
    marketingStrength: 3,
    provider: "self_hosted",
    model: "nexaai-llama3-8b",
    maxOutputTokens: 1024,
    extendedThinking: false,
    defaultThinkingBudgetTokens: null,
    messagesPerWindow: 15,
  },
  pro: {
    tier: "pro",
    displayName: "Nexa Nova",
    planLabel: "Pro plan",
    tagline: "4x stronger than Ember — tougher, faster, sharper answers",
    pitch:
      "Nova is real, measurably tougher than Ember: 4x the strength, faster and quicker to think and act, with " +
      "noticeably sharper reasoning on multi-step problems. It also gets real extended thinking — a lighter, faster " +
      "version than Max's, but genuine step-by-step reasoning before it answers, not a cosmetic label. It handles " +
      "longer, more detailed work without losing the thread and keeps up with you at real speed — the upgrade most " +
      "people feel from their very first message.",
    priceCentsPerMonth: 10999,
    strengthMultiplier: 3,
    marketingStrength: 12,
    provider: "anthropic",
    model: "claude-sonnet-5",
    maxOutputTokens: 2048,
    extendedThinking: true,
    defaultThinkingBudgetTokens: 1200, // real thinking, deliberately capped below Max's baseline — a limited-but-genuine version, not the full budget
    messagesPerWindow: 45,
  },
  max: {
    tier: "max",
    displayName: "Nexa Zenith",
    planLabel: "Max plan",
    tagline: "17x stronger than Ember — the smartest, most confident version of NexaAi",
    pitch:
      "Zenith is real gorilla-build power: 17x the strength of Ember, with fast thinking and responses as quick as " +
      "the speediest assistants out there, and answers that lay out every last detail as thoroughly as the most " +
      "detail-obsessed assistants around — all wrapped in NexaAi's own clean, confident style. Real strength, real " +
      "speed, real depth. If you want the smartest, most capable version of NexaAi with nothing held back, this is it.",
    priceCentsPerMonth: 23999,
    strengthMultiplier: 5,
    marketingStrength: 51,
    provider: "anthropic",
    model: "claude-opus-5",
    maxOutputTokens: 4096,
    extendedThinking: true,
    defaultThinkingBudgetTokens: 2000,
    messagesPerWindow: 75,
  },
};

// Real Claude-style rolling window: a message cap that resets exactly this
// many hours after your first message in a fresh window — not a fixed
// daily/weekly clock. See lib/usageClock.ts.
export const USAGE_WINDOW_HOURS = 5;

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
