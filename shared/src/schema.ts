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
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── Users ───────────────────────────────────────────────────────────────
// Passwordless: sign-in is phone OTP, email OTP, or Google. No password
// column exists on purpose. `username` is chosen once at first sign-up and
// is what other users see attached to listings/orders.
export const users = pgTable(
  "users",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    username: text("username").notNull().unique(),
    phoneNumber: text("phone_number").unique(),
    email: text("email").unique(),
    googleId: text("google_id").unique(),
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

    isOwner: boolean("is_owner").default(false),
    isSuspended: boolean("is_suspended").default(false),
    suspendedAt: timestamp("suspended_at"),
    suspensionReason: text("suspension_reason"),

    tokenVersion: integer("token_version").default(0),

    pushToken: text("push_token"),
    notificationsEnabled: boolean("notifications_enabled").default(true),

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
export const LISTING_STATUSES = ["active", "sold_out", "removed"] as const;

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
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_listings_seller").on(table.sellerId),
    index("idx_listings_status").on(table.status),
    index("idx_listings_franchise").on(table.franchise),
    index("idx_listings_created").on(table.createdAt),
  ],
);

export const listingsRelations = relations(listings, ({ one, many }) => ({
  seller: one(users, { fields: [listings.sellerId], references: [users.id] }),
  images: many(listingImages),
}));

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
export const COURIERS = ["australia_post", "dhl", "fedex", "other"] as const;

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

    shippingDeadline: timestamp("shipping_deadline"), // createdAt + 5 business days, set on payment
    shippedAt: timestamp("shipped_at"),
    deliveredAt: timestamp("delivered_at"),

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

// ─── Reports (listing reports → owner panel) ────────────────────────────
export const REPORT_STATUSES = ["pending", "reviewed", "actioned", "dismissed"] as const;

export const reports = pgTable(
  "reports",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    reporterId: varchar("reporter_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    listingId: varchar("listing_id").references(() => listings.id, { onDelete: "set null" }),
    orderId: varchar("order_id").references(() => orders.id, { onDelete: "set null" }),
    reason: text("reason").notNull(), // 'counterfeit' | 'not_as_described' | 'never_received' | 'scam' | 'inappropriate' | 'other'
    description: text("description").notNull(),
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
  reporter: one(users, { fields: [reports.reporterId], references: [users.id] }),
  listing: one(listings, { fields: [reports.listingId], references: [listings.id] }),
  order: one(orders, { fields: [reports.orderId], references: [orders.id] }),
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
export type Condition = (typeof CONDITIONS)[number];
export type Franchise = (typeof FRANCHISES)[number];
export type Courier = (typeof COURIERS)[number];
export type OrderStatus = (typeof ORDER_STATUSES)[number];
