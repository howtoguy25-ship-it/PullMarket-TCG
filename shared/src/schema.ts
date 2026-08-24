import { sql, relations } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  timestamp,
  boolean,
  integer,
  jsonb,
  index,
  primaryKey,
  unique,
  doublePrecision,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { LISTING_REVISION_LIMIT } from "./validation";

// ─── Users ───────────────────────────────────────────────────────────────
// Passwordless: sign-in is phone OTP, email OTP, or Google. No password
// column exists on purpose. `username` can be changed, but at most once
// every 30 days (usernameChangedAt tracks the last change server-side).
export const users = pgTable(
  "users",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    username: text("username").notNull().unique(),
    usernameChangedAt: timestamp("username_changed_at"),
    phoneNumber: text("phone_number").unique(),
    email: text("email").unique(),
    googleId: text("google_id").unique(),
    appleId: text("apple_id").unique(),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),

    // Stripe
    stripeCustomerId: text("stripe_customer_id"),
    stripeConnectAccountId: text("stripe_connect_account_id"),
    stripeConnectOnboarded: boolean("stripe_connect_onboarded").default(false),
    stripeConnectPayoutsEnabled: boolean("stripe_connect_payouts_enabled").default(false),

    // Stripe Identity (KYC — required before a user can list items for sale)
    identityVerificationStatus: text("identity_verification_status").default("unverified"), // 'unverified' | 'pending' | 'verified' | 'failed'
    identityVerificationSessionId: text("identity_verification_session_id"),
    identityVerifiedAt: timestamp("identity_verified_at"),

    // Paid "Pro" membership ($19.99/mo) — unrelated to franchiseSubscriptions
    // below (that's the free per-user "new card alert" feature; this is
    // real recurring billing). A user can be Pro via either billing
    // system, never both — proSource says which one is authoritative for
    // proStatus/proCurrentPeriodEnd right now. Web purchases run through
    // Stripe (routes/subscription.ts + the subscription branch of
    // webhook.ts); iOS purchases run through Apple's StoreKit + the App
    // Store Server Notifications webhook (routes/appleSubscription.ts) —
    // Apple requires digital in-app perks like these to go through IAP,
    // not a third-party processor, when purchased from inside the native
    // app (App Store Review Guideline 3.1.1).
    proStatus: text("pro_status").notNull().default("none"), // 'none' | 'active' | 'past_due' | 'canceled'
    proSource: text("pro_source"), // 'stripe' | 'apple', null when proStatus is 'none'
    proCurrentPeriodEnd: timestamp("pro_current_period_end"),
    proCancelAtPeriodEnd: boolean("pro_cancel_at_period_end").default(false),
    proStripeSubscriptionId: text("pro_stripe_subscription_id"),
    // Apple's stable per-purchase identifier for a subscription — the
    // right key to dedupe/look up by for IAP (not the transaction id,
    // which changes every renewal).
    proAppleOriginalTransactionId: text("pro_apple_original_transaction_id"),

    // Remove Ads — a one-time $39.99 purchase (not recurring, so no period
    // fields needed). Same dual-billing-system shape as the Pro fields
    // above and for the same reason: Stripe on web, real Apple IAP
    // (non-consumable) on iOS.
    adsRemoved: boolean("ads_removed").notNull().default(false),
    adsRemovedSource: text("ads_removed_source"), // 'stripe' | 'apple', null when adsRemoved is false
    adsRemovedStripePaymentIntentId: text("ads_removed_stripe_payment_intent_id"),
    adsRemovedAppleOriginalTransactionId: text("ads_removed_apple_original_transaction_id"),

    isOwner: boolean("is_owner").default(false),
    // Lifetime Card Hunt points — real points credited the moment the
    // owner approves a find (see huntClaims.pointsAwarded), never
    // recomputed or estimated; this column is just the running sum.
    points: integer("points").notNull().default(0),
    isSuspended: boolean("is_suspended").default(false),
    suspendedAt: timestamp("suspended_at"),
    suspensionReason: text("suspension_reason"),

    tokenVersion: integer("token_version").default(0),

    pushToken: text("push_token"),
    notificationsEnabled: boolean("notifications_enabled").default(true),
    // Global switch: when off, this user's read/seen status is never
    // revealed to anyone they chat with (see readReceiptExclusions below
    // for the per-contact version of the same thing).
    readReceiptsEnabled: boolean("read_receipts_enabled").default(true),

    pendingDeletionAt: timestamp("pending_deletion_at"),
    deletedAt: timestamp("deleted_at"),

    createdAt: timestamp("created_at").defaultNow(),
    lastSeen: timestamp("last_seen").defaultNow(),
  },
  (table) => [
    index("idx_users_phone").on(table.phoneNumber),
    index("idx_users_email").on(table.email),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  listings: many(listings),
  favorites: many(favorites),
  cartItems: many(cartItems),
  notifications: many(notifications),
  franchiseSubscriptions: many(franchiseSubscriptions),
  sentFriendRequests: many(friendRequests, { relationName: "requester" }),
  receivedFriendRequests: many(friendRequests, { relationName: "recipient" }),
}));

// ─── OTP codes (email + SMS) ─────────────────────────────────────────────
export const otpCodes = pgTable(
  "otp_codes",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    destination: text("destination").notNull(), // phone E.164 or email address
    channel: text("channel").notNull(), // 'sms' | 'email'
    code: text("code").notNull(),
    purpose: text("purpose").notNull().default("signin"), // 'signin' | 'signup'
    attempts: integer("attempts").default(0),
    consumed: boolean("consumed").default(false),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [index("idx_otp_destination").on(table.destination)],
);

// ─── Listings ────────────────────────────────────────────────────────────
export const CONDITIONS = ["brand_new", "great_condition", "used"] as const;
export const FRANCHISES = ["pokemon", "one_piece"] as const;
// "removed" is an owner/moderation takedown (see routes/owner.ts) — distinct
// from a seller's own "unlisted" (paused, can relist) or "deleted" (seller
// took it down for good). Keeping these separate means a moderation action
// never gets accidentally undone by a seller's own relist/edit flow.
export const LISTING_STATUSES = ["active", "sold_out", "removed", "unlisted", "deleted"] as const;

export const listings = pgTable(
  "listings",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    sellerId: varchar("seller_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    // Derived at create-time from the title/description (must contain
    // "pokemon" or "one piece" — enforced server-side, see listings routes).
    franchise: text("franchise").notNull(), // 'pokemon' | 'one_piece' | 'both'
    priceCents: integer("price_cents").notNull(),
    condition: text("condition").notNull(), // one of CONDITIONS
    quantityTotal: integer("quantity_total").notNull().default(1),
    quantityAvailable: integer("quantity_available").notNull().default(1),
    status: text("status").notNull().default("active"), // one of LISTING_STATUSES
    viewCount: integer("view_count").notNull().default(0),
    favoriteCount: integer("favorite_count").notNull().default(0),
    // Counts unlist actions + real field edits (price/desc/title/condition/
    // qty) combined, capped at LISTING_REVISION_LIMIT — see PATCH/:id and
    // POST /:id/unlist in routes/listings.ts. Relisting itself is free.
    revisionCount: integer("revision_count").notNull().default(0),
    // Set the moment quantityAvailable first hits 0 (a real sale or the
    // seller zeroing their own stock), cleared the moment it's restocked.
    // Drives the 3-day auto-unlist sweep in lib/autoUnlist.ts — a listing
    // sitting out of stock this long with no seller action comes off the
    // marketplace on its own.
    soldOutAt: timestamp("sold_out_at"),
    // Whenever this is set and in the future, the homepage feed sorts the
    // listing first. Two independent things can set it: (1) the free
    // Pro-membership perk — a fixed one-time 48h window from creation, only
    // granted if the seller was an active Pro member at that moment (see
    // POST / in routes/listings.ts), never extended/renewed after; and (2)
    // a real paid boost purchase (see routes/boost.ts + webhook.ts), which
    // EXTENDS this from whichever is later — now or the current
    // boostedUntil — so stacking multiple paid boosts (or buying one while
    // the free Pro perk is still active) adds up rather than overwriting.
    boostedUntil: timestamp("boosted_until"),
    // A real pause: boostedUntil is cleared (so isBoosted immediately goes
    // false — no sponsored placement while paused) and the exact time that
    // was left gets frozen here in milliseconds. Resuming sets boostedUntil
    // back to now + boostPausedRemainingMs, picking up exactly where it left
    // off. If the window fully ran out before anyone paused it, boostedUntil
    // just ends up in the past — genuinely finished, nothing to resume.
    boostPaused: boolean("boost_paused").notNull().default(false),
    boostPausedRemainingMs: integer("boost_paused_remaining_ms"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
    // Owner-only internal note (moderation/follow-up context) — never
    // exposed on any public listings route, only /api/owner/*.
    ownerNote: text("owner_note"),
  },
  (table) => [
    index("idx_listings_seller").on(table.sellerId),
    index("idx_listings_status").on(table.status),
    index("idx_listings_franchise").on(table.franchise),
    index("idx_listings_created").on(table.createdAt),
    index("idx_listings_boosted").on(table.boostedUntil),
  ],
);

export const listingsRelations = relations(listings, ({ one, many }) => ({
  seller: one(users, { fields: [listings.sellerId], references: [users.id] }),
  images: many(listingImages),
}));

// ─── eBay-sourced listings ───────────────────────────────────────────────
// Real live eBay inventory, synced periodically via lib/ebay.ts. Kept in
// its own table — never merged into `listings` at the storage level — so a
// user's own listing data is never mixed with third-party eBay data; the
// two are only interleaved at feed-render time (see routes/listings.ts).
// "Buying" one of these hands the user off to eBay's own checkout via an
// affiliate link built fresh at read time — this app never touches the
// payment or holds any eBay item in its own inventory.
export const ebayListings = pgTable(
  "ebay_listings",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    ebayItemId: text("ebay_item_id").notNull().unique(),
    title: text("title").notNull(),
    franchise: text("franchise").notNull(), // one of FRANCHISES
    priceCents: integer("price_cents").notNull(),
    currency: text("currency").notNull(),
    condition: text("condition"),
    imageUrl: text("image_url"),
    // eBay's own item page — deliberately NOT affiliate-tagged here, so a
    // Campaign ID arriving later (or ever changing) applies retroactively
    // to every already-synced row without a re-sync.
    itemWebUrl: text("item_web_url").notNull(),
    sellerUsername: text("seller_username"),
    // Updated on every sync pass that still finds this item; a row not
    // touched in a while is a listing that's ended/sold on eBay itself —
    // see sweepStaleEbayListings in lib/ebay.ts.
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [index("idx_ebay_listings_franchise").on(table.franchise), index("idx_ebay_listings_last_seen").on(table.lastSeenAt)],
);

// ─── Card Hunt (paid real-world geo-hunt game) ───────────────────────────
// The owner hides 1 or 2 real physical cards, sells paid entries, then
// reveals real photos + a radius circle per card around a real captured
// GPS location. Each card is its own "target" with its own winner — a
// 2-card game can have two different winners. A claim only counts once
// the owner approves it (self-declared wins would be trivially
// game-able); approving one awards real points (see users.points) with a
// speed bonus for a fast find. Only one game is ever live at a time.
export const HUNT_GAME_STATUSES = ["entry_open", "revealed", "ended"] as const;
export const HUNT_CLAIM_STATUSES = ["pending", "approved", "rejected"] as const;
export const HUNT_REACTION_MESSAGES = ["good_game", "almost_there", "ill_be_back", "youre_lucky", "congratulations"] as const;

export const huntGames = pgTable("hunt_games", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  status: text("status").notNull().default("entry_open"), // one of HUNT_GAME_STATUSES
  entryPriceCents: integer("entry_price_cents").notNull(), // one of HUNT_PRICE_TIERS_CENTS, enforced server-side
  cardCount: integer("card_count").notNull().default(1), // 1 or 2 — how many separate hunt_targets this game has
  // Point rules the owner sets per game (prefilled from the last game's
  // values, same reuse pattern as price) — a real find is never a fixed
  // number regardless of what the owner wants this game to be worth.
  basePoints: integer("base_points").notNull().default(100),
  speedBonusThresholdMinutes: integer("speed_bonus_threshold_minutes").notNull().default(5),
  speedBonusPoints: integer("speed_bonus_points").notNull().default(50),
  // Display-only deadline shown to entrants as "reveal coming soon"
  // pressure — the owner's own Send action is what actually reveals (see
  // revealedAt), not this timestamp, so a late owner never auto-breaks the
  // game and an early owner isn't blocked from revealing sooner.
  countdownEndsAt: timestamp("countdown_ends_at").notNull(),
  revealedAt: timestamp("revealed_at"),
  endedAt: timestamp("ended_at"), // set once every target has an approved winner
  // endedAt + 15 minutes — the leaderboard is only ever fetchable up to
  // this instant; computed at read time (see routes/hunt.ts), not swept by
  // a background job, since there's nothing destructive to clean up.
  leaderboardExpiresAt: timestamp("leaderboard_expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// One row per hidden card within a game (1 or 2, per huntGames.cardCount)
// — its own photos, its own real GPS location + radius, its own winner.
export const huntTargets = pgTable(
  "hunt_targets",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    gameId: varchar("game_id").notNull().references(() => huntGames.id, { onDelete: "cascade" }),
    index: integer("index").notNull(), // 0 or 1 — which of the game's cards this is
    latitude: doublePrecision("latitude"), // set at reveal
    longitude: doublePrecision("longitude"),
    radiusMeters: integer("radius_meters"),
    winnerUserId: varchar("winner_user_id").references(() => users.id),
    wonAt: timestamp("won_at"),
  },
  (table) => [unique("uq_hunt_target_game_index").on(table.gameId, table.index)],
);

export const huntTargetImages = pgTable("hunt_target_images", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  targetId: varchar("target_id").notNull().references(() => huntTargets.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  position: integer("position").notNull().default(0), // 0-2, max 3 images per card
  createdAt: timestamp("created_at").defaultNow(),
});

export const huntEntries = pgTable(
  "hunt_entries",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    gameId: varchar("game_id").notNull().references(() => huntGames.id, { onDelete: "cascade" }),
    userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    priceCentsPaid: integer("price_cents_paid").notNull(),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    paidAt: timestamp("paid_at"), // null until the webhook confirms payment
    // One canned reaction a losing entrant can send to a winner once the
    // game has ended — see HUNT_REACTION_MESSAGES. Null until sent; each
    // entrant can only send one, ever, for a given game (not per-target).
    reactionMessage: text("reaction_message"),
    reactionSentAt: timestamp("reaction_sent_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [unique("uq_hunt_entry_game_user").on(table.gameId, table.userId), index("idx_hunt_entries_game").on(table.gameId)],
);

// A "found it" claim against one specific target — a user can have at
// most one non-rejected claim per target at a time (see the partial
// index below), but can resubmit after a rejection.
export const huntClaims = pgTable(
  "hunt_claims",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    targetId: varchar("target_id").notNull().references(() => huntTargets.id, { onDelete: "cascade" }),
    userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    imageUrl: text("image_url").notNull(),
    status: text("status").notNull().default("pending"), // one of HUNT_CLAIM_STATUSES
    claimedAt: timestamp("claimed_at").defaultNow(),
    reviewedAt: timestamp("reviewed_at"),
    // Real points actually credited to the user when this claim was
    // approved — recorded on the claim itself (not just summed live) so a
    // user's hunt history can show exactly what each win was worth, even
    // if the game's point rules changed for later games.
    pointsAwarded: integer("points_awarded"),
  },
  (table) => [index("idx_hunt_claims_target").on(table.targetId), index("idx_hunt_claims_user").on(table.userId)],
);

export const listingImages = pgTable(
  "listing_images",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    listingId: varchar("listing_id").notNull().references(() => listings.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    position: integer("position").notNull().default(0), // 0-5, display order
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [index("idx_listing_images_listing").on(table.listingId)],
);

export const listingImagesRelations = relations(listingImages, ({ one }) => ({
  listing: one(listings, { fields: [listingImages.listingId], references: [listings.id] }),
}));

// ─── Listing boosts ──────────────────────────────────────────────────────
// A real-money purchase record for pushing a listing to the top of the
// marketplace feed for a fixed window — every purchase (Stripe-confirmed)
// gets a row here, purely for history/receipts; the actual live effect is
// applying listings.boostedUntil (see routes/webhook.ts), which is what the
// feed's sort actually reads. Multiple boosts on the same listing stack —
// each purchase extends boostedUntil from whichever is later, now or the
// current boostedUntil, rather than overwriting an still-active boost.
export const listingBoosts = pgTable(
  "listing_boosts",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    listingId: varchar("listing_id").notNull().references(() => listings.id, { onDelete: "cascade" }),
    userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tierId: text("tier_id").notNull(), // one of BOOST_TIERS ids, see shared/validation.ts
    durationHours: integer("duration_hours").notNull(),
    priceCentsPaid: integer("price_cents_paid").notNull(), // after any Pro discount — the real amount charged
    proDiscountApplied: boolean("pro_discount_applied").notNull().default(false),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    // Apple's transaction id for an in-app-purchased boost (iOS) — same
    // idempotency role as stripePaymentIntentId above, just for the other
    // payment rail. A unique constraint lets Postgres itself reject a
    // double-credit if the client ever retries a verify call, on top of the
    // explicit pre-check the route already does.
    appleTransactionId: text("apple_transaction_id").unique(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [index("idx_listing_boosts_listing").on(table.listingId), index("idx_listing_boosts_user").on(table.userId)],
);

export const listingBoostsRelations = relations(listingBoosts, ({ one }) => ({
  listing: one(listings, { fields: [listingBoosts.listingId], references: [listings.id] }),
  user: one(users, { fields: [listingBoosts.userId], references: [users.id] }),
}));

// ─── App settings ────────────────────────────────────────────────────────
// A single global row (id is always the literal "global") for app-wide
// toggles an owner needs to flip live, without a redeploy. Currently just
// the App Review sign-in bypass (see server/src/lib/otp.ts) — the owner
// panel lets it be switched off once Apple's review is done, so the fixed
// test phone number/code stops working for anyone else.
export const appSettings = pgTable("app_settings", {
  id: varchar("id").primaryKey(),
  reviewBypassEnabled: boolean("review_bypass_enabled").notNull().default(true),
});

// ─── Favorites ───────────────────────────────────────────────────────────
export const favorites = pgTable(
  "favorites",
  {
    userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    listingId: varchar("listing_id").notNull().references(() => listings.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.listingId] }),
    index("idx_favorites_user").on(table.userId),
    index("idx_favorites_listing").on(table.listingId),
  ],
);

export const favoritesRelations = relations(favorites, ({ one }) => ({
  user: one(users, { fields: [favorites.userId], references: [users.id] }),
  listing: one(listings, { fields: [favorites.listingId], references: [listings.id] }),
}));

// ─── Cart ────────────────────────────────────────────────────────────────
export const cartItems = pgTable(
  "cart_items",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    listingId: varchar("listing_id").notNull().references(() => listings.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull().default(1),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    unique("uniq_cart_user_listing").on(table.userId, table.listingId),
    index("idx_cart_user").on(table.userId),
  ],
);

export const cartItemsRelations = relations(cartItems, ({ one }) => ({
  user: one(users, { fields: [cartItems.userId], references: [users.id] }),
  listing: one(listings, { fields: [cartItems.listingId], references: [listings.id] }),
}));

// ─── Orders ──────────────────────────────────────────────────────────────
// One order = one seller's items from a single checkout (a multi-seller
// cart is split into one order per seller because Stripe Connect transfers
// go to a single destination account per PaymentIntent/Checkout Session).
export const ORDER_STATUSES = [
  "pending_payment",
  "paid",
  "shipped",
  "delivered",
  "refund_requested",
  "refunded",
  "cancelled",
] as const;
export const COURIERS = ["australia_post", "dhl", "fedex", "other", "custom"] as const;

export const orders = pgTable(
  "orders",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    buyerId: varchar("buyer_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    sellerId: varchar("seller_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending_payment"),

    subtotalCents: integer("subtotal_cents").notNull(),
    platformFeeCents: integer("platform_fee_cents").notNull(),
    totalCents: integer("total_cents").notNull(),

    stripeCheckoutSessionId: text("stripe_checkout_session_id"),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    stripeTransferId: text("stripe_transfer_id"),

    // Shipping / tracking — tracking number is mandatory before an order can
    // be marked shipped; courier selection is optional ("other" if unknown).
    courier: text("courier"), // one of COURIERS, nullable until seller ships
    trackingNumber: text("tracking_number"),
    boxSizeLabel: text("box_size_label"), // 'small' | 'medium' | 'large' | free text

    // "Custom tracking" (courier === "custom"): for third-party sellers
    // shipping via a courier not in the fixed list. The seller declares
    // which business it's from; Claude checks whether the tracking
    // number's format is actually consistent with that declared business
    // and the result is stored as a disclosed note — this is AI pattern
    // matching against known tracking-number formats, not a live carrier
    // API lookup, same honesty caveat as the format-only regex checks for
    // the fixed couriers (see lib/carrierDetection.ts).
    customBusinessDeclared: text("custom_business_declared"),
    customBusinessDetected: text("custom_business_detected"),
    customTrackingVerified: boolean("custom_tracking_verified"),
    customTrackingNote: text("custom_tracking_note"),

    // Buyer's delivery address — collected by Stripe Checkout itself
    // (shipping_address_collection) and copied over from the completed
    // session in the webhook handler, so the seller has what they need to
    // actually box and post the order.
    shippingName: text("shipping_name"),
    shippingPhone: text("shipping_phone"),
    shippingLine1: text("shipping_line1"),
    shippingLine2: text("shipping_line2"),
    shippingCity: text("shipping_city"),
    shippingState: text("shipping_state"),
    shippingPostalCode: text("shipping_postal_code"),
    shippingCountry: text("shipping_country"),

    shippingDeadline: timestamp("shipping_deadline"), // createdAt + 5 business days, set on payment
    shippedAt: timestamp("shipped_at"),
    deliveredAt: timestamp("delivered_at"),
    // Set once by the shipping-deadline sweeper (see lib/shippingDeadlineSweeper.ts)
    // the first time it finds this order still unpaid-for-shipping past its
    // deadline — an auto-generated report is filed for the owner and both
    // sides are notified. Prevents re-flagging the same order every sweep.
    shippingOverdueFlaggedAt: timestamp("shipping_overdue_flagged_at"),

    refundRequestedAt: timestamp("refund_requested_at"),
    refundReason: text("refund_reason"),
    refundedAt: timestamp("refunded_at"),

    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_orders_buyer").on(table.buyerId),
    index("idx_orders_seller").on(table.sellerId),
    index("idx_orders_status").on(table.status),
  ],
);

export const ordersRelations = relations(orders, ({ one, many }) => ({
  buyer: one(users, { fields: [orders.buyerId], references: [users.id], relationName: "buyer" }),
  seller: one(users, { fields: [orders.sellerId], references: [users.id], relationName: "seller" }),
  items: many(orderItems),
}));

export const orderItems = pgTable(
  "order_items",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    orderId: varchar("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
    listingId: varchar("listing_id").references(() => listings.id, { onDelete: "set null" }),
    titleSnapshot: text("title_snapshot").notNull(),
    priceCentsSnapshot: integer("price_cents_snapshot").notNull(),
    imageUrlSnapshot: text("image_url_snapshot"),
    quantity: integer("quantity").notNull().default(1),
  },
  (table) => [index("idx_order_items_order").on(table.orderId)],
);

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  listing: one(listings, { fields: [orderItems.listingId], references: [listings.id] }),
}));

// ─── Notifications ───────────────────────────────────────────────────────
export const notifications = pgTable(
  "notifications",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // 'purchase' | 'sale' | 'shipped' | 'delivered' | 'new_listing_match' | 'refund' | 'report_update'
    title: text("title").notNull(),
    body: text("body").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().default({}),
    isRead: boolean("is_read").default(false),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_notifications_user").on(table.userId),
    index("idx_notifications_user_read").on(table.userId, table.isRead),
  ],
);

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));

// Per-user subscription to "new card" alerts for a franchise, so we know who
// to notify when a matching listing goes live.
export const franchiseSubscriptions = pgTable(
  "franchise_subscriptions",
  {
    userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    franchise: text("franchise").notNull(), // 'pokemon' | 'one_piece'
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.franchise] })],
);

export const franchiseSubscriptionsRelations = relations(franchiseSubscriptions, ({ one }) => ({
  user: one(users, { fields: [franchiseSubscriptions.userId], references: [users.id] }),
}));

// Per-contact read-receipt override: a row (userId, excludedUserId) means
// userId does not want excludedUserId to see when userId has read
// excludedUserId's messages — even if userId's global readReceiptsEnabled
// is on. Directional and independent per person: the other side of a
// conversation manages their own rows the same way.
export const readReceiptExclusions = pgTable(
  "read_receipt_exclusions",
  {
    userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    excludedUserId: varchar("excluded_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.excludedUserId] })],
);

export const readReceiptExclusionsRelations = relations(readReceiptExclusions, ({ one }) => ({
  user: one(users, { fields: [readReceiptExclusions.userId], references: [users.id], relationName: "excluder" }),
  excludedUser: one(users, { fields: [readReceiptExclusions.excludedUserId], references: [users.id], relationName: "excluded" }),
}));

// ─── Reports (listing/order/chat reports → owner panel) ─────────────────
export const REPORT_STATUSES = ["pending", "reviewed", "actioned", "dismissed"] as const;
export const REPORT_SOURCES = ["user", "ai_moderation", "system"] as const;

export const reports = pgTable(
  "reports",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    // Null for AI-generated reports — there's no reporting user, the
    // moderation pass itself flagged the content.
    reporterId: varchar("reporter_id").references(() => users.id, { onDelete: "cascade" }),
    source: text("source").notNull().default("user"), // one of REPORT_SOURCES
    listingId: varchar("listing_id").references(() => listings.id, { onDelete: "set null" }),
    orderId: varchar("order_id").references(() => orders.id, { onDelete: "set null" }),
    conversationId: varchar("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    reportedUserId: varchar("reported_user_id").references(() => users.id, { onDelete: "set null" }),
    messageId: varchar("message_id").references(() => messages.id, { onDelete: "set null" }),
    reason: text("reason").notNull(), // 'counterfeit' | 'not_as_described' | 'never_received' | 'scam' | 'inappropriate' | 'harassment' | 'other'
    description: text("description").notNull(),
    // Set when source is 'ai_moderation' — the classifier's own explanation
    // for why the message was flagged, shown to the owner for review.
    aiReasoning: text("ai_reasoning"),
    status: text("status").notNull().default("pending"),
    ownerNotes: text("owner_notes"),
    ownerReplySentAt: timestamp("owner_reply_sent_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_reports_status").on(table.status),
    index("idx_reports_reporter").on(table.reporterId),
  ],
);

export const reportsRelations = relations(reports, ({ one }) => ({
  reporter: one(users, { fields: [reports.reporterId], references: [users.id], relationName: "reportReporter" }),
  listing: one(listings, { fields: [reports.listingId], references: [listings.id] }),
  order: one(orders, { fields: [reports.orderId], references: [orders.id] }),
  conversation: one(conversations, { fields: [reports.conversationId], references: [conversations.id] }),
  reportedUser: one(users, { fields: [reports.reportedUserId], references: [users.id], relationName: "reportReportedUser" }),
  message: one(messages, { fields: [reports.messageId], references: [messages.id] }),
}));

// ─── Friend requests ─────────────────────────────────────────────────────
export const FRIEND_REQUEST_STATUSES = ["pending", "accepted", "declined"] as const;

export const friendRequests = pgTable(
  "friend_requests",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    requesterId: varchar("requester_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    recipientId: varchar("recipient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"), // one of FRIEND_REQUEST_STATUSES
    createdAt: timestamp("created_at").defaultNow(),
    respondedAt: timestamp("responded_at"),
  },
  (table) => [
    unique("uniq_friend_request_pair").on(table.requesterId, table.recipientId),
    index("idx_friend_requests_requester").on(table.requesterId),
    index("idx_friend_requests_recipient").on(table.recipientId),
  ],
);

export const friendRequestsRelations = relations(friendRequests, ({ one }) => ({
  requester: one(users, { fields: [friendRequests.requesterId], references: [users.id], relationName: "requester" }),
  recipient: one(users, { fields: [friendRequests.recipientId], references: [users.id], relationName: "recipient" }),
}));

// ─── Follows (Pro-membership perk) ───────────────────────────────────────
// Anyone can follow, but only an active Pro member can BE followed — the
// route layer enforces that at follow-time (see routes/follows.ts); this
// table itself doesn't encode that restriction so a follow doesn't become
// orphaned/invalid if the followed user's Pro membership later lapses
// (their existing followers stay, they just can't gain new ones while
// inactive — matches how the boosted-listing window isn't retroactively
// revoked either).
export const follows = pgTable(
  "follows",
  {
    followerId: varchar("follower_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    followingId: varchar("following_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.followerId, table.followingId] }),
    index("idx_follows_following").on(table.followingId),
    index("idx_follows_follower").on(table.followerId),
  ],
);

export const followsRelations = relations(follows, ({ one }) => ({
  follower: one(users, { fields: [follows.followerId], references: [users.id], relationName: "followFollower" }),
  following: one(users, { fields: [follows.followingId], references: [users.id], relationName: "followFollowing" }),
}));

// ─── Chat: conversations, messages, attachments ─────────────────────────
// A 1:1 conversation is created the first time either user messages the
// other. `userAId`/`userBId` are stored in a normalized order (userAId is
// always the lexicographically-smaller id) purely so a unique constraint on
// the pair works regardless of who initiated — application code never
// exposes that ordering to clients. Until the recipient accepts, the thread
// behaves like a "message request": the initiator can send, the recipient
// can read without the initiator seeing a read receipt, and the recipient
// gets an Accept/Decline choice.
export const CONVERSATION_STATUSES = ["pending", "accepted", "declined"] as const;

export const conversations = pgTable(
  "conversations",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userAId: varchar("user_a_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    userBId: varchar("user_b_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    initiatorId: varchar("initiator_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"), // one of CONVERSATION_STATUSES
    lastMessageAt: timestamp("last_message_at").defaultNow(),
    lastMessagePreview: text("last_message_preview"),
    respondedAt: timestamp("responded_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    unique("uniq_conversation_pair").on(table.userAId, table.userBId),
    index("idx_conversations_a").on(table.userAId),
    index("idx_conversations_b").on(table.userBId),
  ],
);

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  userA: one(users, { fields: [conversations.userAId], references: [users.id], relationName: "convUserA" }),
  userB: one(users, { fields: [conversations.userBId], references: [users.id], relationName: "convUserB" }),
  initiator: one(users, { fields: [conversations.initiatorId], references: [users.id], relationName: "convInitiator" }),
  messages: many(messages),
}));

export const CALL_STATUSES = ["ringing", "accepted", "declined", "missed", "ended"] as const;

// One row per audio call attempt — created the moment the caller invites,
// updated as the callee answers/declines/it times out, and closed out when
// either side hangs up. The actual audio never touches this server (that's
// a direct WebRTC peer connection between the two devices); this table and
// the WebSocket signaling server (server/src/lib/callSignaling.ts) only
// carry the connection-setup handshake and call history.
export const calls = pgTable(
  "calls",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    conversationId: varchar("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    callerId: varchar("caller_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    calleeId: varchar("callee_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("ringing"), // one of CALL_STATUSES
    isVideo: boolean("is_video").notNull().default(false),
    startedAt: timestamp("started_at").defaultNow(),
    answeredAt: timestamp("answered_at"),
    endedAt: timestamp("ended_at"),
  },
  (table) => [
    index("idx_calls_conversation").on(table.conversationId),
    index("idx_calls_caller").on(table.callerId),
    index("idx_calls_callee").on(table.calleeId),
  ],
);

export const callsRelations = relations(calls, ({ one }) => ({
  conversation: one(conversations, { fields: [calls.conversationId], references: [conversations.id] }),
  caller: one(users, { fields: [calls.callerId], references: [users.id], relationName: "callCaller" }),
  callee: one(users, { fields: [calls.calleeId], references: [users.id], relationName: "callCallee" }),
}));

export const messages = pgTable(
  "messages",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    conversationId: varchar("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    senderId: varchar("sender_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    text: text("text"),
    // Set by the AI moderation pass (see server/src/lib/moderation.ts) when
    // a message looks like a scam/fraud attempt or abusive language. Flagged
    // messages still deliver normally — moderation never blocks a message —
    // this only surfaces a quiet indicator and opens an owner-review report.
    flagged: boolean("flagged").notNull().default(false),
    // The message this one is a reply to, if any — null once the target is
    // gone (deleted-for-everyone, or the row itself deleted) so a reply
    // never dangles; the client just shows "Original message deleted".
    replyToMessageId: varchar("reply_to_message_id").references((): AnyPgColumn => messages.id, { onDelete: "set null" }),
    // True for a message created by the forward action (POST
    // /messages/:id/forward) rather than typed fresh — purely cosmetic, so
    // the recipient's bubble can show a small "Forwarded" label.
    forwarded: boolean("forwarded").notNull().default(false),
    // "Delete for everyone" (sender-only, within 24h — enforced in the
    // route, not here): text/attachments are cleared and this is stamped,
    // so every participant's client renders "This message was deleted"
    // instead of the original content. Distinct from "delete for me" (see
    // messageDeletions below), which is per-viewer and never touches the
    // row itself.
    deletedForEveryoneAt: timestamp("deleted_for_everyone_at"),
    deliveredAt: timestamp("delivered_at"),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_messages_conversation_created").on(table.conversationId, table.createdAt),
    index("idx_messages_reply_to").on(table.replyToMessageId),
  ],
);

export const messagesRelations = relations(messages, ({ one, many }) => ({
  conversation: one(conversations, { fields: [messages.conversationId], references: [conversations.id] }),
  sender: one(users, { fields: [messages.senderId], references: [users.id] }),
  attachments: many(messageAttachments),
  replyToMessage: one(messages, { fields: [messages.replyToMessageId], references: [messages.id], relationName: "messageReply" }),
}));

// "Delete for me": a row here means userId no longer sees messageId in
// their own message list — the row itself (and everyone else's view of it)
// is untouched. Deleting the same message twice is a harmless no-op
// (onConflictDoNothing at the route level), hence the composite PK.
export const messageDeletions = pgTable(
  "message_deletions",
  {
    userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    messageId: varchar("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.messageId] }), index("idx_message_deletions_message").on(table.messageId)],
);

export const messageDeletionsRelations = relations(messageDeletions, ({ one }) => ({
  user: one(users, { fields: [messageDeletions.userId], references: [users.id] }),
  message: one(messages, { fields: [messageDeletions.messageId], references: [messages.id] }),
}));

// ─── Blocks ──────────────────────────────────────────────────────────────
// A row means blockerId has blocked blockedId: blockedId can no longer
// message or friend-request blockerId (checked both directions in the
// chat/friends routes — a block is only ever effective one-way, same as
// every real chat app, so the blocked person isn't tipped off that they
// were the one who got blocked vs. just never getting a reply).
export const blocks = pgTable(
  "blocks",
  {
    blockerId: varchar("blocker_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    blockedId: varchar("blocked_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.blockerId, table.blockedId] }), index("idx_blocks_blocked").on(table.blockedId)],
);

export const blocksRelations = relations(blocks, ({ one }) => ({
  blocker: one(users, { fields: [blocks.blockerId], references: [users.id], relationName: "blockBlocker" }),
  blocked: one(users, { fields: [blocks.blockedId], references: [users.id], relationName: "blockBlocked" }),
}));

// ─── Per-user conversation settings (mute / archive / delete) ───────────
// One row per (userId, conversationId), created lazily on first use (see
// upsertConversationSetting in routes/chat.ts) — everything here is scoped
// to the viewer only, so muting/archiving/deleting a chat never affects
// what the other participant sees.
//
// Mute: mutedForever=true means "Always"; otherwise mutedUntil holds the
// expiry (5m/1h/3h/.../48h from when it was set) — a chat is currently
// muted iff mutedForever OR (mutedUntil is set and still in the future).
// "Never" clears both fields back to their unmuted defaults rather than
// deleting the row, since archivedAt/deletedAt may still need it.
//
// Archive / delete: archivedAt/deletedAt just being set means "hidden from
// the main inbox as of this timestamp" — both auto-clear (the chat
// reappears) the moment a NEW message arrives after that timestamp,
// exactly like WhatsApp, rather than requiring an explicit unarchive for
// every future message.
export const conversationSettings = pgTable(
  "conversation_settings",
  {
    userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    conversationId: varchar("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    mutedUntil: timestamp("muted_until"),
    mutedForever: boolean("muted_forever").notNull().default(false),
    archivedAt: timestamp("archived_at"),
    deletedAt: timestamp("deleted_at"),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.conversationId] })],
);

export const conversationSettingsRelations = relations(conversationSettings, ({ one }) => ({
  user: one(users, { fields: [conversationSettings.userId], references: [users.id] }),
  conversation: one(conversations, { fields: [conversationSettings.conversationId], references: [conversations.id] }),
}));

export const MESSAGE_ATTACHMENT_TYPES = ["image", "video"] as const;

export const messageAttachments = pgTable(
  "message_attachments",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    messageId: varchar("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    type: text("type").notNull(), // one of MESSAGE_ATTACHMENT_TYPES
    position: integer("position").notNull().default(0),
  },
  (table) => [index("idx_message_attachments_message").on(table.messageId)],
);

export const messageAttachmentsRelations = relations(messageAttachments, ({ one }) => ({
  message: one(messages, { fields: [messageAttachments.messageId], references: [messages.id] }),
}));

// ─── Zod insert schemas ──────────────────────────────────────────────────
export const insertListingSchema = createInsertSchema(listings).pick({
  title: true,
  description: true,
  priceCents: true,
  condition: true,
  quantityTotal: true,
});

export const insertReportSchema = createInsertSchema(reports).pick({
  listingId: true,
  orderId: true,
  conversationId: true,
  reportedUserId: true,
  reason: true,
  description: true,
});

// ─── Types ───────────────────────────────────────────────────────────────
export type User = typeof users.$inferSelect;
export type Listing = typeof listings.$inferSelect;
export type ListingImage = typeof listingImages.$inferSelect;
export type Favorite = typeof favorites.$inferSelect;
export type CartItem = typeof cartItems.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type Report = typeof reports.$inferSelect;
export type OtpCode = typeof otpCodes.$inferSelect;
export type FriendRequest = typeof friendRequests.$inferSelect;
export type Follow = typeof follows.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type MessageAttachment = typeof messageAttachments.$inferSelect;
export type MessageDeletion = typeof messageDeletions.$inferSelect;
export type Block = typeof blocks.$inferSelect;
export type ConversationSetting = typeof conversationSettings.$inferSelect;
export type AppSettings = typeof appSettings.$inferSelect;
export type Condition = (typeof CONDITIONS)[number];
export type Franchise = (typeof FRANCHISES)[number];
export type Courier = (typeof COURIERS)[number];
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type FriendRequestStatus = (typeof FRIEND_REQUEST_STATUSES)[number];
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];
export type MessageAttachmentType = (typeof MESSAGE_ATTACHMENT_TYPES)[number];
