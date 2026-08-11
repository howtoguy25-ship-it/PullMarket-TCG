import "dotenv/config";
import { Pool } from "pg";

// drizzle-kit push has no non-interactive way to answer its "truncate this
// table?" prompt when a new unique constraint is added to a table that
// already has rows (the --force flag only covers its separate data-loss
// confirmation, not this one) — so it hangs forever in a CI/build
// environment. Applying constraint-adding changes here first, idempotently,
// means db:push sees "no changes" for them and never asks.
const STATEMENTS = [
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS apple_id text;`,
  `DO $$ BEGIN
     ALTER TABLE users ADD CONSTRAINT users_apple_id_unique UNIQUE (apple_id);
   EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
   END $$;`,
];

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    for (const sql of STATEMENTS) {
      await pool.query(sql);
    }
    console.log(`Applied ${STATEMENTS.length} pre-push migration statement(s).`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("pre-push-migrations failed:", err);
  process.exit(1);
});
