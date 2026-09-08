// Single call site chat.ts uses instead of calling askNexaAi/streamNexaAi
// directly — decides which model actually answers based on the resolved
// plan's provider (see lib/plans.ts), and handles the two real edge cases
// that come with a hybrid self-hosted/Anthropic setup:
//   - Beginner tier's self-hosted endpoint isn't deployed yet -> fall back
//     to Anthropic so the app doesn't just break for free-tier users while
//     you're still training/deploying your own model.
//   - Beginner tier + an image attachment -> the self-hosted Llama is
//     text-only, so the image is dropped with an honest note instead of
//     silently ignoring it or escalating to a paid Claude call.

import { askNexaAi, streamNexaAi, type AskParams, type AskResult } from "./anthropic";
import { askSelfHostedModel, streamSelfHostedModel, isSelfHostedConfigured } from "./selfHostedModel";
import type { PlanDefinition } from "./plans";

export const FALLBACK_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";

function anthropicFallbackPlan(plan: PlanDefinition): PlanDefinition {
  return { ...plan, provider: "anthropic", model: FALLBACK_ANTHROPIC_MODEL };
}

function stripImageForTextOnlyModel(params: AskParams): AskParams {
  if (!params.imageBase64 && !params.extraImages?.length) return params;
  const attachmentWord = params.extraImages?.length ? "video" : "image";
  return {
    ...params,
    imageBase64: undefined,
    extraImages: undefined,
    userMessage:
      params.userMessage +
      `\n\n[The user attached a${attachmentWord === "image" ? "n" : ""} ${attachmentWord}, but this tier's self-hosted model is text-only and can't view it — answer ` +
      "based on what they describe in words, and mention plainly that real vision analysis needs the Pro or Max plan.]",
  };
}

export async function askModel(params: AskParams): Promise<AskResult> {
  if (params.plan.provider === "self_hosted") {
    if (!isSelfHostedConfigured()) return askNexaAi({ ...params, plan: anthropicFallbackPlan(params.plan) });
    return askSelfHostedModel(stripImageForTextOnlyModel(params));
  }
  return askNexaAi(params);
}

export async function streamModel(params: AskParams, onDelta: (deltaText: string) => void): Promise<AskResult> {
  if (params.plan.provider === "self_hosted") {
    if (!isSelfHostedConfigured()) return streamNexaAi({ ...params, plan: anthropicFallbackPlan(params.plan) }, onDelta);
    return streamSelfHostedModel(stripImageForTextOnlyModel(params), onDelta);
  }
  return streamNexaAi(params, onDelta);
}
