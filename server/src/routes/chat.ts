import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { conversations, messages, messageAttachments, messageDeletions, users, reports, readReceiptExclusions } from "@shared/schema";
import { and, desc, eq, inArray, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
import { authenticateToken } from "../middleware/auth";
import { chatUpload, attachmentTypeFromMime } from "../lib/chatUpload";
import { saveUploadedFile, deleteUploadedFile } from "../lib/upload";
import { notifyUser } from "../lib/notify";
import { moderateMessage, isModerationConfigured } from "../lib/moderation";
import { isBlockedEitherWay } from "../lib/blocks";

// Sender can delete a message for everyone only within this window.
const DELETE_FOR_EVERYONE_WINDOW_MS = 24 * 60 * 60 * 1000;

const router = Router();
router.use(authenticateToken);

const PUBLIC_USER_COLUMNS = { id: users.id, username: users.username, displayName: users.displayName, avatarUrl: users.avatarUrl };

function pairIds(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

async function assertParticipant(conversationId: string, userId: string) {
  const [convo] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
  if (!convo) return null;
  if (convo.userAId !== userId && convo.userBId !== userId) return null;
  return convo;
}

async function attachAttachments(rows: (typeof messages.$inferSelect)[]) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const atts = await db.select().from(messageAttachments).where(inArray(messageAttachments.messageId, ids)).orderBy(messageAttachments.position);
  const byMessage = new Map<string, typeof atts>();
  for (const a of atts) {
    const arr = byMessage.get(a.messageId) ?? [];
    arr.push(a);
    byMessage.set(a.messageId, arr);
  }
  return rows.map((r) => ({ ...r, attachments: byMessage.get(r.id) ?? [] }));
}

// Embeds a lightweight snapshot of the message being replied to, so a
// reply still renders sensibly even if the original was later deleted (for
// everyone) or the replier can no longer see it (deleted for themselves) —
// in either case replyTo comes back null and the client shows a generic
// "Original message unavailable" line instead of chasing a dead id.
async function attachReplyPreviews<T extends { id: string; replyToMessageId: string | null }>(rows: T[], viewerId: string) {
  const targetIds = Array.from(new Set(rows.map((r) => r.replyToMessageId).filter((id): id is string => !!id)));
  if (targetIds.length === 0) return rows.map((r) => ({ ...r, replyTo: null as any }));

  const [targets, hiddenForViewer] = await Promise.all([
    db
      .select({ id: messages.id, senderId: messages.senderId, text: messages.text, deletedForEveryoneAt: messages.deletedForEveryoneAt, username: users.username })
      .from(messages)
      .innerJoin(users, eq(users.id, messages.senderId))
      .where(inArray(messages.id, targetIds)),
    db.select({ messageId: messageDeletions.messageId }).from(messageDeletions).where(and(eq(messageDeletions.userId, viewerId), inArray(messageDeletions.messageId, targetIds))),
  ]);
  const hiddenIds = new Set(hiddenForViewer.map((h) => h.messageId));
  const byId = new Map(targets.map((t) => [t.id, t]));

  return rows.map((r) => {
    if (!r.replyToMessageId) return { ...r, replyTo: null as any };
    const target = byId.get(r.replyToMessageId);
    if (!target || hiddenIds.has(r.replyToMessageId) || target.deletedForEveryoneAt) {
      return { ...r, replyTo: null as any };
    }
    return { ...r, replyTo: { id: target.id, senderId: target.senderId, senderUsername: target.username, text: target.text } };
  });
}

router.get("/unread-count", async (req, res) => {
  const meId = req.user!.id;
  const rows = await db
    .select({ conversationId: messages.conversationId, count: sql<number>`count(*)::int` })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(and(or(eq(conversations.userAId, meId), eq(conversations.userBId, meId)), ne(conversations.status, "declined"), ne(messages.senderId, meId), isNull(messages.readAt)))
    .groupBy(messages.conversationId);
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  res.json({ count: total });
});

// ── Find or create the 1:1 conversation with another user ────────────────
router.post("/conversations/with/:userId", async (req, res) => {
  const meId = req.user!.id;
  const targetId = req.params.userId;
  if (targetId === meId) return res.status(400).json({ message: "You can't message yourself" });

  const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, targetId));
  if (!target) return res.status(404).json({ message: "User not found" });
  if (await isBlockedEitherWay(meId, targetId)) return res.status(403).json({ message: "You can't message this user" });

  const [userAId, userBId] = pairIds(meId, targetId);
  const [existing] = await db.select().from(conversations).where(and(eq(conversations.userAId, userAId), eq(conversations.userBId, userBId)));
  if (existing) {
    // A declined thread is closed to whoever got declined, but if the
    // decliner is the one reaching out now, that's a fresh request.
    if (existing.status === "declined") {
      const [reopened] = await db
        .update(conversations)
        .set({ status: "pending", initiatorId: meId, respondedAt: null })
        .where(eq(conversations.id, existing.id))
        .returning();
      return res.json(reopened);
    }
    return res.json(existing);
  }

  const [created] = await db.insert(conversations).values({ userAId, userBId, initiatorId: meId, status: "pending" }).returning();
  res.status(201).json(created);
});

// ── List my conversations (accepted chats + pending requests both ways) ──
router.get("/conversations", async (req, res) => {
  const meId = req.user!.id;
  const rows = await db
    .select()
    .from(conversations)
    .where(and(or(eq(conversations.userAId, meId), eq(conversations.userBId, meId)), ne(conversations.status, "declined")))
    .orderBy(desc(conversations.lastMessageAt));

  if (rows.length === 0) return res.json([]);

  // A recipient's client fetching the inbox is the point a message has
  // reached their device — flip sent→delivered here, same as a real chat
  // app's "arrived" tick, without needing a push/socket round-trip.
  const conversationIds = rows.map((r) => r.id);
  await db
    .update(messages)
    .set({ deliveredAt: new Date() })
    .where(and(inArray(messages.conversationId, conversationIds), ne(messages.senderId, meId), isNull(messages.deliveredAt)));

  const otherIds = rows.map((r) => (r.userAId === meId ? r.userBId : r.userAId));
  const [people, unreadRows] = await Promise.all([
    db.select(PUBLIC_USER_COLUMNS).from(users).where(inArray(users.id, otherIds)),
    db
      .select({ conversationId: messages.conversationId, count: sql<number>`count(*)::int` })
      .from(messages)
      .where(and(inArray(messages.conversationId, conversationIds), ne(messages.senderId, meId), isNull(messages.readAt)))
      .groupBy(messages.conversationId),
  ]);
  const peopleById = new Map(people.map((p) => [p.id, p]));
  const unreadByConvo = new Map(unreadRows.map((u) => [u.conversationId, u.count]));

  res.json(
    rows.map((r) => ({
      ...r,
      otherUser: peopleById.get(r.userAId === meId ? r.userBId : r.userAId) ?? null,
      isIncomingRequest: r.status === "pending" && r.initiatorId !== meId,
      unreadCount: unreadByConvo.get(r.id) ?? 0,
    })),
  );
});

router.post("/conversations/:id/accept", async (req, res) => {
  const convo = await assertParticipant(req.params.id, req.user!.id);
  if (!convo) return res.status(404).json({ message: "Conversation not found" });
  if (convo.initiatorId === req.user!.id) return res.status(403).json({ message: "Only the recipient can accept" });
  if (convo.status !== "pending") return res.json(convo);

  const [updated] = await db.update(conversations).set({ status: "accepted", respondedAt: new Date() }).where(eq(conversations.id, convo.id)).returning();
  await notifyUser(convo.initiatorId, { type: "chat_accepted", title: "Message request accepted", body: `@${req.user!.username} accepted your message`, data: { conversationId: convo.id } });
  res.json(updated);
});

router.post("/conversations/:id/decline", async (req, res) => {
  const convo = await assertParticipant(req.params.id, req.user!.id);
  if (!convo) return res.status(404).json({ message: "Conversation not found" });
  if (convo.initiatorId === req.user!.id) return res.status(403).json({ message: "Only the recipient can decline" });

  const [updated] = await db.update(conversations).set({ status: "declined", respondedAt: new Date() }).where(eq(conversations.id, convo.id)).returning();
  res.json(updated);
});

// ── Messages in a conversation ────────────────────────────────────────────
router.get("/conversations/:id/messages", async (req, res) => {
  const meId = req.user!.id;
  const convo = await assertParticipant(req.params.id, meId);
  if (!convo) return res.status(404).json({ message: "Conversation not found" });

  const querySchema = z.object({ before: z.string().optional(), limit: z.coerce.number().min(1).max(100).default(50) });
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: "Invalid query" });

  const hiddenForMe = await db.select({ messageId: messageDeletions.messageId }).from(messageDeletions).where(eq(messageDeletions.userId, meId));
  const conditions = [eq(messages.conversationId, convo.id)];
  if (hiddenForMe.length > 0) conditions.push(notInArray(messages.id, hiddenForMe.map((h) => h.messageId)));
  if (parsed.data.before) {
    const [beforeMsg] = await db.select({ createdAt: messages.createdAt }).from(messages).where(eq(messages.id, parsed.data.before));
    if (beforeMsg) conditions.push(lt(messages.createdAt, beforeMsg.createdAt!));
  }

  const rows = await db.select().from(messages).where(and(...conditions)).orderBy(desc(messages.createdAt)).limit(parsed.data.limit);

  // Delivered always flips on view. Read only flips once the conversation is
  // accepted — while it's still a pending request, the recipient can open
  // and read it freely without the sender ever finding out (no readAt set),
  // exactly like viewing a message request before deciding to accept —
  // and, independently, only if I haven't turned off read receipts
  // altogether or specifically excluded the other person in this
  // conversation from seeing my read status.
  const now = new Date();
  await db
    .update(messages)
    .set({ deliveredAt: now })
    .where(and(eq(messages.conversationId, convo.id), ne(messages.senderId, meId), isNull(messages.deliveredAt)));

  const otherUserId = convo.userAId === meId ? convo.userBId : convo.userAId;
  const readReceiptsAllowed =
    (req.user!.readReceiptsEnabled ?? true) &&
    (await db
      .select({ userId: readReceiptExclusions.userId })
      .from(readReceiptExclusions)
      .where(and(eq(readReceiptExclusions.userId, meId), eq(readReceiptExclusions.excludedUserId, otherUserId)))
    ).length === 0;
  const willMarkRead = convo.status === "accepted" && readReceiptsAllowed;
  if (willMarkRead) {
    await db
      .update(messages)
      .set({ readAt: now })
      .where(and(eq(messages.conversationId, convo.id), ne(messages.senderId, meId), isNull(messages.readAt)));
  }
  // Reflect those updates in this response too, not just the next poll —
  // the rows above were selected before the UPDATEs ran.
  const patched = rows.map((r) =>
    r.senderId === meId
      ? r
      : { ...r, deliveredAt: r.deliveredAt ?? now, readAt: willMarkRead ? (r.readAt ?? now) : r.readAt },
  );

  const withAttachments = await attachAttachments(patched);
  const withReplies = await attachReplyPreviews(withAttachments, meId);
  // Newest-first — matches the client's inverted FlatList directly (index 0
  // renders at the bottom of the screen, i.e. the newest message).
  res.json(withReplies);
});

// Shared by both a normal send and a forward: bumps the conversation's
// preview/lastMessageAt, flips a pending request to accepted if the
// recipient is the one sending, and pushes a notification to the other
// participant.
async function finalizeOutgoingMessage(convo: typeof conversations.$inferSelect, meId: string, senderUsername: string, preview: string) {
  const isRecipientReply = convo.status === "pending" && convo.initiatorId !== meId;
  await db
    .update(conversations)
    .set({
      lastMessageAt: new Date(),
      lastMessagePreview: preview,
      ...(isRecipientReply ? { status: "accepted" as const, respondedAt: new Date() } : {}),
    })
    .where(eq(conversations.id, convo.id));

  const otherUserId = convo.userAId === meId ? convo.userBId : convo.userAId;
  await notifyUser(otherUserId, { type: "new_message", title: `@${senderUsername}`, body: preview, data: { conversationId: convo.id } });
  return isRecipientReply;
}

router.post("/conversations/:id/messages", chatUpload.array("media", 4), async (req, res) => {
  const meId = req.user!.id;
  const convo = await assertParticipant(req.params.id, meId);
  if (!convo) return res.status(404).json({ message: "Conversation not found" });
  if (convo.status === "declined") return res.status(403).json({ message: "This conversation was declined" });

  const otherParticipantId = convo.userAId === meId ? convo.userBId : convo.userAId;
  if (await isBlockedEitherWay(meId, otherParticipantId)) return res.status(403).json({ message: "You can't message this user" });

  const bodySchema = z.object({ text: z.string().max(2000).optional(), replyToMessageId: z.string().optional() });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid message" });

  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const text = parsed.data.text?.trim();
  if (!text && files.length === 0) return res.status(400).json({ message: "Message can't be empty" });

  let replyToMessageId: string | null = null;
  if (parsed.data.replyToMessageId) {
    const [target] = await db.select({ id: messages.id, conversationId: messages.conversationId }).from(messages).where(eq(messages.id, parsed.data.replyToMessageId));
    if (target && target.conversationId === convo.id) replyToMessageId = target.id;
  }

  const [message] = await db.insert(messages).values({ conversationId: convo.id, senderId: meId, text: text || null, replyToMessageId }).returning();
  if (files.length > 0) {
    const urls = await Promise.all(files.map((f) => saveUploadedFile(f)));
    await db.insert(messageAttachments).values(urls.map((url, i) => ({ messageId: message.id, url, type: attachmentTypeFromMime(files[i].mimetype), position: i })));
  }

  const preview = text || (files.length > 0 ? (attachmentTypeFromMime(files[0].mimetype) === "video" ? "Sent a video" : "Sent a photo") : "");
  const isRecipientReply = await finalizeOutgoingMessage(convo, meId, req.user!.username, preview);

  const [withAttachments] = await attachAttachments([message]);
  const [withReply] = await attachReplyPreviews([withAttachments], meId);
  res.status(201).json({ ...withReply, conversationAccepted: isRecipientReply });

  // Moderation runs after the response is already sent — it never adds
  // latency to sending a message, and a slow/failed AI call can't affect
  // delivery. A flagged message stays delivered as normal; this only opens
  // a report in the owner's review queue.
  if (text && isModerationConfigured()) {
    void moderateMessage(text)
      .then(async (verdict) => {
        if (!verdict?.flagged) return;
        await db.update(messages).set({ flagged: true }).where(eq(messages.id, message.id));
        await db.insert(reports).values({
          source: "ai_moderation",
          conversationId: convo.id,
          reportedUserId: meId,
          messageId: message.id,
          reason: verdict.category === "none" ? "other" : verdict.category,
          description: `Auto-flagged chat message: "${text.slice(0, 300)}"`,
          aiReasoning: verdict.reasoning,
        });
      })
      .catch((err) => console.error("Chat moderation pass failed:", err));
  }
});

// ── Delete for me ─────────────────────────────────────────────────────────
// Hides the message from the requester's own view only — everyone else's
// copy (and the row itself) is untouched. Works on any message in any
// conversation the requester participates in, including ones they didn't
// send, exactly like "Delete for me" in a real chat app.
router.delete("/messages/:id", async (req, res) => {
  const meId = req.user!.id;
  const [message] = await db.select({ id: messages.id, conversationId: messages.conversationId }).from(messages).where(eq(messages.id, req.params.id));
  if (!message) return res.status(404).json({ message: "Message not found" });
  if (!(await assertParticipant(message.conversationId, meId))) return res.status(404).json({ message: "Message not found" });

  await db.insert(messageDeletions).values({ userId: meId, messageId: message.id }).onConflictDoNothing();
  res.json({ status: "ok" });
});

// ── Delete for everyone ───────────────────────────────────────────────────
// Sender-only, and only within DELETE_FOR_EVERYONE_WINDOW_MS of sending —
// after that the button simply stops being an option client-side, and this
// route is the real (server-enforced) backstop for that limit. Tombstones
// the row (clears text + attachments) rather than deleting it outright so
// replies pointing at it can still resolve to "message deleted" instead of
// a dangling id.
router.post("/messages/:id/delete-everyone", async (req, res) => {
  const meId = req.user!.id;
  const [message] = await db.select().from(messages).where(eq(messages.id, req.params.id));
  if (!message) return res.status(404).json({ message: "Message not found" });
  if (message.senderId !== meId) return res.status(403).json({ message: "You can only delete your own messages for everyone" });
  if (message.deletedForEveryoneAt) return res.json(message);

  const ageMs = Date.now() - (message.createdAt?.getTime() ?? 0);
  if (ageMs > DELETE_FOR_EVERYONE_WINDOW_MS) return res.status(403).json({ message: "This message is too old to delete for everyone" });

  const attachments = await db.select().from(messageAttachments).where(eq(messageAttachments.messageId, message.id));
  await Promise.all(attachments.map((a) => deleteUploadedFile(a.url)));
  await db.delete(messageAttachments).where(eq(messageAttachments.messageId, message.id));

  const [updated] = await db.update(messages).set({ text: null, deletedForEveryoneAt: new Date() }).where(eq(messages.id, message.id)).returning();
  res.json({ ...updated, attachments: [] });
});

// ── Forward ────────────────────────────────────────────────────────────────
router.post("/messages/:id/forward", async (req, res) => {
  const meId = req.user!.id;
  const schema = z.object({ toConversationId: z.string() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid request" });

  const [source] = await db.select().from(messages).where(eq(messages.id, req.params.id));
  if (!source) return res.status(404).json({ message: "Message not found" });
  if (!(await assertParticipant(source.conversationId, meId))) return res.status(404).json({ message: "Message not found" });
  if (source.deletedForEveryoneAt) return res.status(400).json({ message: "This message was deleted" });
  const [hiddenForMe] = await db.select().from(messageDeletions).where(and(eq(messageDeletions.userId, meId), eq(messageDeletions.messageId, source.id)));
  if (hiddenForMe) return res.status(404).json({ message: "Message not found" });

  const target = await assertParticipant(parsed.data.toConversationId, meId);
  if (!target) return res.status(404).json({ message: "Conversation not found" });
  if (target.status === "declined") return res.status(403).json({ message: "This conversation was declined" });
  const targetOtherId = target.userAId === meId ? target.userBId : target.userAId;
  if (await isBlockedEitherWay(meId, targetOtherId)) return res.status(403).json({ message: "You can't message this user" });

  const sourceAttachments = await db.select().from(messageAttachments).where(eq(messageAttachments.messageId, source.id));
  if (!source.text && sourceAttachments.length === 0) return res.status(400).json({ message: "Nothing to forward" });

  const [message] = await db.insert(messages).values({ conversationId: target.id, senderId: meId, text: source.text, forwarded: true }).returning();
  if (sourceAttachments.length > 0) {
    await db.insert(messageAttachments).values(sourceAttachments.map((a) => ({ messageId: message.id, url: a.url, type: a.type, position: a.position })));
  }

  const preview = source.text || (sourceAttachments.length > 0 ? (sourceAttachments[0].type === "video" ? "Sent a video" : "Sent a photo") : "");
  const isRecipientReply = await finalizeOutgoingMessage(target, meId, req.user!.username, preview);

  const [withAttachments] = await attachAttachments([message]);
  res.status(201).json({ ...withAttachments, replyTo: null, conversationAccepted: isRecipientReply });
});

router.get("/conversations/:id", async (req, res) => {
  const meId = req.user!.id;
  const convo = await assertParticipant(req.params.id, meId);
  if (!convo) return res.status(404).json({ message: "Conversation not found" });
  const otherUserId = convo.userAId === meId ? convo.userBId : convo.userAId;
  const [otherUser] = await db.select(PUBLIC_USER_COLUMNS).from(users).where(eq(users.id, otherUserId));
  res.json({ ...convo, otherUser: otherUser ?? null, isIncomingRequest: convo.status === "pending" && convo.initiatorId !== meId });
});

// ── Read-receipt privacy settings ─────────────────────────────────────────
router.get("/read-receipts/settings", async (req, res) => {
  const meId = req.user!.id;
  const exclusionRows = await db
    .select({ user: PUBLIC_USER_COLUMNS })
    .from(readReceiptExclusions)
    .innerJoin(users, eq(users.id, readReceiptExclusions.excludedUserId))
    .where(eq(readReceiptExclusions.userId, meId));

  res.json({
    enabled: req.user!.readReceiptsEnabled ?? true,
    excludedUsers: exclusionRows.map((r) => r.user),
  });
});

router.patch("/read-receipts/settings", async (req, res) => {
  const schema = z.object({ enabled: z.boolean() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid request" });

  await db.update(users).set({ readReceiptsEnabled: parsed.data.enabled }).where(eq(users.id, req.user!.id));
  res.json({ enabled: parsed.data.enabled });
});

// Replace-all, same pattern as /api/listings/subscriptions/mine — the
// client always sends the full set of people it wants excluded.
router.put("/read-receipts/exclusions", async (req, res) => {
  const schema = z.object({ userIds: z.array(z.string()) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid request" });

  const meId = req.user!.id;
  const userIds = parsed.data.userIds.filter((id) => id !== meId);
  await db.delete(readReceiptExclusions).where(eq(readReceiptExclusions.userId, meId));
  if (userIds.length > 0) {
    await db.insert(readReceiptExclusions).values(userIds.map((excludedUserId) => ({ userId: meId, excludedUserId })));
  }
  res.json({ excludedUserIds: userIds });
});

export default router;
