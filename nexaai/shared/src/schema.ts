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
  uniqueIndex,
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
  "image_generation",
]);
export const creditTxnKindEnum = pgEnum("credit_txn_kind", [
  "purchase",
  "trial_grant",
  "usage",
  "grace_overage",
  "refund",
  "adjustment",
]);
export const creditDisputeStatusEnum = pgEnum("credit_dispute_status", ["approved", "declined"]);
export const agentKindEnum = pgEnum("agent_kind", [
  "instagram_dm",
  "whatsapp_autoresponder",
  "facebook_messenger_dm",
  "slack_dm",
  "x_dm",
  "generic_webhook",
  "custom",
]);
export const mapsAppEnum = pgEnum("maps_app", ["apple", "google", "trackline"]);
export const voiceGenderEnum = pgEnum("voice_gender", ["female", "male", "neutral"]);
export const voiceChannelEnum = pgEnum("voice_channel", ["app", "phone"]);
export const connectorProviderEnum = pgEnum("connector_provider", [
  "google",
  "notion",
  "slack",
  "instagram",
  "whatsapp",
  "facebook_messenger",
  "sitespark",
  "github",
  "vercel",
  "netlify",
  "stripe",
  "namecheap",
  "x",
  "twilio",
]);
export const connectorStatusEnum = pgEnum("connector_status", ["disconnected", "connected", "not_configured"]);

// Font + background theme pickers (Settings -> Appearance). Values are
// enforced at the DB level so a bad client can't write a font/theme id
// nothing recognizes. themeId is intentionally just two values — a single
// neutral Claude-style design system (see client/src/theme/palettes.ts),
// not a picker of colorful accent themes.
export const fontChoiceEnum = pgEnum("font_choice", ["inter", "fraunces", "space_grotesk"]);
// "dark" (labeled "Original" in the picker) is the app's established look;
// "black" is a true-black AMOLED-style option added alongside it; "light"
// (labeled "White") is the existing bright theme.
export const themeIdEnum = pgEnum("theme_id", ["dark", "light", "black"]);

// Focus/power modes — how hard NexaAi tries, and how much credit that costs.
// See lib/plans.ts's FOCUS_MODE_DEFINITIONS for the real model/thinking-budget
// mapping and lib/plans.ts's FOCUS_MODE_MIN_TIER for plan-tier gating.
export const focusModeEnum = pgEnum("focus_mode", ["quick", "build", "auto", "gorilla"]);
// The owner panel's real, app-wide "how hard is the AI allowed to think"
// throttle — see server/src/lib/anthropic.ts's reasoning-effort-cap logic.
// null (via ownerSettings.reasoningEffortCap being nullable) = uncapped,
// same as today; "max" is also effectively uncapped but is a distinct,
// selectable "top of the range" state for the owner UI's low->max slider.
export const reasoningEffortCapEnum = pgEnum("reasoning_effort_cap", ["low", "standard", "high", "max"]);

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
  // Real, live web-search-sourced images embedded alongside normal chat
  // answers about a real-world topic — see server/src/lib/anthropic.ts's
  // enableTopicImages wiring. Off by default: it's an opt-in extra (real
  // web_search tool calls), not something every reply should incur.
  topicImages: boolean;
  // Real "Hey Nexa, build me a website" detection in plain Chat (see
  // server/src/lib/build/detectSiteBuildRequest.ts) — auto-creates a real
  // Project, builds it (asking first if the request is too vague), and
  // auto-pushes to SiteSpark when connected. Its spoken reply (see
  // ChatScreen.tsx) is independent of the general autoSpeak toggle above —
  // this one narrates specifically its own build replies.
  smartBuild: boolean;
  // Real AI image generation in plain Chat — see
  // server/src/lib/imageGen/detectImageGenerationRequest.ts (the intent
  // detector) and server/src/lib/imageGeneration.ts (the real gpt-image-2
  // call). On by default: a genuine per-image credit charge gates it, not
  // this toggle alone.
  imageGeneration: boolean;
}

export const DEFAULT_CAPABILITIES: NexaCapabilities = {
  cameraAsk: true,
  webLookup: true,
  whoIsLookup: true,
  agentBuilder: true,
  autoSpeak: true,
  liveTyping: true,
  voiceChat: true,
  topicImages: false,
  smartBuild: true,
  imageGeneration: true,
};

// ---------------------------------------------------------------------------
// Users & settings
// ---------------------------------------------------------------------------

export const users = pgTable("nexaai_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  // Used for the owner-panel allowlist check (server/src/middleware/owner.ts)
  // and as a real sign-in identity: server/src/lib/socialAuth/phone.ts sends
  // a real Twilio Verify SMS code and, on success, finds-or-creates the
  // account by this column exactly like the OAuth providers below.
  // Deliberately *not* a DB-level unique constraint — adding one to an
  // already-populated table makes drizzle-kit's `db:push` stop and ask an
  // interactive "truncate this table?" question, which hangs forever in
  // Render's non-interactive preDeployCommand and would fail every future
  // deploy. findOrCreateSocialUser (lib/socialAuth/common.ts) is the one
  // and only code path that ever writes this column, and it always looks
  // up by phone before inserting, so uniqueness holds in practice without
  // needing the DB to enforce it.
  phone: text("phone"),
  phoneVerifiedAt: timestamp("phone_verified_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),

  // Real "forgot password" flow (routes/auth.ts forgot-password/reset-password).
  // Only ever holds a sha256 hash of the one-time token actually emailed to
  // the user (lib/email.ts) — never the raw token itself — plus its expiry;
  // both are cleared the moment the token is used or a new one is requested.
  passwordResetTokenHash: text("password_reset_token_hash"),
  passwordResetExpiresAt: timestamp("password_reset_expires_at"),

  // Real social sign-in identity links (server/src/lib/socialAuth/) — the
  // stable per-provider user id, so a returning social sign-in finds the
  // same account even on a later visit where the provider doesn't resend
  // the email (Apple only sends it the very first time). A social-only
  // account still gets a real passwordHash above — a securely random one
  // nobody is ever told, since the column is NOT NULL and password login
  // simply isn't offered for that account.
  appleUserId: text("apple_user_id").unique(),
  googleAuthId: text("google_auth_id").unique(),
  githubAuthId: text("github_auth_id").unique(),

  // Plan / trial state
  planTier: planTierEnum("plan_tier").notNull().default("beginner"),
  trialStartedAt: timestamp("trial_started_at").notNull().defaultNow(),
  trialEndsAt: timestamp("trial_ends_at").notNull(),
  // Real subscription tracking for Pro/Max — null/null means the free
  // beginner tier, never paid. Set by a genuine completed Paddle checkout
  // (routes/webhooks/paddle.ts) or a verified Apple IAP transaction
  // (routes/plans.ts's /apple/verify) — see lib/planExpiry.ts for how this
  // is used to lazily downgrade a lapsed subscription back to beginner
  // without needing a dedicated cron job.
  planSource: text("plan_source"), // "paddle" | "stripe" | "apple" | null
  planCurrentPeriodEnd: timestamp("plan_current_period_end"),
  planPaddleSubscriptionId: text("plan_paddle_subscription_id"),
  planStripeSubscriptionId: text("plan_stripe_subscription_id"),
  planAppleOriginalTransactionId: text("plan_apple_original_transaction_id"),

  // Real auto-recharge (server/src/lib/autoRecharge.ts). paddleCustomerId is
  // captured off the real Paddle webhook the first time this user completes
  // any transaction — it's what lets a later top-up charge their already-
  // saved payment method with no checkout redirect at all. There's no iOS
  // equivalent of that: Apple's StoreKit flatly disallows a server- or app-
  // initiated purchase with no on-device tap, so the app-side behavior for
  // an Apple-only user is "auto-prompt the real purchase sheet the moment
  // the balance crosses the threshold," not a silent charge — a real
  // platform constraint, not a corner cut here.
  autoRechargeEnabled: boolean("auto_recharge_enabled").notNull().default(false),
  autoRechargeThresholdCents: integer("auto_recharge_threshold_cents").notNull().default(200),
  autoRechargePackLabel: text("auto_recharge_pack_label").notNull().default("$35"),
  paddleCustomerId: text("paddle_customer_id"),
  stripeCustomerId: text("stripe_customer_id"),
  // Claimed right before firing an off-session charge, cleared once the
  // real Paddle/Stripe webhook fulfills it — a lightweight lock so a burst of
  // spends while the balance is low doesn't fire the same top-up charge
  // several times before the first one's webhook lands. A stale claim
  // (something failed silently and the webhook never came) expires on its
  // own after AUTO_RECHARGE_COOLDOWN_MS (lib/autoRecharge.ts) rather than
  // blocking every future top-up forever.
  autoRechargeInFlightAt: timestamp("auto_recharge_in_flight_at"),

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

  // Real, server-persisted state for the two Smart Build in-chat banners
  // (ChatScreen.tsx) — same durable pattern as onboardingCompletedAt above,
  // not client-local storage, so it survives a reinstall/new device.
  // smartBuildIntroDismissedAt: the first-open "here's what Smart Build
  // does" banner, shown once until dismissed (X, or picking on/off).
  // smartBuildFirstRunAt: set the moment Smart Build actually completes its
  // first real auto-build — this is what triggers the second banner.
  // smartBuildFollowUpDismissedAt: that second "now that you've seen it,
  // keep it on?" banner, shown once after smartBuildFirstRunAt.
  smartBuildIntroDismissedAt: timestamp("smart_build_intro_dismissed_at"),
  smartBuildFirstRunAt: timestamp("smart_build_first_run_at"),
  smartBuildFollowUpDismissedAt: timestamp("smart_build_follow_up_dismissed_at"),

  // Appearance
  fontChoice: fontChoiceEnum("font_choice").notNull().default("inter"),
  themeId: themeIdEnum("theme_id").notNull().default("dark"),

  // Default focus/power mode for new messages (per-message override is
  // still allowed — see chat.ts's requestedFocusMode).
  defaultFocusMode: focusModeEnum("default_focus_mode").notNull().default("quick"),

  timezone: text("timezone").notNull().default("Australia/Sydney"),

  // A real, model-generated nickname for the empty-chat greeting (see
  // routes/chat.ts's GET /nickname) — regenerated at most once per real
  // calendar day so it varies day to day without a wasted model call on
  // every screen open. cachedNicknameDate is the YYYY-MM-DD (the user's
  // own local date, from the client) it was generated for.
  cachedNickname: text("cached_nickname"),
  cachedNicknameDate: text("cached_nickname_date"),

  // Real owner-panel leverage over this specific account (server/src/routes/
  // owner.ts) — see middleware/auth.ts's requireAuth for where these are
  // actually enforced on every authenticated request, not just checked at
  // login. tokenVersion is bumped by a real "force sign-out" action:
  // every JWT embeds the tokenVersion it was issued with, so bumping this
  // instantly invalidates every token already issued for this user,
  // including ones for sessions the owner has no other way to reach.
  isSuspended: boolean("is_suspended").notNull().default(false),
  suspendedReason: text("suspended_reason"),
  suspendedAt: timestamp("suspended_at"),
  tokenVersion: integer("token_version").notNull().default(0),
});

export const usersRelations = relations(users, ({ many }) => ({
  chatSessions: many(chatSessions),
  creditTransactions: many(creditTransactions),
  creditDisputes: many(creditDisputes),
  agents: many(agents),
  usageWindows: many(usageWindows),
  memoryEntries: many(memoryEntries),
  connectors: many(connectors),
  voiceConversations: many(voiceConversations),
  projects: many(projects),
  apiKeys: many(apiKeys),
  supportConversations: many(supportConversations),
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

// Real Claude-style rolling usage window (see lib/plans.ts's
// USAGE_WINDOW_HOURS and lib/usageClock.ts): a message sent while there's
// no active window (windowStartAt null, or the last one has aged past the
// window length) starts a fresh one; every real chat turn during an
// active window increments messagesUsedInWindow. No fixed daily/weekly
// clock, no per-tier "rest" penalty — a plain rolling cap, like Claude.
export const usageWindows = pgTable("nexaai_usage_windows", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  windowStartAt: timestamp("window_start_at"),
  messagesUsedInWindow: integer("messages_used_in_window").notNull().default(0),
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
  // Real link from a "usage" spend to the exact user message it charged for
  // — set right after that message row exists (routes/chat.ts). This is
  // what lib/creditDisputes.ts's automatic billing-error check and the
  // real "report an issue" flow both key off: without it, a dispute has
  // nothing concrete to verify against. Null for non-chat spends (voice,
  // API) and for any "usage" row from before this column existed.
  messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Credit disputes — "no money refunds, but real, AI-reviewed credit
// refunds" (see lib/creditDisputes.ts). A user reports a specific reply
// they believe was a real billing error; the review looks only at
// structural facts about that one transaction (did a reply exist, how
// long was it, what was charged vs. the real cost formula) plus the
// user's own free-text description — never the actual message/reply
// content, so this is a genuine backend billing check, not a content
// judgment. Every dispute (approved or declined) is kept permanently and
// is visible in the Owner panel with its real reasoning.
// ---------------------------------------------------------------------------

export const creditDisputes = pgTable("nexaai_credit_disputes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  creditTransactionId: uuid("credit_transaction_id").references(() => creditTransactions.id, { onDelete: "set null" }),
  description: text("description").notNull(),
  status: creditDisputeStatusEnum("status").notNull(),
  reasoning: text("reasoning").notNull(),
  refundedCents: integer("refunded_cents").notNull().default(0),
  refundTransactionId: uuid("refund_transaction_id").references(() => creditTransactions.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const creditDisputesRelations = relations(creditDisputes, ({ one }) => ({
  user: one(users, { fields: [creditDisputes.userId], references: [users.id] }),
}));

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
  // Real, persisted "what the user is currently working on" for this
  // session — set once (e.g. the "Help me plan something" flow) and fed
  // into every later turn's system context (routes/chat.ts's prepareTurn)
  // so NexaAi keeps helping toward it instead of drifting, until the user
  // explicitly cancels it (a real "Cancel task" action, or a clear stop
  // phrase — see prepareTurn's CANCEL_TASK_RE) clears it back to null.
  activeTask: text("active_task"),
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
  files: many(projectFiles),
}));

// Real, persisted file tree for a Project — this IS the project's "session
// memory" for code building: parsed straight out of build_project mode's
// fenced ```lang filename="..."``` blocks (see routes/chat.ts's finish()
// and lib/projectFiles.ts) and upserted by path, so the accumulated
// codebase survives across sessions instead of living only in chat
// transcript. What gets exported to SiteSpark (routes/projects.ts's
// /:id/export/sitespark) is exactly these rows, not re-derived from text.
export const projectFiles = pgTable(
  "nexaai_project_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    content: text("content").notNull(),
    language: text("language"), // the fence's language tag (html/css/js/...), display-only
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    uniqueProjectPath: uniqueIndex("project_files_project_id_path_idx").on(table.projectId, table.path),
  }),
);

export const projectFilesRelations = relations(projectFiles, ({ one }) => ({
  project: one(projects, { fields: [projectFiles.projectId], references: [projects.id] }),
}));

export type ProjectFileRow = typeof projectFiles.$inferSelect;

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
  // Real "delete" from the user-facing History screen (routes/history.ts) is
  // a SOFT delete: it hides the message from that user's own history/session
  // view, it never actually erases the row. This is deliberate, not a bug —
  // see the History section of the README: NexaAi keeps a permanent internal
  // record of every prompt/image/video ever sent (visible to the account
  // owner via the Owner panel's History section, routes/owner.ts), while
  // still giving users a real, working "remove this from my history" action.
  // Actual erasure only happens via real account deletion (routes/auth.ts's
  // delete-account, which cascade-deletes the whole session tree for real).
  hiddenAt: timestamp("hidden_at"),
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
  // The real "stay out of my way" switch — separate from isActive (which
  // controls whether the agent exists/is wired at all): flipping this on
  // silences it completely (no draft, no send, not even a queued draft)
  // across every conversation, for whenever the owner wants to personally
  // chat through the connected platform's own app without NexaAi jumping
  // in. See lib/agents/agentRunner.ts's runAgentTurn.
  isPaused: boolean("is_paused").notNull().default(false),
  config: jsonb("config").notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const agentsRelations = relations(agents, ({ one }) => ({
  user: one(users, { fields: [agents.userId], references: [users.id] }),
}));

// ---------------------------------------------------------------------------
// Per-conversation human takeover — the automatic counterpart to
// agents.isPaused: when the real account owner replies directly through a
// platform's own native inbox (detected via Meta's message_echoes — see
// routes/webhooks/meta.ts), NexaAi silences ITS OWN replies for that one
// conversation for a real 5-minute window, refreshed every time another
// genuine human echo arrives, so it doesn't talk over someone the owner is
// actively helping. One row per (agentId, externalConversationId) —
// upserted, never duplicated.
// ---------------------------------------------------------------------------

export const agentConversationTakeovers = pgTable(
  "nexaai_agent_conversation_takeovers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    externalConversationId: text("external_conversation_id").notNull(),
    takeoverUntil: timestamp("takeover_until").notNull(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    uniqueConversation: uniqueIndex("agent_conversation_takeovers_agent_conv_idx").on(table.agentId, table.externalConversationId),
  }),
);

export const agentConversationTakeoversRelations = relations(agentConversationTakeovers, ({ one }) => ({
  agent: one(agents, { fields: [agentConversationTakeovers.agentId], references: [agents.id] }),
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
  // Real "authorise control" gate, not cosmetic: while true (the default),
  // lib/mcp/toolBridge.ts excludes this server's write-shaped tools
  // (create/update/delete/write/push/deploy/send/...) from what the model
  // is even given — so NexaAi cannot call them at all — until the user
  // turns this off for that server in Connectors, explicitly authorising it
  // to take real actions there. Read-only tools are never gated.
  requireApproval: boolean("require_approval").notNull().default(true),
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
  channel: voiceChannelEnum("channel").notNull().default("app"),
  externalCallSid: text("external_call_sid"),
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
  // Null on a real "greeting" turn (routes/voice.ts's POST .../greeting) —
  // NexaAi speaking first when a live Call connects, genuinely has no
  // incoming user audio/transcript to attach, so this stays honestly null
  // rather than a fake placeholder value.
  incomingAudioUrl: text("incoming_audio_url"),
  transcript: text("transcript"),
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

// ---------------------------------------------------------------------------
// Multi-agent in-app help & support (Settings -> Help & Support) — separate
// from `agents` above on purpose: those are outward-facing autoresponders
// the user builds to message real customers on Instagram/WhatsApp/Slack/X.
// This is the opposite direction — real specialized support personas
// (server/src/lib/supportPersonas.ts) NexaAi's own user talks to when they
// need help with the app itself (billing, a bug, their account/privacy, or
// general feedback), each with genuinely different system-prompt knowledge
// of that part of the app, not one generic bot wearing four different name
// tags.
// ---------------------------------------------------------------------------

export const supportAgentTypeEnum = pgEnum("support_agent_type", ["billing", "technical", "account", "general"]);
export type SupportAgentType = (typeof supportAgentTypeEnum.enumValues)[number];

export const supportConversations = pgTable("nexaai_support_conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  agentType: supportAgentTypeEnum("agent_type").notNull(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const supportConversationsRelations = relations(supportConversations, ({ one, many }) => ({
  user: one(users, { fields: [supportConversations.userId], references: [users.id] }),
  messages: many(supportMessages),
}));

export const supportMessages = pgTable("nexaai_support_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => supportConversations.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const supportMessagesRelations = relations(supportMessages, ({ one }) => ({
  conversation: one(supportConversations, { fields: [supportMessages.conversationId], references: [supportConversations.id] }),
}));

// ---------------------------------------------------------------------------
// Owner settings — a real, single-row, app-wide control panel the owner
// panel (server/src/routes/owner.ts, website/owner.html) reads and writes.
// These are genuine kill-switches and a real reasoning-effort ceiling, not
// cosmetic: every field here is actually checked at the real enforcement
// point it names (see each route/lib file's own comment for exactly where).
// A feature toggle here ANDs with the user's own per-account capability —
// turning a feature off here turns it off for every user regardless of
// their own setting; it does not turn a feature ON for someone who has it
// off themselves.
// ---------------------------------------------------------------------------

export const ownerSettings = pgTable("nexaai_owner_settings", {
  // Always exactly one row, id "singleton" — see server/src/lib/ownerSettings.ts.
  id: text("id").primaryKey().default("singleton"),

  // Real per-feature app-wide kill switches.
  webLookupEnabled: boolean("web_lookup_enabled").notNull().default(true), // gates caps.webLookup/whoIsLookup/topicImages in routes/chat.ts
  voiceChatEnabled: boolean("voice_chat_enabled").notNull().default(true), // gates routes/voice.ts
  agentBuilderEnabled: boolean("agent_builder_enabled").notNull().default(true), // gates routes/agents.ts create+activate
  memoryEnabled: boolean("memory_enabled").notNull().default(true), // gates lib/memory.ts
  smartBuildEnabled: boolean("smart_build_enabled").notNull().default(true), // gates caps.smartBuild in routes/chat.ts
  newSignupsEnabled: boolean("new_signups_enabled").notNull().default(true), // gates routes/auth.ts POST /signup

  // Real reasoning-effort ceiling applied to every Anthropic call app-wide —
  // see lib/anthropic.ts's resolveEffectiveThinkingBudget. Null = uncapped
  // (today's plan/focus-mode defaults apply exactly as before).
  reasoningEffortCap: reasoningEffortCapEnum("reasoning_effort_cap"),

  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
