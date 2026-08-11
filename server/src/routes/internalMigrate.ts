import { Router } from "express";
import { pool } from "../db";

// TEMPORARY: drizzle-kit push can't get past its interactive "truncate?"
// prompt in Render's non-interactive build shell, which has left the
// apple_id column/constraint missing in production despite several deploys.
// This lets the exact same idempotent fix from
// server/src/scripts/pre-push-migrations.ts run over HTTPS instead of
// requiring a direct Postgres connection (which isn't reachable from where
// this is being triggered from). Protected by a one-time throwaway token
// (not a real credential — this route is deleted immediately after use).
const ONE_TIME_TOKEN = "29947f165055472fe60f176b005ed34af165c68dd36f4cf0";

const STATEMENTS = [
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS apple_id text;`,
  `DO $$ BEGIN
     ALTER TABLE users ADD CONSTRAINT users_apple_id_unique UNIQUE (apple_id);
   EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
   END $$;`,
];

const router = Router();

router.post("/migrate", async (req, res) => {
  const secret = req.headers["x-migrate-secret"];
  if (secret !== ONE_TIME_TOKEN) {
    return res.status(403).json({ message: "Forbidden" });
  }
  try {
    for (const sql of STATEMENTS) {
      await pool.query(sql);
    }
    res.json({ status: "ok", applied: STATEMENTS.length });
  } catch (err) {
    console.error("internal migrate failed:", err);
    res.status(500).json({ message: err instanceof Error ? err.message : "Migration failed" });
  }
});

export default router;
