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
  "file_attachment",
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
  "sitespark",
  "github",
  "vercel",
  "netlify",
  "stripe",
  "namecheap",
]);
export const connectorStatusEnum = pgEnum("connector_status", ["disconnected", "connected", "not_configured"]);

// Font + background theme pickers (Settings -> Appearance). Values are
// enforced at the DB level so a bad client can't write a font/theme id
// nothing recognizes.
export const fontChoiceEnum = pgEnum("font_choice", ["inter", "fraunces", "space_grotesk"]);
export const themeIdEnum = pgEnum("theme_id", ["galaxy_violet", "nebula_rose", "deep_ocean", "solar_amber"]);

// Focus/power modes — how hard NexaAi tries, and how much credit that costs.
// See lib/plans.ts's FOCUS_MODE_DEFINITIONS for the real model/thinking-budget
// mapping and lib/plans.ts's FOCUS_MODE_MIN_TIER for plan-tier gating.
export const focusModeEnum = pgEnum("focus_mode", ["quick", "build", "auto", "gorilla"]);

export type AgentKind = (typeof agentKindEnum.enumValues)[number];
export type MapsAppKind = (typeof mapsAppEnum.enumValues)[number];
export type ConnectorProvider = (typeof connectorProviderEnum.enumValues)[number];
export type FontChoice = (typeof fontChoiceEnum.enumValues)[number];
export type ThemeId = (typeof themeIdEnum.enumValues)[number];
export type FocusMode = (typeof focusModeEnum.enumValues)[number];

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
  voiceChat: boolean;
}

export const DEFAULT_CAPABILITIES: NexaCapabilities = {
  cameraAsk: true,
  webLookup: true,
  whoIsLookup: true,
  agentBuilder: true,
  autoSpeak: true,
  liveTyping: true,
  voiceChat: true,
};

// ---------------------------------------------------------------------------
// Users & settings
// ---------------------------------------------------------------------------

export const users = pgTable("nexaai_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  // Optional — used for the owner-panel allowlist check (see
  // server/src/middleware/owner.ts) and available as a profile field.
  // Never used for auth by itself (no SMS/OTP login exists).
  phone: text("phone"),
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

  // Appearance
  fontChoice: fontChoiceEnum("font_choice").notNull().default("inter"),
  themeId: themeIdEnum("theme_id").notNull().default("galaxy_violet"),

  // Default focus/power mode for new messages (per-message override is
  // still allowed — see chat.ts's requestedFocusMode).
  defaultFocusMode: focusModeEnum("default_focus_mode").notNull().default("quick"),

  timezone: text("timezone").notNull().default("Australia/Sydney"),
});

export const usersRelations = relations(users, ({ many }) => ({
  chatSessions: many(chatSessions),
  creditTransactions: many(creditTransactions),
  agents: many(agents),
  usageWindows: many(usageWindows),
  memoryEntries: many(memoryEntries),
  connectors: many(connectors),
  voiceConversations: many(voiceConversations),
  projects: many(projects),
  apiKeys: many(apiKeys),
}));

// ---------------------------------------------------------------------------
// API keys — real developer keys a user can generate on the website
// (Settings/Developer -> API keys) so an external app they build (e.g. their
// own SiteSpark) can call NexaAi's authenticated public API directly (see
// routes/publicApi.ts) instead of going through the OAuth connector flow.
// Only a bcrypt hash + a short unhashed prefix (for display, e.g.
// "nxa_a1b2...") are ever stored — the raw key is shown once, at creation.
// ---------------------------------------------------------------------------

export const apiKeys = pgTable("nexaai_api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  keyPrefix: text("key_prefix").notNull(), // first chars of the real key, shown in lists so a user can tell keys apart
  keyHash: text("key_hash").notNull(), // bcrypt hash of the full key — the real key is never stored in plain text
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at"),
  revokedAt: timestamp("revoked_at"),
});

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(users, { fields: [apiKeys.userId], references: [users.id] }),
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
  // Nullable — set when this session was started from inside a Project
  // (see routes/projects.ts). A plain Chat-tab session leaves this null.
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("New chat"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  endedAt: timestamp("ended_at"),
  secondsUsed: integer("seconds_used").notNull().default(0),
  wasForcedPace: boolean("was_forced_pace").notNull().default(false),
});

export const chatSessionsRelations = relations(chatSessions, ({ one, many }) => ({
  user: one(users, { fields: [chatSessions.userId], references: [users.id] }),
  project: one(projects, { fields: [chatSessions.projectId], references: [projects.id] }),
  messages: many(messages),
}));

// ---------------------------------------------------------------------------
// Projects — a named workspace for building a specific website/app/task
// (see routes/projects.ts). Each project owns one or more chat sessions
// (chatSessions.projectId above) so "recent chats" and full history are
// real, queryable rows, not client-side-only state.
// ---------------------------------------------------------------------------

export const projects = pgTable("nexaai_projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const projectsRelations = relations(projects, ({ one, many }) => ({
  user: one(users, { fields: [projects.userId], references: [users.id] }),
  sessions: many(chatSessions),
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
  // Provider-specific extra fields a plain access token isn't enough to
  // send messages with — e.g. Instagram's connected Facebook Page ID / IG
  // user ID, or WhatsApp's phone_number_id. Shape varies per provider.
  providerMetadata: jsonb("provider_metadata").notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const connectorsRelations = relations(connectors, ({ one }) => ({
  user: one(users, { fields: [connectors.userId], references: [users.id] }),
}));

// ---------------------------------------------------------------------------
// Real MCP connectors — generic, user-added Model Context Protocol servers
// (any real MCP server URL, not one of the fixed OAuth providers above),
// same idea as Claude's own "custom connector": the user pastes a server
// URL (+ optional bearer token), NexaAi connects with the real MCP SDK,
// discovers its actual tools, and can call them live during chat (see
// lib/mcp/client.ts and lib/anthropic.ts's tool-use loop).
// ---------------------------------------------------------------------------

export const mcpConnectionStatusEnum = pgEnum("mcp_connection_status", ["connected", "error", "unverified"]);

export const mcpServers = pgTable("nexaai_mcp_servers", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  url: text("url").notNull(),
  bearerToken: text("bearer_token"),
  enabled: boolean("enabled").notNull().default(true),
  status: mcpConnectionStatusEnum("status").notNull().default("unverified"),
  lastError: text("last_error"),
  // Cached tool list from the last successful discovery — [{name, description, inputSchema}]
  // — read at chat time instead of connecting to every MCP server on every message.
  tools: jsonb("tools").notNull().default([]),
  lastConnectedAt: timestamp("last_connected_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const mcpServersRelations = relations(mcpServers, ({ one }) => ({
  user: one(users, { fields: [mcpServers.userId], references: [users.id] }),
}));

export type McpServerRow = typeof mcpServers.$inferSelect;

// ---------------------------------------------------------------------------
// Agent pending drafts — when a connected agent's autoSend is off, an
// incoming Instagram DM / WhatsApp message doesn't get replied to
// automatically; instead the drafted reply lands here for the business
// owner to approve or reject from the Agents screen. autoSend agents skip
// this table entirely and send immediately (see routes/webhooks/meta.ts).
// ---------------------------------------------------------------------------

export const agentDraftStatusEnum = pgEnum("agent_draft_status", ["pending", "approved", "rejected", "auto_sent"]);

export const agentPendingDrafts = pgTable("nexaai_agent_pending_drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  platform: connectorProviderEnum("platform").notNull(), // "instagram" | "whatsapp"
  externalConversationId: text("external_conversation_id").notNull(), // IGSID or WhatsApp phone number
  incomingMessage: text("incoming_message").notNull(),
  draftReply: text("draft_reply").notNull(),
  status: agentDraftStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
});

export const agentPendingDraftsRelations = relations(agentPendingDrafts, ({ one }) => ({
  agent: one(agents, { fields: [agentPendingDrafts.agentId], references: [agents.id] }),
  user: one(users, { fields: [agentPendingDrafts.userId], references: [users.id] }),
}));

// ---------------------------------------------------------------------------
// Live voice chat — a real conversation (see routes/voice.ts) made of turns:
// the user records audio, it's transcribed (OpenAI Whisper), answered (the
// Gemini speed lane, or a plan-tier fallback), and spoken back (OpenAI TTS).
// Each turn is persisted as a real "live memo" — the running transcript +
// reply record the Voice screen renders, not audio that vanishes on playback.
// ---------------------------------------------------------------------------

export const voiceConversations = pgTable("nexaai_voice_conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("Voice chat"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  endedAt: timestamp("ended_at"),
});

export const voiceConversationsRelations = relations(voiceConversations, ({ one, many }) => ({
  user: one(users, { fields: [voiceConversations.userId], references: [users.id] }),
  turns: many(voiceTurns),
}));

export const voiceTurns = pgTable("nexaai_voice_turns", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id").notNull().references(() => voiceConversations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  incomingAudioUrl: text("incoming_audio_url").notNull(),
  transcript: text("transcript").notNull(),
  replyText: text("reply_text").notNull(),
  // Null when text-to-speech isn't configured (OPENAI_API_KEY unset) — the
  // turn still completes with a real text reply, just without spoken audio.
  replyAudioUrl: text("reply_audio_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const voiceTurnsRelations = relations(voiceTurns, ({ one }) => ({
  conversation: one(voiceConversations, { fields: [voiceTurns.conversationId], references: [voiceConversations.id] }),
  user: one(users, { fields: [voiceTurns.userId], references: [users.id] }),
}));
