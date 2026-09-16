import { Router } from "express";
import { eq, and, asc, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { supportConversations, supportMessages } from "@shared/schema";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { askSupportAgent } from "../lib/anthropic";
import { SUPPORT_AGENTS } from "../lib/supportPersonas";
import { runBillingAgentTurn } from "../lib/billingAgent";

export const supportRouter = Router();
supportRouter.use(requireAuth);

// Real agent roster for the client's picker — served from the server's own
// persona definitions (lib/supportPersonas.ts) so the two can never drift
// out of sync with each other.
supportRouter.get("/agents", (_req, res) => {
  res.json({
    agents: Object.values(SUPPORT_AGENTS).map((a) => ({ id: a.id, label: a.label, description: a.description, icon: a.icon })),
  });
});

supportRouter.get("/conversations", async (req: AuthedRequest, res) => {
  const rows = await db
    .select()
    .from(supportConversations)
    .where(eq(supportConversations.userId, req.userId!))
    .orderBy(desc(supportConversations.createdAt));
  res.json({ conversations: rows });
});

const createConversationSchema = z.object({ agentType: z.enum(["billing", "technical", "account", "general"]) });
supportRouter.post("/conversations", async (req: AuthedRequest, res) => {
  const parsed = createConversationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const agent = SUPPORT_AGENTS[parsed.data.agentType];
  const [conversation] = await db
    .insert(supportConversations)
    .values({ userId: req.userId!, agentType: agent.id, title: agent.label })
    .returning();
  res.json({ conversation });
});

async function loadOwnConversation(userId: string, conversationId: string) {
  const [conversation] = await db
    .select()
    .from(supportConversations)
    .where(and(eq(supportConversations.id, conversationId), eq(supportConversations.userId, userId)));
  return conversation ?? null;
}

supportRouter.get("/conversations/:id/messages", async (req: AuthedRequest, res) => {
  const conversation = await loadOwnConversation(req.userId!, req.params.id);
  if (!conversation) return res.status(404).json({ error: "Conversation not found" });
  const rows = await db
    .select()
    .from(supportMessages)
    .where(eq(supportMessages.conversationId, conversation.id))
    .orderBy(asc(supportMessages.createdAt));
  res.json({ conversation, messages: rows });
});

const sendMessageSchema = z.object({ text: z.string().min(1).max(2000) });
supportRouter.post("/conversations/:id/messages", async (req: AuthedRequest, res) => {
  const parsed = sendMessageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const conversation = await loadOwnConversation(req.userId!, req.params.id);
  if (!conversation) return res.status(404).json({ error: "Conversation not found" });

  const [userMessage] = await db
    .insert(supportMessages)
    .values({ conversationId: conversation.id, role: "user", content: parsed.data.text })
    .returning();

  const priorMessages = await db
    .select()
    .from(supportMessages)
    .where(eq(supportMessages.conversationId, conversation.id))
    .orderBy(asc(supportMessages.createdAt));

  const agent = SUPPORT_AGENTS[conversation.agentType];
  // Real, free — Help & Support is not metered against the user's credit
  // balance the way Chat/Voice/who-is turns are (see routes/chat.ts); it's
  // support for the app itself, not a feature the app sells access to.
  //
  // Billing is the one agent that gets real tools (lib/billingAgent.ts) —
  // it can actually pull this user's real transaction history and issue a
  // real refund itself when the data backs it up, instead of only being
  // able to tell them to go tap "Report issue" on a specific reply.
  const replyText =
    agent.id === "billing"
      ? await runBillingAgentTurn(
          req.userId!,
          priorMessages.map((m) => ({ role: m.role, content: m.content })),
          parsed.data.text,
        )
      : await askSupportAgent(
          agent.systemPrompt,
          priorMessages.map((m) => ({ role: m.role, content: m.content })),
        );

  const [assistantMessage] = await db
    .insert(supportMessages)
    .values({ conversationId: conversation.id, role: "assistant", content: replyText })
    .returning();

  res.json({ userMessage, message: assistantMessage });
});
