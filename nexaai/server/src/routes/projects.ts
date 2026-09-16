// Real Projects: a named workspace for building one specific site/app,
// distinct from the general Chat tab. Each project owns real chat sessions
// (schema's chatSessions.projectId) so "recent chats" and full history are
// queryable rows, not client-side-only state.

import { Router } from "express";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { db } from "../db";
import { projects, chatSessions, messages, projectFiles, connectors } from "@shared/schema";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { pushProjectToSiteSpark } from "../lib/connectors/sitespark";

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

// The project's real, persisted file tree (lib/projectFiles.ts) — what
// build_project mode has actually accumulated, not a re-parse of chat text.
projectsRouter.get("/:id/files", async (req: AuthedRequest, res) => {
  const [project] = await db.select().from(projects).where(and(eq(projects.id, req.params.id), eq(projects.userId, req.userId!)));
  if (!project) return res.status(404).json({ error: "Project not found" });
  const files = await db.select().from(projectFiles).where(eq(projectFiles.projectId, project.id)).orderBy(projectFiles.path);
  res.json({ files });
});

// Real rename — updates the actual stored path, checked against the
// project's other files so a rename can't silently clobber an existing one.
const renameFileSchema = z.object({ path: z.string().min(1).max(300) });
projectsRouter.patch("/:id/files/:fileId", async (req: AuthedRequest, res) => {
  const parsed = renameFileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const [project] = await db.select().from(projects).where(and(eq(projects.id, req.params.id), eq(projects.userId, req.userId!)));
  if (!project) return res.status(404).json({ error: "Project not found" });

  const [file] = await db.select().from(projectFiles).where(and(eq(projectFiles.id, req.params.fileId), eq(projectFiles.projectId, project.id)));
  if (!file) return res.status(404).json({ error: "File not found" });

  const [collision] = await db
    .select()
    .from(projectFiles)
    .where(and(eq(projectFiles.projectId, project.id), eq(projectFiles.path, parsed.data.path)));
  if (collision && collision.id !== file.id) {
    return res.status(409).json({ error: "path_taken", message: `${parsed.data.path} already exists in this project.` });
  }

  const [updated] = await db.update(projectFiles).set({ path: parsed.data.path, updatedAt: new Date() }).where(eq(projectFiles.id, file.id)).returning();
  res.json({ file: updated });
});

// Real export: pushes the project's current files into the user's own
// connected SiteSpark account (see lib/connectors/sitespark.ts's
// pushProjectToSiteSpark for the exact contract SiteSpark's side must
// implement). Fails honestly — no fake "exported!" — when there's nothing
// to export, SiteSpark isn't connected, or SiteSpark's API rejects it.
projectsRouter.post("/:id/export/sitespark", async (req: AuthedRequest, res) => {
  const [project] = await db.select().from(projects).where(and(eq(projects.id, req.params.id), eq(projects.userId, req.userId!)));
  if (!project) return res.status(404).json({ error: "Project not found" });

  const files = await db.select().from(projectFiles).where(eq(projectFiles.projectId, project.id));
  if (!files.length) {
    return res.status(400).json({ error: "no_files", message: "This project hasn't generated any files yet — ask NexaAi to build something first." });
  }

  const [connector] = await db
    .select()
    .from(connectors)
    .where(and(eq(connectors.userId, req.userId!), eq(connectors.provider, "sitespark"), eq(connectors.status, "connected")));
  if (!connector?.accessToken) {
    return res.status(400).json({ error: "sitespark_not_connected", message: "Connect your SiteSpark account in Connectors first." });
  }

  try {
    const result = await pushProjectToSiteSpark(connector.accessToken, {
      externalRef: project.id,
      name: project.title,
      files: files.map((f) => ({ path: f.path, content: f.content })),
    });
    res.json({ siteId: result.siteId, url: result.url, fileCount: files.length });
  } catch (err) {
    res.status(502).json({ error: "sitespark_export_failed", message: err instanceof Error ? err.message : "SiteSpark export failed." });
  }
});
