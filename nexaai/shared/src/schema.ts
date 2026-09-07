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
export const connectorProviderEnum = pgEnum("connector_provider", [
  "google",
  "notion",
  "slack",
  "instagram",
  "whatsapp",
]);
export const connectorStatusEnum = pgEnum("connector_status", ["disconnected", "connected", "not_configured"]);

export type AgentKind = (typeof agentKindEnum.enumValues)[number];
export type MapsAppKind = (typeof mapsAppEnum.enumValues)[number];
export type ConnectorProvider = (typeof connectorProviderEnum.enumValues)[number];

// The real, toggleable features on the "Capabilities" screen — each one
// gates an actual code path server-side (see middleware/capabilities.ts),
// not just a cosmetic switch.
export interface NexaCapabilities {
  cameraAsk: boolean;
  webLookup: boolean;
  whoIsLookup: boolean;
  agentBuilder: boolean;
  autoSpeak: boolean;
  liveTyping: boolean;
}

export const DEFAULT_CAPABILITIES: NexaCapabilities = {
  cameraAsk: true,
  webLookup: true,
  whoIsLookup: true,
  agentBuilder: true,
  autoSpeak: true,
  liveTyping: true,
};

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

  // Real, per-feature on/off switches — see NexaCapabilities above.
  capabilities: jsonb("capabilities").notNull().default({}),

  // Memory: NexaAi can save durable facts about a user across chats. Off by
  // default in the strictest sense — `memoryEnabled` gates whether anything
  // is ever written; `referenceChatsEnabled` gates whether saved memory is
  // read back into future conversations; `includeSensitiveInMemory` gates
  // whether health/religion/etc-adjacent facts are eligible to be saved at all.
  memoryEnabled: boolean("memory_enabled").notNull().default(true),
  referenceChatsEnabled: boolean("reference_chats_enabled").notNull().default(true),
  includeSensitiveInMemory: boolean("include_sensitive_in_memory").notNull().default(false),

  onboardingCompletedAt: timestamp("onboarding_completed_at"),

  timezone: text("timezone").notNull().default("Australia/Sydney"),
});

export const usersRelations = relations(users, ({ many }) => ({
  chatSessions: many(chatSessions),
  creditTransactions: many(creditTransactions),
  agents: many(agents),
  usageWindows: many(usageWindows),
  memoryEntries: many(memoryEntries),
  connectors: many(connectors),
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

// ---------------------------------------------------------------------------
// Memory core — durable facts NexaAi has learned about a user from past
// chats (e.g. "prefers metric units", "owns a 2019 Mazda 3"), written by
// lib/memory.ts after a turn and optionally read back into future system
// prompts. Each row is independently deletable from the Memory Files screen.
// ---------------------------------------------------------------------------

export const memoryEntries = pgTable("nexaai_memory_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  isSensitive: boolean("is_sensitive").notNull().default(false),
  sourceSessionId: uuid("source_session_id").references(() => chatSessions.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const memoryEntriesRelations = relations(memoryEntries, ({ one }) => ({
  user: one(users, { fields: [memoryEntries.userId], references: [users.id] }),
}));

// ---------------------------------------------------------------------------
// Connectors — links a user's NexaAi account to another platform so NexaAi
// can pull real data in (e.g. Google Calendar events) or an agent can act on
// it. Google is wired to a real OAuth Authorization Code flow (see
// lib/connectors/google.ts); the rest are honest "not configured" stubs
// until an admin adds that platform's own developer credentials.
//
// NOTE ON TOKEN STORAGE: access/refresh tokens are stored as plain text here
// to keep this scaffold's schema readable. A real production deployment
// MUST encrypt these at rest (e.g. pgcrypto or an application-level KMS)
// before going live with real user accounts.
// ---------------------------------------------------------------------------

export const connectors = pgTable("nexaai_connectors", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: connectorProviderEnum("provider").notNull(),
  status: connectorStatusEnum("status").notNull().default("disconnected"),
  externalAccountLabel: text("external_account_label"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at"),
  connectedAt: timestamp("connected_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const connectorsRelations = relations(connectors, ({ one }) => ({
  user: one(users, { fields: [connectors.userId], references: [users.id] }),
}));
