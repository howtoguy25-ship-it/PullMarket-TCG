// Status: real photo/video stories, visible for a real 24 hours, with real
// per-story audience control — everyone, friends only, or a hand-picked
// custom list. Every read is filtered on `expiresAt` at query time, so
// nothing has to "turn off" a story when it expires; lib/storyExpiry.ts
// just periodically cleans up rows/files that are already invisible.
import { Router } from "express";
import { z } from "zod";
import { db } from "../db";
import { stories, storyCustomViewers, storyViews, friendRequests, conversations, users } from "@shared/schema";
import { and, desc, eq, gt, inArray, or, ilike, ne, sql } from "drizzle-orm";
import { authenticateToken } from "../middleware/auth";
import { chatUpload, attachmentTypeFromMime } from "../lib/chatUpload";
import { saveUploadedFile, deleteUploadedFile } from "../lib/upload";
import { isBlockedEitherWay } from "../lib/blocks";
import { STORY_PRIVACY_LEVELS } from "@shared/schema";
import { STORY_EXPIRY_HOURS, STORY_MAX_CAPTION_LENGTH } from "@shared/validation";

const router = Router();
router.use(authenticateToken);

const PUBLIC_USER_COLUMNS = { id: users.id, username: users.username, displayName: users.displayName, avatarUrl: users.avatarUrl };

async function getFriendIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ requesterId: friendRequests.requesterId, recipientId: friendRequests.recipientId })
    .from(friendRequests)
    .where(and(eq(friendRequests.status, "accepted"), or(eq(friendRequests.requesterId, userId), eq(friendRequests.recipientId, userId))));
  return rows.map((r) => (r.requesterId === userId ? r.recipientId : r.requesterId));
}

async function canViewStory(story: { id: string; userId: string; privacy: string }, viewerId: string): Promise<boolean> {
  if (story.userId === viewerId) return true;
  if (await isBlockedEitherWay(story.userId, viewerId)) return false;
  if (story.privacy === "everyone") return true;
  if (story.privacy === "friends") return (await getFriendIds(story.userId)).includes(viewerId);
  const [row] = await db.select().from(storyCustomViewers).where(and(eq(storyCustomViewers.storyId, story.id), eq(storyCustomViewers.userId, viewerId)));
  return !!row;
}

// ── Create a story ────────────────────────────────────────────────────
router.post("/", chatUpload.single("media"), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: "Add a photo or video first." });

  const schema = z.object({
    caption: z.string().max(STORY_MAX_CAPTION_LENGTH).optional(),
    privacy: z.enum(STORY_PRIVACY_LEVELS).default("everyone"),
    customViewerIds: z.string().optional(), // JSON-encoded string[], only when privacy === "custom"
    // Real natural pixel dimensions of the picked asset, so every viewer can
    // render the same real 16:9/9:16 frame the creator saw instead of
    // guessing. rotation is 0/90/180/270 — see shared/src/schema.ts.
    mediaWidth: z.coerce.number().int().positive().optional(),
    mediaHeight: z.coerce.number().int().positive().optional(),
    rotation: z.coerce.number().int().refine((v) => [0, 90, 180, 270].includes(v), "Invalid rotation").default(0),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid story" });

  let customViewerIds: string[] = [];
  if (parsed.data.privacy === "custom") {
    try {
      customViewerIds = JSON.parse(parsed.data.customViewerIds || "[]");
    } catch {
      return res.status(400).json({ message: "Invalid audience list" });
    }
    if (!Array.isArray(customViewerIds) || customViewerIds.length === 0) {
      return res.status(400).json({ message: "Pick at least one person for a custom story." });
    }
  }

  const mediaType = attachmentTypeFromMime(req.file.mimetype);
  const mediaUrl = await saveUploadedFile(req.file);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + STORY_EXPIRY_HOURS * 60 * 60 * 1000);

  const [story] = await db
    .insert(stories)
    .values({
      userId: req.user!.id,
      mediaType,
      mediaUrl,
      mediaWidth: parsed.data.mediaWidth ?? null,
      mediaHeight: parsed.data.mediaHeight ?? null,
      rotation: parsed.data.rotation,
      caption: parsed.data.caption || null,
      privacy: parsed.data.privacy,
      expiresAt,
    })
    .returning();

  if (customViewerIds.length > 0) {
    await db.insert(storyCustomViewers).values(customViewerIds.map((userId) => ({ storyId: story.id, userId })));
  }

  res.status(201).json(story);
});

// ── My own active stories, with real view counts ──────────────────────
router.get("/mine", async (req, res) => {
  const mine = await db
    .select()
    .from(stories)
    .where(and(eq(stories.userId, req.user!.id), gt(stories.expiresAt, new Date())))
    .orderBy(stories.createdAt);

  const counts = mine.length > 0 ? await db.select({ storyId: storyViews.storyId, count: sql<number>`count(*)::int` }).from(storyViews).where(inArray(storyViews.storyId, mine.map((s) => s.id))).groupBy(storyViews.storyId) : [];
  const countByStory = new Map(counts.map((c) => [c.storyId, c.count]));

  res.json(mine.map((s) => ({ ...s, viewCount: countByStory.get(s.id) ?? 0 })));
});

// ── The tray: everyone whose active stories I'm allowed to see, grouped ─
router.get("/feed", async (req, res) => {
  const meId = req.user!.id;
  const active = await db.select().from(stories).where(gt(stories.expiresAt, new Date())).orderBy(desc(stories.createdAt));
  if (active.length === 0) return res.json({ mine: null, others: [] });

  const visible = [];
  for (const s of active) {
    if (await canViewStory(s, meId)) visible.push(s);
  }
  if (visible.length === 0) return res.json({ mine: null, others: [] });

  const userIds = Array.from(new Set(visible.map((s) => s.userId)));
  const people = await db.select(PUBLIC_USER_COLUMNS).from(users).where(inArray(users.id, userIds));
  const peopleById = new Map(people.map((p) => [p.id, p]));

  const myViews = await db.select({ storyId: storyViews.storyId }).from(storyViews).where(and(eq(storyViews.viewerId, meId), inArray(storyViews.storyId, visible.map((s) => s.id))));
  const seenIds = new Set(myViews.map((v) => v.storyId));

  const byUser = new Map<string, typeof visible>();
  for (const s of visible) {
    const arr = byUser.get(s.userId) ?? [];
    arr.push(s);
    byUser.set(s.userId, arr);
  }

  const groups = Array.from(byUser.entries()).map(([userId, list]) => ({
    user: peopleById.get(userId) ?? null,
    stories: list.map((s) => ({
      id: s.id,
      mediaType: s.mediaType,
      mediaUrl: s.mediaUrl,
      mediaWidth: s.mediaWidth,
      mediaHeight: s.mediaHeight,
      rotation: s.rotation,
      caption: s.caption,
      createdAt: s.createdAt,
      seen: seenIds.has(s.id),
    })),
    hasUnseen: list.some((s) => !seenIds.has(s.id)),
    latestAt: list[0].createdAt,
  }));

  const mine = groups.find((g) => g.user?.id === meId) ?? null;
  const others = groups
    .filter((g) => g.user?.id !== meId)
    .sort((a, b) => (a.hasUnseen === b.hasUnseen ? 0 : a.hasUnseen ? -1 : 1) || (b.latestAt?.getTime() ?? 0) - (a.latestAt?.getTime() ?? 0));

  res.json({ mine, others });
});

// ── Search friends + recent chat partners for the "custom" audience picker
router.get("/privacy-candidates", async (req, res) => {
  const meId = req.user!.id;
  const q = String(req.query.q ?? "").trim();

  const friendIds = await getFriendIds(meId);
  const recentConvos = await db
    .select({ userAId: conversations.userAId, userBId: conversations.userBId })
    .from(conversations)
    .where(and(eq(conversations.status, "accepted"), or(eq(conversations.userAId, meId), eq(conversations.userBId, meId))))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(30);
  const recentIds = recentConvos.map((c) => (c.userAId === meId ? c.userBId : c.userAId));

  const candidateIds = Array.from(new Set([...friendIds, ...recentIds]));
  if (candidateIds.length === 0) return res.json([]);

  const rows = await db
    .select(PUBLIC_USER_COLUMNS)
    .from(users)
    .where(and(inArray(users.id, candidateIds), ne(users.id, meId), q ? ilike(users.username, `%${q}%`) : sql`true`));

  const friendSet = new Set(friendIds);
  res.json(rows.map((r) => ({ ...r, isFriend: friendSet.has(r.id) })).sort((a, b) => (a.isFriend === b.isFriend ? 0 : a.isFriend ? -1 : 1)));
});

// ── One user's active stories I'm allowed to see ───────────────────────
router.get("/:userId", async (req, res) => {
  const meId = req.user!.id;
  const targetId = req.params.userId;
  const all = await db
    .select()
    .from(stories)
    .where(and(eq(stories.userId, targetId), gt(stories.expiresAt, new Date())))
    .orderBy(stories.createdAt);

  const visible = [];
  for (const s of all) {
    if (await canViewStory(s, meId)) visible.push(s);
  }
  if (visible.length === 0 && all.length > 0) return res.status(403).json({ message: "This person's story isn't visible to you." });

  const [person] = await db.select(PUBLIC_USER_COLUMNS).from(users).where(eq(users.id, targetId));
  res.json({ user: person ?? null, stories: visible });
});

// ── Mark a story as viewed ──────────────────────────────────────────────
router.post("/:id/view", async (req, res) => {
  const [story] = await db.select().from(stories).where(eq(stories.id, req.params.id));
  if (!story) return res.status(404).json({ message: "Story not found" });
  if (!(await canViewStory(story, req.user!.id))) return res.status(403).json({ message: "Not visible to you" });

  await db.insert(storyViews).values({ storyId: story.id, viewerId: req.user!.id }).onConflictDoNothing();
  res.json({ viewed: true });
});

// ── Owner-only: who has actually viewed this story ──────────────────────
router.get("/:id/viewers", async (req, res) => {
  const [story] = await db.select().from(stories).where(eq(stories.id, req.params.id));
  if (!story) return res.status(404).json({ message: "Story not found" });
  if (story.userId !== req.user!.id) return res.status(403).json({ message: "Only the story's owner can see who viewed it" });

  const views = await db.select().from(storyViews).where(eq(storyViews.storyId, story.id)).orderBy(desc(storyViews.viewedAt));
  if (views.length === 0) return res.json([]);
  const people = await db.select(PUBLIC_USER_COLUMNS).from(users).where(inArray(users.id, views.map((v) => v.viewerId)));
  const byId = new Map(people.map((p) => [p.id, p]));
  res.json(views.map((v) => ({ viewedAt: v.viewedAt, user: byId.get(v.viewerId) ?? null })));
});

// ── Delete my own story early ───────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  const [story] = await db.select().from(stories).where(eq(stories.id, req.params.id));
  if (!story) return res.status(404).json({ message: "Story not found" });
  if (story.userId !== req.user!.id) return res.status(403).json({ message: "You can only delete your own story" });

  await db.delete(stories).where(eq(stories.id, story.id));
  await deleteUploadedFile(story.mediaUrl);
  res.json({ deleted: true });
});

export default router;
