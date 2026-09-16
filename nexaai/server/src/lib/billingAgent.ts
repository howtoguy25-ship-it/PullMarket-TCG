// A real, tool-using extension of the Billing & Credits support agent
// (see routes/support.ts, supportPersonas.ts). The plain support agents
// (technical/account/general, and billing's own general Q&A) are a single
// text completion with no way to touch the database — this one gets two
// real tools so it can actually investigate a "my credits are missing /
// randomly drained / I paid but nothing showed up" complaint against the
// user's REAL transaction history and, only when that real data genuinely
// backs it up, issue a real refund itself — inside the same chat, no
// separate "report an issue" step required.
//
// Every refund this can ever issue is bounded by a real row that already
// exists: it reads `amountCents` off an actual `nexaai_credit_transactions`
// row the model itself just looked up, never a number the model invents.
// Every refund is also recorded into `nexaai_credit_disputes` — the exact
// same table the per-message "report an issue" flow (lib/creditDisputes.ts)
// and the Owner panel's dispute list already use — so there's one single,
// permanent, owner-visible audit trail for every credit-back this app ever
// issues, regardless of which path triggered it.
import Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq } from "drizzle-orm";
import { creditDisputes, creditTransactions } from "@shared/schema";
import { db } from "../db";
import { grantCredits } from "./credits";
import { SUPPORT_AGENTS } from "./supportPersonas";
import { REALISTIC_MAX_CHARGE_CENTS } from "./creditDisputes";

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

const MODEL = "claude-haiku-4-5-20251001"; // same cheap/fast model every other support-desk call in this app uses
const MAX_TOOL_ITERATIONS = 4;
const HISTORY_WINDOW_DAYS = 60;

const TOOLS: Anthropic.Tool[] = [
  {
    name: "get_credit_history",
    description:
      "Pulls this exact user's REAL credit transaction history from the last 60 days — every charge, purchase, refund, and grant, with real amounts, dates, and a real 'kind'. Also returns real computed anomaly flags (overcharges past the app's documented cost ceiling, and duplicate charges for the same message). Always call this BEFORE saying anything definite about a billing issue, and before ever considering a refund — never guess or take the user's word for what their history shows.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "issue_credit_refund",
    description:
      "Refunds the EXACT real amount of one specific past 'usage' charge, identified by its real transactionId (from get_credit_history's output — never invent an id or an amount). Only call this when the real data you already pulled genuinely shows a billing error matching the user's complaint (a real overcharge past the cost ceiling, a real duplicate charge, or a charge with no corresponding real activity). Never call this just because the user is unhappy or insistent, and never call it twice for the same transactionId.",
    input_schema: {
      type: "object",
      properties: {
        transactionId: { type: "string", description: "The real credit_transactions.id from get_credit_history's output." },
        reasonForUser: { type: "string", description: "One plain-language sentence explaining the real error found, for the user to read." },
      },
      required: ["transactionId", "reasonForUser"],
    },
  },
];

const TOOL_USE_ADDENDUM = `

You also have two real tools for investigating billing complaints (credits missing, randomly drained, lost, or a payment that seemingly didn't go through): get_credit_history and issue_credit_refund. When a user describes anything like that, ALWAYS call get_credit_history first — never speculate about what their history shows without actually looking. Only call issue_credit_refund when the real data it returns genuinely supports a billing error; if the history looks normal (real usage matching real activity, nothing past the cost ceiling, no duplicates), say so honestly and explain that nothing anomalous was found — do not refund just to make the user happy. When you do refund, tell the user plainly what you found and how much was credited back.`;

interface HistoryTxn {
  id: string;
  kind: string;
  amountCents: number;
  packLabel: string | null;
  paymentProvider: string | null;
  note: string | null;
  messageId: string | null;
  createdAt: string;
}

async function getCreditHistoryTool(userId: string): Promise<string> {
  const since = new Date(Date.now() - HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(creditTransactions)
    .where(eq(creditTransactions.userId, userId))
    .orderBy(desc(creditTransactions.createdAt))
    .limit(200);

  const recent = rows.filter((r) => r.createdAt >= since);
  const transactions: HistoryTxn[] = recent.map((r) => ({
    id: r.id,
    kind: r.kind,
    amountCents: r.amountCents,
    packLabel: r.packLabel,
    paymentProvider: r.paymentProvider,
    note: r.note,
    messageId: r.messageId,
    createdAt: r.createdAt.toISOString(),
  }));

  // Real, deterministic anomaly detection — the same overcharge ceiling
  // lib/creditDisputes.ts's own automatic reviewer uses, plus a real
  // duplicate-charge check (two "usage" rows charged against the exact
  // same message — a genuine double-charge bug, not a matter of opinion).
  const overcharges = recent.filter((r) => r.kind === "usage" && Math.abs(r.amountCents) > REALISTIC_MAX_CHARGE_CENTS);
  const seenMessageIds = new Map<string, string>();
  const duplicates: { firstId: string; duplicateId: string; messageId: string }[] = [];
  for (const r of [...recent].reverse()) {
    if (r.kind !== "usage" || !r.messageId) continue;
    const prior = seenMessageIds.get(r.messageId);
    if (prior) duplicates.push({ firstId: prior, duplicateId: r.id, messageId: r.messageId });
    else seenMessageIds.set(r.messageId, r.id);
  }

  // Already-disputed transactions — so the model doesn't re-flag something
  // a human or the automatic reviewer already ruled on.
  const alreadyDisputed = await db.select({ creditTransactionId: creditDisputes.creditTransactionId, status: creditDisputes.status }).from(creditDisputes).where(eq(creditDisputes.userId, userId));

  return JSON.stringify({
    transactionCount: transactions.length,
    transactions,
    realAnomaliesFound: {
      overchargesPastCostCeiling: overcharges.map((r) => ({ id: r.id, amountCents: r.amountCents, costCeilingCents: REALISTIC_MAX_CHARGE_CENTS })),
      duplicateChargesForSameMessage: duplicates,
    },
    alreadyDisputed,
  });
}

async function issueCreditRefundTool(userId: string, input: { transactionId?: unknown; reasonForUser?: unknown }, userDescription: string): Promise<string> {
  const transactionId = typeof input.transactionId === "string" ? input.transactionId : "";
  const reasonForUser = typeof input.reasonForUser === "string" ? input.reasonForUser.slice(0, 300) : "A real billing error was found in your account history.";
  if (!transactionId) return JSON.stringify({ ok: false, error: "transactionId is required." });

  const [transaction] = await db.select().from(creditTransactions).where(and(eq(creditTransactions.id, transactionId), eq(creditTransactions.userId, userId)));
  if (!transaction) return JSON.stringify({ ok: false, error: "No such transaction on this user's own account — refused." });
  if (transaction.kind !== "usage") return JSON.stringify({ ok: false, error: `Only real 'usage' charges can be refunded this way, not a '${transaction.kind}' row.` });

  const [existingApproved] = await db
    .select()
    .from(creditDisputes)
    .where(and(eq(creditDisputes.creditTransactionId, transactionId), eq(creditDisputes.status, "approved")));
  if (existingApproved) return JSON.stringify({ ok: false, error: "This exact charge has already been refunded once — refused to double-refund." });

  const refundedCents = Math.abs(transaction.amountCents);
  // grantCredits' own providerReference dedup is the real, final safety net
  // against a double refund even if the check above raced with something else.
  await grantCredits(db, userId, refundedCents, {
    kind: "refund",
    providerReference: `billing-agent-refund:${transaction.id}`,
    note: `Billing support agent — ${reasonForUser.slice(0, 200)}`,
  });
  await db.insert(creditDisputes).values({
    userId,
    creditTransactionId: transaction.id,
    description: userDescription.slice(0, 1000),
    status: "approved",
    reasoning: `[via Help & Support billing agent] ${reasonForUser}`,
    refundedCents,
  });

  return JSON.stringify({ ok: true, refundedCents, message: `Refunded $${(refundedCents / 100).toFixed(2)}.` });
}

function joinText(content: Anthropic.ContentBlock[]): string {
  return content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

/**
 * Real tool-using support turn for the Billing & Credits agent — pulled out
 * of the plain askSupportAgent path (lib/anthropic.ts) since it's the only
 * support agent that ever needs to touch real account data or move real
 * credits. `latestUserText` is only used to label a refund's dispute record
 * with what the user actually asked about.
 */
export async function runBillingAgentTurn(userId: string, history: Array<{ role: "user" | "assistant"; content: string }>, latestUserText: string): Promise<string> {
  const anthropic = getClient();
  if (!anthropic) return "Billing review isn't available right now — please contact support@asknexaai.com directly.";

  const request: Anthropic.MessageCreateParamsNonStreaming = {
    model: MODEL,
    max_tokens: 700,
    system: `${SUPPORT_AGENTS.billing.systemPrompt}${TOOL_USE_ADDENDUM}`,
    tools: TOOLS,
    messages: history.map((m) => ({ role: m.role, content: m.content })),
  };

  let allText = "";
  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const response = await anthropic.messages.create(request);
    const text = joinText(response.content);
    allText += allText && text ? `\n\n${text}` : text;

    if (response.stop_reason !== "tool_use") {
      return allText.trim() || "I couldn't put together a reply to that — try rephrasing, or email support@asknexaai.com.";
    }

    request.messages.push({ role: "assistant", content: response.content });
    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const toolResults = await Promise.all(
      toolUses.map(async (block) => {
        let resultText: string;
        try {
          if (block.name === "get_credit_history") {
            resultText = await getCreditHistoryTool(userId);
          } else if (block.name === "issue_credit_refund") {
            resultText = await issueCreditRefundTool(userId, block.input as Record<string, unknown>, latestUserText);
          } else {
            resultText = JSON.stringify({ ok: false, error: "Unknown tool." });
          }
        } catch (err) {
          resultText = JSON.stringify({ ok: false, error: err instanceof Error ? err.message : "Tool failed." });
        }
        return { type: "tool_result" as const, tool_use_id: block.id, content: resultText };
      }),
    );
    request.messages.push({ role: "user", content: toolResults });
  }

  return allText.trim() || "I looked into this but need a human to finish reviewing it — please email support@asknexaai.com with the details.";
}
