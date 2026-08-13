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

    isOwner: boolean("is_owner").default(false),
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
export const REPORT_SOURCES = ["user", "ai_moderation"] as const;

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
    deliveredAt: timestamp("delivered_at"),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("idx_messages_conversation_created").on(table.conversationId, table.createdAt),
  ],
);

export const messagesRelations = relations(messages, ({ one, many }) => ({
  conversation: one(conversations, { fields: [messages.conversationId], references: [conversations.id] }),
  sender: one(users, { fields: [messages.senderId], references: [users.id] }),
  attachments: many(messageAttachments),
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
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type MessageAttachment = typeof messageAttachments.$inferSelect;
export type Condition = (typeof CONDITIONS)[number];
export type Franchise = (typeof FRANCHISES)[number];
export type Courier = (typeof COURIERS)[number];
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type FriendRequestStatus = (typeof FRIEND_REQUEST_STATUSES)[number];
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];
export type MessageAttachmentType = (typeof MESSAGE_ATTACHMENT_TYPES)[number];
