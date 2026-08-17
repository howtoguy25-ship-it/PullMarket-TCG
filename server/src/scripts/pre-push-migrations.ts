import "dotenv/config";
import { Pool } from "pg";

// drizzle-kit push has no non-interactive way to answer its "truncate this
// table?" prompt when a new unique constraint is added to a table that
// already has rows (the --force flag only covers its separate data-loss
// confirmation, not this one) — so it hangs forever in a CI/build
// environment. Applying constraint-adding changes here first, idempotently,
// means db:push sees "no changes" for them and never asks.
//
// The block below (Pro subscription / AdMob / chat reply-delete-forward-
// block) exists for a related but distinct reason: production silently ran
// several deploys behind the actual server code for a while (a Render
// deploy issue unrelated to drizzle), so real users hit "column ... does
// not exist" on routes that assumed this schema already existed. Every
// statement here is copied directly from shared/src/schema.ts and is
// idempotent (IF NOT EXISTS / DO...EXCEPTION), so re-running this against
// an already-current database is always a safe no-op.
const STATEMENTS = [
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS apple_id text;`,
  `DO $$ BEGIN
     ALTER TABLE users ADD CONSTRAINT users_apple_id_unique UNIQUE (apple_id);
   EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
   END $$;`,

  // The other two unique constraints in shared/src/schema.ts that hit the
  // exact same "truncate this table?" TTY-prompt crash the header comment
  // describes — confirmed for real on a production deploy for
  // uniq_friend_request_pair (drizzle-kit push aborted mid-build without
  // failing the build, silently skipping every statement after it, on a
  // table with all of 1 row). Adding all three here up front so db:push
  // never has anything left to ask about.
  `DO $$ BEGIN
     ALTER TABLE cart_items ADD CONSTRAINT uniq_cart_user_listing UNIQUE (user_id, listing_id);
   EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
   END $$;`,
  `DO $$ BEGIN
     ALTER TABLE friend_requests ADD CONSTRAINT uniq_friend_request_pair UNIQUE (requester_id, recipient_id);
   EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
   END $$;`,
  `DO $$ BEGIN
     ALTER TABLE conversations ADD CONSTRAINT uniq_conversation_pair UNIQUE (user_a_id, user_b_id);
   EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
   END $$;`,

  // users: 30-day username-change cooldown tracking
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS username_changed_at timestamp;`,

  // users: Pro membership + Remove Ads + read-receipts toggle
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS pro_status text NOT NULL DEFAULT 'none';`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS pro_source text;`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS pro_current_period_end timestamp;`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS pro_cancel_at_period_end boolean DEFAULT false;`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS pro_stripe_subscription_id text;`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS pro_apple_original_transaction_id text;`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS ads_removed boolean NOT NULL DEFAULT false;`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS ads_removed_source text;`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS ads_removed_stripe_payment_intent_id text;`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS ads_removed_apple_original_transaction_id text;`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS read_receipts_enabled boolean DEFAULT true;`,

  // listings: Pro 48h feed boost
  `ALTER TABLE listings ADD COLUMN IF NOT EXISTS boosted_until timestamp;`,
  `CREATE INDEX IF NOT EXISTS idx_listings_boosted ON listings (boosted_until);`,

  // listings: real pause/resume for an active paid boost
  `ALTER TABLE listings ADD COLUMN IF NOT EXISTS boost_paused boolean NOT NULL DEFAULT false;`,
  `ALTER TABLE listings ADD COLUMN IF NOT EXISTS boost_paused_remaining_ms integer;`,

  // listings: seller edit/unlist revision cap + out-of-stock auto-unlist tracking
  `ALTER TABLE listings ADD COLUMN IF NOT EXISTS revision_count integer NOT NULL DEFAULT 0;`,
  `ALTER TABLE listings ADD COLUMN IF NOT EXISTS sold_out_at timestamp;`,

  // orders: AI-verified custom/third-party tracking
  `ALTER TABLE orders ADD COLUMN IF NOT EXISTS custom_business_declared text;`,
  `ALTER TABLE orders ADD COLUMN IF NOT EXISTS custom_business_detected text;`,
  `ALTER TABLE orders ADD COLUMN IF NOT EXISTS custom_tracking_verified boolean;`,
  `ALTER TABLE orders ADD COLUMN IF NOT EXISTS custom_tracking_note text;`,

  // orders: real shipping-deadline enforcement sweep marker
  `ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_overdue_flagged_at timestamp;`,

  // messages: reply / forward / delete-for-everyone
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_message_id varchar REFERENCES messages(id) ON DELETE SET NULL;`,
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS forwarded boolean NOT NULL DEFAULT false;`,
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_for_everyone_at timestamp;`,
  `CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages (reply_to_message_id);`,

  // follows: Pro-member follow system
  `CREATE TABLE IF NOT EXISTS follows (
     follower_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     following_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at timestamp DEFAULT now(),
     PRIMARY KEY (follower_id, following_id)
   );`,
  `CREATE INDEX IF NOT EXISTS idx_follows_following ON follows (following_id);`,
  `CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows (follower_id);`,

  // message_deletions: "delete for me"
  `CREATE TABLE IF NOT EXISTS message_deletions (
     user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     message_id varchar NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
     created_at timestamp DEFAULT now(),
     PRIMARY KEY (user_id, message_id)
   );`,
  `CREATE INDEX IF NOT EXISTS idx_message_deletions_message ON message_deletions (message_id);`,

  // blocks
  `CREATE TABLE IF NOT EXISTS blocks (
     blocker_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     blocked_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at timestamp DEFAULT now(),
     PRIMARY KEY (blocker_id, blocked_id)
   );`,
  `CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks (blocked_id);`,

  // read_receipt_exclusions: per-contact read-receipt override
  `CREATE TABLE IF NOT EXISTS read_receipt_exclusions (
     user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     excluded_user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at timestamp DEFAULT now(),
     PRIMARY KEY (user_id, excluded_user_id)
   );`,

  // conversation_settings: per-user mute / archive / delete-for-me
  `CREATE TABLE IF NOT EXISTS conversation_settings (
     user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     conversation_id varchar NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
     muted_until timestamp,
     muted_forever boolean NOT NULL DEFAULT false,
     archived_at timestamp,
     deleted_at timestamp,
     updated_at timestamp DEFAULT now(),
     PRIMARY KEY (user_id, conversation_id)
   );`,

  // app_settings: single global row for owner-controlled runtime toggles
  `CREATE TABLE IF NOT EXISTS app_settings (
     id varchar PRIMARY KEY,
     review_bypass_enabled boolean NOT NULL DEFAULT true
   );`,

  // listing_boosts: paid time-tiered "top of feed" purchases
  `CREATE TABLE IF NOT EXISTS listing_boosts (
     id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
     listing_id varchar NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
     user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     tier_id text NOT NULL,
     duration_hours integer NOT NULL,
     price_cents_paid integer NOT NULL,
     pro_discount_applied boolean NOT NULL DEFAULT false,
     stripe_payment_intent_id text,
     created_at timestamp DEFAULT now()
   );`,
  `CREATE INDEX IF NOT EXISTS idx_listing_boosts_listing ON listing_boosts (listing_id);`,
  `CREATE INDEX IF NOT EXISTS idx_listing_boosts_user ON listing_boosts (user_id);`,

  // listing_boosts: Apple IAP idempotency key for boost purchases (added
  // after the table already existed in production — this is exactly the
  // case this file's header comment describes: a real purchase went
  // through with Apple and then failed server-side with "column
  // listing_boosts.apple_transaction_id does not exist" because production
  // hadn't picked this column up yet).
  `ALTER TABLE listing_boosts ADD COLUMN IF NOT EXISTS apple_transaction_id text;`,
  `DO $$ BEGIN
     ALTER TABLE listing_boosts ADD CONSTRAINT listing_boosts_apple_transaction_id_unique UNIQUE (apple_transaction_id);
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
