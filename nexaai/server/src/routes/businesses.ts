import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthedRequest } from "../middleware/auth";
import { findNearestBusinesses } from "../lib/businessLookup";

export const businessesRouter = Router();
businessesRouter.use(requireAuth);

const querySchema = z.object({
  category: z.string().min(1),
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional(),
});

businessesRouter.get("/nearby", async (req: AuthedRequest, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const results = await findNearestBusinesses(parsed.data.category, parsed.data.lat ?? null, parsed.data.lng ?? null);
  res.json({ results });
});
