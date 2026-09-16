// Real, cost-aware credit pricing. Every credit charge below is computed
// from an actual real-world per-unit rate for the exact API call being
// made — not a flat guess — then marked up, so a message costs the user
// meaningfully more than it costs NexaAi in real third-party API fees.
//
// This prices off a REALISTIC expected output length per focus mode, not
// the technical max_tokens safety ceiling (resolveMaxTokens in
// anthropic.ts) — Claude almost never fills that ceiling on an ordinary
// reply; it exists to prevent truncation, not to describe typical length.
// Pricing every message for the absolute worst case would make a single
// Gorilla-mode reply cost several real dollars, which is real sticker
// shock, not real safety. The actual worst-case tail risk (a reply that
// runs unusually long) is instead bounded the existing way: lib/credits.ts's
// GRACE_OVERAGE_CENTS caps how far any single user's balance can go
// negative before their session pauses — a small, real, already-enforced
// ceiling on how wrong a single estimate can go.
//
// IMPORTANT — update these once you have real invoiced numbers: "Sonnet 5"/
// "Opus 5" don't have public pricing yet, so the *PerMTokCents constants
// below use the closest real, currently-published Anthropic per-model-tier
// pricing as a stand-in (Sonnet-class and Opus-class rates). Check
// console.anthropic.com's actual billing page for your account and replace
// these the moment real numbers are available — everything below is a
// single source of truth, so one edit here re-prices every message.
//
// All amounts are in USD CENTS per 1,000,000 tokens (or per unit noted).

export const COST_RATES = {
  anthropicSonnet: { inputPerMTokCents: 300, outputPerMTokCents: 1500 }, // $3 / $15 per M
  anthropicOpus: { inputPerMTokCents: 1500, outputPerMTokCents: 7500 }, // $15 / $75 per M
  anthropicHaiku: { inputPerMTokCents: 80, outputPerMTokCents: 400 }, // $0.80 / $4 per M — beginner tier's Anthropic fallback
  openaiWhisperPerMinuteCents: 0.6, // $0.006/min
  openaiTtsPerMCharsCents: 1500, // $15 / 1M characters (tts-1 standard)
  geminiFlash: { inputPerMTokCents: 7.5, outputPerMTokCents: 30 }, // $0.075 / $0.30 per M
  // Beginner tier runs your own already-provisioned GPU — the marginal cost
  // of one more request on hardware that's billed by the hour regardless of
  // traffic is small but non-zero (a few seconds of compute time). This
  // does NOT include the fixed hourly GPU rental itself — that's a flat
  // monthly infra cost this per-message number can't and shouldn't try to
  // absorb; it has to be covered by overall Pro/Max margin and credit-pack
  // volume instead. See README "Real pricing & unit economics".
  selfHostedMarginalCents: 0.3,
} as const;

// A realistic conversation's worth of system prompt + memory context +
// recent history — most turns are shorter than this; longer-running
// sessions with lots of memory recall are the ones that approach it.
const CHAT_INPUT_TOKENS_ESTIMATE = 2500;

// Realistic (not max_tokens-ceiling) expected output length per focus
// mode, as a fraction of that mode's real technical ceiling — see the
// file header for why pricing off the hard ceiling itself is the wrong
// call. Focus modes that request a bigger thinking budget do genuinely
// tend to produce longer real answers, so the fraction scales with them,
// but always well under the safety ceiling itself.
const REALISTIC_OUTPUT_FRACTION_OF_CEILING = 0.22;

// Applied on top of the realistic raw API cost above. Sized to comfortably
// survive Apple's in-app-purchase cut (up to 30% off the credit pack's
// sticker price a purchase actually funds these credits from — see
// README's "Real pricing & unit economics") while still leaving real
// profit after that cut, plus headroom for the gap between "realistic"
// and a longer-than-usual real reply.
const MARGIN_MULTIPLIER = 2.5;

function centsFromTokens(tokens: number, ratePerMTokCents: number): number {
  return (tokens / 1_000_000) * ratePerMTokCents;
}

// Claude's real image tokenization is roughly (width × height) / 750 —
// this approximates a moderate-resolution JPEG (a camera photo or a
// video-frame still), intentionally on the higher side so this floor
// doesn't undercharge a genuinely large attached photo.
const IMAGE_INPUT_TOKENS_ESTIMATE = 1200;

interface ChatCostInput {
  planProvider: "self_hosted" | "anthropic";
  /** Real Claude model id actually used (params.plan.model), or the self-hosted served-model-name. */
  model: string;
  /** resolveMaxTokens(...)'s real technical ceiling for this exact turn — scaled down to a realistic estimate internally, not billed at face value. */
  maxOutputTokens: number;
  kindMultiplier: number; // e.g. WHO_IS_DEEP_DIVE_MULTIPLIER for multi-call lookups
  /** Real vision images attached to the main answer call (a camera-ask photo, or sampled video-frame stills) — each one is real extra input-token cost the flat CHAT_INPUT_TOKENS_ESTIMATE doesn't cover. */
  imageCount?: number;
  /** Extra real per-frame Haiku vision calls for the live video frame-by-frame breakdown (lib/anthropic.ts's describeVideoFrame) — a genuinely separate real API call per frame, on top of the main answer call above. */
  videoFrameDescriptionCount?: number;
}

function modelRate(model: string): { inputPerMTokCents: number; outputPerMTokCents: number } {
  if (model.includes("opus")) return COST_RATES.anthropicOpus;
  if (model.includes("sonnet")) return COST_RATES.anthropicSonnet;
  if (model.includes("haiku")) return COST_RATES.anthropicHaiku;
  return COST_RATES.anthropicSonnet; // unknown Anthropic model id — assume the pricier-of-common-tiers rather than underprice
}

/** Realistic-usage, margin-applied credit cost (in cents) for one chat/voice-text turn. Always rounds up — never in the app's favor to lose a fraction of a cent. */
export function estimateChatCreditCostCents(input: ChatCostInput): number {
  const realisticOutputTokens = input.maxOutputTokens * REALISTIC_OUTPUT_FRACTION_OF_CEILING;
  const imageInputCents =
    input.planProvider === "anthropic" && input.imageCount
      ? centsFromTokens(IMAGE_INPUT_TOKENS_ESTIMATE * input.imageCount, modelRate(input.model).inputPerMTokCents)
      : 0;
  const rawCents =
    input.planProvider === "self_hosted"
      ? COST_RATES.selfHostedMarginalCents
      : centsFromTokens(CHAT_INPUT_TOKENS_ESTIMATE, modelRate(input.model).inputPerMTokCents) +
        centsFromTokens(realisticOutputTokens, modelRate(input.model).outputPerMTokCents) +
        imageInputCents;
  const frameDescriptionCents = input.videoFrameDescriptionCount
    ? input.videoFrameDescriptionCount *
      (centsFromTokens(IMAGE_INPUT_TOKENS_ESTIMATE, COST_RATES.anthropicHaiku.inputPerMTokCents) +
        centsFromTokens(60, COST_RATES.anthropicHaiku.outputPerMTokCents)) // ~60 realistic output tokens per short per-frame description
    : 0;
  return Math.ceil((rawCents * input.kindMultiplier + frameDescriptionCents) * MARGIN_MULTIPLIER);
}

interface VoiceTurnCostInput {
  /** Which model actually answered the reasoning step — Gemini's speed lane when configured, otherwise the user's own plan model (see routes/voice.ts). */
  reasoningProvider: "gemini" | "anthropic" | "self_hosted";
  reasoningModel?: string; // only used when reasoningProvider === "anthropic"
}

// A realistic single voice turn: a short memo, a conversational spoken
// reply, and its synthesis — voice replies are deliberately terse (see
// the voice system prompt), so these are much smaller than a text chat's.
const VOICE_AUDIO_SECONDS_ESTIMATE = 25;
const VOICE_REPLY_OUTPUT_TOKENS_ESTIMATE = 150;
const VOICE_REPLY_CHARS_ESTIMATE = 220;

/** Realistic-usage, margin-applied credit cost (in cents) for one voice turn (STT + reasoning + TTS). */
export function estimateVoiceTurnCreditCostCents(input: VoiceTurnCostInput): number {
  const sttCents = (VOICE_AUDIO_SECONDS_ESTIMATE / 60) * COST_RATES.openaiWhisperPerMinuteCents;
  const ttsCents = centsFromTokens(VOICE_REPLY_CHARS_ESTIMATE, COST_RATES.openaiTtsPerMCharsCents);
  const reasoningCents =
    input.reasoningProvider === "self_hosted"
      ? COST_RATES.selfHostedMarginalCents
      : input.reasoningProvider === "gemini"
        ? centsFromTokens(CHAT_INPUT_TOKENS_ESTIMATE, COST_RATES.geminiFlash.inputPerMTokCents) +
          centsFromTokens(VOICE_REPLY_OUTPUT_TOKENS_ESTIMATE, COST_RATES.geminiFlash.outputPerMTokCents)
        : centsFromTokens(CHAT_INPUT_TOKENS_ESTIMATE, modelRate(input.reasoningModel ?? "").inputPerMTokCents) +
          centsFromTokens(VOICE_REPLY_OUTPUT_TOKENS_ESTIMATE, modelRate(input.reasoningModel ?? "").outputPerMTokCents);
  return Math.ceil((sttCents + ttsCents + reasoningCents) * MARGIN_MULTIPLIER);
}

export type ImageQuality = "low" | "medium" | "high";

// Real measured usage against this account's actual OpenAI API key
// (gpt-image-2, /v1/images/generations) — each quality tier's real
// output_tokens from the API's own usage object, not a guess.
const IMAGE_GEN_INPUT_TOKENS_ESTIMATE = 14;
const IMAGE_GEN_OUTPUT_TOKENS_BY_QUALITY: Record<ImageQuality, number> = {
  low: 196,
  medium: 1756,
  high: 7024,
};
const IMAGE_GEN_INPUT_RATE_CENTS = 500; // $5 / 1M tokens
const IMAGE_GEN_OUTPUT_RATE_CENTS = 3000; // $30 / 1M tokens

/** Realistic-usage, margin-applied credit cost (in cents) for one generated image. */
export function estimateImageGenerationCreditCostCents(quality: ImageQuality): number {
  const rawCents =
    centsFromTokens(IMAGE_GEN_INPUT_TOKENS_ESTIMATE, IMAGE_GEN_INPUT_RATE_CENTS) +
    centsFromTokens(IMAGE_GEN_OUTPUT_TOKENS_BY_QUALITY[quality], IMAGE_GEN_OUTPUT_RATE_CENTS);
  return Math.ceil(rawCents * MARGIN_MULTIPLIER);
}
