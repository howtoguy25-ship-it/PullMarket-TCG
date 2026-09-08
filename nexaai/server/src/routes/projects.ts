// Real Projects: a named workspace for building one specific site/app,
// distinct from the general Chat tab. Each project owns real chat sessions
// (schema's chatSessions.projectId) so "recent chats" and full history are
// queryable rows, not client-side-only state.

import { Router } from "express";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { db } from "../db";
import { projects, chatSessions, messages } from "@shared/schema";
import { requireAuth, type AuthedRequest } from "../middleware/auth";

export const projectsRouter = Router();
projectsRouter.use(requireAuth);

const createSchema = z.object({ title: z.string().min(1).max(80) });
projectsRouter.post("/", async (req: AuthedRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const [project] = await db.insert(projects).values({ userId: req.userId!, title: parsed.data.title }).returning();
  res.status(201).json({ project });
});

// Real recent-history list: each project's last session + last message
// preview, so "recent chats" reflects actual rows, not a mock.
projectsRouter.get("/", async (req: AuthedRequest, res) => {
  const rows = await db.select().from(projects).where(eq(projects.userId, req.userId!)).orderBy(desc(projects.updatedAt));

  const withPreview = await Promise.all(
    rows.map(async (project) => {
      const [lastSession] = await db
        .select()
        .from(chatSessions)
        .where(eq(chatSessions.projectId, project.id))
        .orderBy(desc(chatSessions.startedAt))
        .limit(1);
      let lastMessagePreview: string | null = null;
      if (lastSession) {
        const [lastMessage] = await db
          .select()
          .from(messages)
          .where(eq(messages.sessionId, lastSession.id))
          .orderBy(desc(messages.createdAt))
          .limit(1);
        lastMessagePreview = lastMessage?.content.slice(0, 140) ?? null;
      }
      return { ...project, lastMessagePreview, lastActivityAt: lastSession?.startedAt ?? project.createdAt };
    }),
  );

  res.json({ projects: withPreview });
});

projectsRouter.get("/:id/sessions", async (req: AuthedRequest, res) => {
  const [project] = await db.select().from(projects).where(and(eq(projects.id, req.params.id), eq(projects.userId, req.userId!)));
  if (!project) return res.status(404).json({ error: "Project not found" });

  const rows = await db.select().from(chatSessions).where(eq(chatSessions.projectId, project.id)).orderBy(desc(chatSessions.startedAt));
  res.json({ project, sessions: rows });
});

const renameSchema = z.object({ title: z.string().min(1).max(80) });
projectsRouter.patch("/:id", async (req: AuthedRequest, res) => {
  const parsed = renameSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const [project] = await db
    .update(projects)
    .set({ title: parsed.data.title, updatedAt: new Date() })
    .where(and(eq(projects.id, req.params.id), eq(projects.userId, req.userId!)))
    .returning();
  if (!project) return res.status(404).json({ error: "Project not found" });
  res.json({ project });
});

projectsRouter.delete("/:id", async (req: AuthedRequest, res) => {
  await db.delete(projects).where(and(eq(projects.id, req.params.id), eq(projects.userId, req.userId!)));
  res.status(204).end();
});
