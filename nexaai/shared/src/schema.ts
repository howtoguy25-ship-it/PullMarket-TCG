import { relations } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  numeric,
  uuid,
  pgEnum,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const planTierEnum = pgEnum("plan_tier", ["beginner", "pro", "max"]);
export const answerModeEnum = pgEnum("answer_mode", ["strong", "extra", "normal"]);
export const messageRoleEnum = pgEnum("message_role", ["user", "assistant", "system"]);
export const messageKindEnum = pgEnum("message_kind", [
  "text",
  "voice_memo",
  "camera_ask",
  "who_is_lookup",
  "assistance_request",
]);
export const creditTxnKindEnum = pgEnum("credit_txn_kind", [
  "purchase",
  "trial_grant",
  "usage",
  "grace_overage",
  "refund",
  "adjustment",
]);
export const agentKindEnum = pgEnum("agent_kind", [
  "instagram_dm",
  "whatsapp_autoresponder",
  "generic_webhook",
  "custom",
]);
export const mapsAppEnum = pgEnum("maps_app", ["apple", "google", "trackline"]);
export const voiceGenderEnum = pgEnum("voice_gender", ["female", "male", "neutral"]);

export type AgentKind = (typeof agentKindEnum.enumValues)[number];
export type MapsAppKind = (typeof mapsAppEnum.enumValues)[number];

// ---------------------------------------------------------------------------
// Users & settings
// ---------------------------------------------------------------------------

export const users = pgTable("nexaai_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),

  // Plan / trial state
  planTier: planTierEnum("plan_tier").notNull().default("beginner"),
  trialStartedAt: timestamp("trial_started_at").notNull().defaultNow(),
  trialEndsAt: timestamp("trial_ends_at").notNull(),

  // Answer-count preference: "strong" = 1 straight-to-the-point answer,
  // "extra" = 2 answers with added context, "normal" = 3 (default).
  answerMode: answerModeEnum("answer_mode").notNull().default("normal"),

  // Settings toggles
  preferredMapsApp: mapsAppEnum("preferred_maps_app").notNull().default("apple"),
  voiceCharacterId: text("voice_character_id").notNull().default("nova-neutral"),
  proactiveCheckInEnabled: boolean("proactive_check_in_enabled").notNull().default(true),
  cameraPermissionGranted: boolean("camera_permission_granted").notNull().default(false),
  micPermissionGranted: boolean("mic_permission_granted").notNull().default(false),

  timezone: text("timezone").notNull().default("Australia/Sydney"),
});

export const usersRelations = relations(users, ({ many }) => ({
  chatSessions: many(chatSessions),
  creditTransactions: many(creditTransactions),
  agents: many(agents),
  usageWindows: many(usageWindows),
}));

// ---------------------------------------------------------------------------
// Usage windows — tracks the daily + weekly session-limit clock described in
// the product spec (resets Mon 5am Australia/Sydney; a per-session "rest"
// timer that lengthens the harder a session was pushed).
// ---------------------------------------------------------------------------

export const usageWindows = pgTable("nexaai_usage_windows", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),

  // Rolling weekly window, reset every Monday 05:00 Australia/Sydney.
  weekStartAt: timestamp("week_start_at").notNull(),
  weeklySecondsUsed: integer("weekly_seconds_used").notNull().default(0),
  weeklySecondsCap: integer("weekly_seconds_cap").notNull().default(900), // 15 min default

  // Daily session counter (spec: "3-4 uses of session limit every day").
  dayStartAt: timestamp("day_start_at").notNull(),
  sessionsUsedToday: integer("sessions_used_today").notNull().default(0),
  sessionsCapToday: integer("sessions_cap_today").notNull().default(4),

  // Credit "rest" clock: set when a session is paused for burning credits
  // too fast; the session stays paused until restUntil.
  restUntil: timestamp("rest_until"),

  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Credits — one ledger row per purchase/usage/grace event. Balance is always
// derived by summing this table, never stored denormalized, so it can't drift.
// ---------------------------------------------------------------------------

export const creditTransactions = pgTable("nexaai_credit_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: creditTxnKindEnum("kind").notNull(),
  // Positive = credit added, negative = credit spent. Stored in USD cents
  // for exactness (no float drift) even though the product surfaces dollars.
  amountCents: integer("amount_cents").notNull(),
  // Which credit pack this purchase was ($35 / $80 / $115 / $175 / custom).
  packLabel: text("pack_label"),
  paymentProvider: text("payment_provider"), // e.g. "paddle", "apple_iap"
  providerReference: text("provider_reference"),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Chat sessions & messages
// ---------------------------------------------------------------------------

export const chatSessions = pgTable("nexaai_chat_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("New chat"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  endedAt: timestamp("ended_at"),
  secondsUsed: integer("seconds_used").notNull().default(0),
  wasForcedPace: boolean("was_forced_pace").notNull().default(false),
});

export const chatSessionsRelations = relations(chatSessions, ({ one, many }) => ({
  user: one(users, { fields: [chatSessions.userId], references: [users.id] }),
  messages: many(messages),
}));

export const messages = pgTable("nexaai_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull().references(() => chatSessions.id, { onDelete: "cascade" }),
  role: messageRoleEnum("role").notNull(),
  kind: messageKindEnum("kind").notNull().default("text"),
  content: text("content").notNull(),
  // Structured extras: image URLs (camera-ask), voice memo audio URL +
  // transcript edits, assistance-request structured fields, etc.
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const messagesRelations = relations(messages, ({ one }) => ({
  session: one(chatSessions, { fields: [messages.sessionId], references: [chatSessions.id] }),
}));

// ---------------------------------------------------------------------------
// Businesses directory — seed/stub data used by the "find nearest
// assistance" flow (car trouble -> nearest mechanic, etc). A real deployment
// would swap the lookup for Google Places / Apple MapKit search.
// ---------------------------------------------------------------------------

export const businesses = pgTable("nexaai_businesses", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  category: text("category").notNull(), // "roadside_assistance", "mechanic", ...
  phone: text("phone"),
  address: text("address"),
  lat: numeric("lat", { precision: 9, scale: 6 }),
  lng: numeric("lng", { precision: 9, scale: 6 }),
  website: text("website"),
  notes: text("notes"),
});

// ---------------------------------------------------------------------------
// Custom agents — the in-app "agent builder" (IG DM automation, WhatsApp
// autoresponder, etc). Definition is stored as structured config; actually
// running an agent against a real Instagram/WhatsApp Business account
// requires the user's own API credentials for that platform (see agentRunner.ts).
// ---------------------------------------------------------------------------

export const agents = pgTable("nexaai_agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: agentKindEnum("kind").notNull(),
  isActive: boolean("is_active").notNull().default(false),
  config: jsonb("config").notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const agentsRelations = relations(agents, ({ one }) => ({
  user: one(users, { fields: [agents.userId], references: [users.id] }),
}));

// ---------------------------------------------------------------------------
// Voice characters catalog (seeded, read-mostly) — gender/tone presets users
// can switch between for TTS playback.
// ---------------------------------------------------------------------------

export const voiceCharacters = pgTable("nexaai_voice_characters", {
  id: text("id").primaryKey(), // e.g. "nova-neutral"
  displayName: text("display_name").notNull(),
  gender: voiceGenderEnum("gender").notNull(),
  tone: text("tone").notNull(), // "warm", "energetic", "calm", "direct"
  ttsVoiceId: text("tts_voice_id").notNull(), // maps to on-device expo-speech voice identifier
});
