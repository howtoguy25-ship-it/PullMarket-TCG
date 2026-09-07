import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { memoryEntries } from "@shared/schema";
import { requireAuth, type AuthedRequest } from "../middleware/auth";

export const memoryRouter = Router();
memoryRouter.use(requireAuth);

memoryRouter.get("/", async (req: AuthedRequest, res) => {
  const rows = await db
    .select()
    .from(memoryEntries)
    .where(eq(memoryEntries.userId, req.userId!))
    .orderBy(desc(memoryEntries.createdAt));
  res.json({ entries: rows });
});

memoryRouter.delete("/:id", async (req: AuthedRequest, res) => {
  await db.delete(memoryEntries).where(and(eq(memoryEntries.id, req.params.id), eq(memoryEntries.userId, req.userId!)));
  res.status(204).end();
});

memoryRouter.delete("/", async (req: AuthedRequest, res) => {
  await db.delete(memoryEntries).where(eq(memoryEntries.userId, req.userId!));
  res.status(204).end();
});
