# NexaAi

A galaxy-themed AI assistant app: real-time chat + voice with a custom bot character, camera "ask about this photo",
tiered plans (Beginner/Pro/Max) with credit-based billing and session limits, a custom-agent builder, and a
companion account website. A fully self-contained project — nothing in it depends on another app's code.

This README is written the same way the root repo's README is: it tells you plainly what's real and working today,
what's real but needs your own third-party account/credentials, and what's a clearly-marked stub because it's not
technically possible to fully build inside a coding session (hardware access, App Store review, another company's
private data).

## What's here

```
client/    Expo app (React Native + react-native-web) — the mobile/web AI chat app
server/    Express API (TypeScript, Drizzle ORM, Postgres)
shared/    Drizzle schema shared by client and server
website/   Small static site for account/credits/settings (no chat here — see below)
```

## Real, working end-to-end

- Email/password signup + login, 2-day free trial with a starter credit grant, and a one-time animated onboarding
  walkthrough (real typewriter-style text reveal) the first time a new account opens the app
- Real-time chat with NexaAi (a custom SVG-drawn bot character, not a stock asset) backed by the real Anthropic
  Claude API, streamed token-by-token over Server-Sent Events (Anthropic's real streaming API, not a client-side
  reveal effect) — text in, a genuinely **structured** answer out: every approach is broken down into the same
  labeled parts every time (Title, Description, Image findings when a photo's attached, Reasoning, then Steps) —
  see "The hybrid model architecture" below for why this exact structure is also what the self-hosted Llama model
  is being trained to reproduce, with an animated "thinking… tinkering… gathering info…" state while waiting
- A bot avatar that actually talks: its mouth opens/closes in an irregular loop while tokens are streaming in, and
  again while `expo-speech`'s own playback callbacks confirm audio is actually sounding out — not a decorative loop
  that runs regardless of state
- Answer-count toggle: 1 ("strong, straight to the point"), 2 ("extra info"), or 3 (normal) answers per question —
  and if you explicitly ask for a specific number in the message itself, that overrides the toggle for that message
- Camera "ask about this photo": snap a photo, ask a question, the photo + question go to Claude together
- Voice memo recording (real audio capture via `expo-av`), **really transcribed** server-side (OpenAI Whisper — see
  "Real voice chat" below) with an edit-before-send step
- On-device text-to-speech playback of NexaAi's replies, with 4 switchable voice characters (gender + tone presets)
- **Real live voice chat** (the Voice tab): an actual spoken back-and-forth conversation with NexaAi — record,
  real transcription, a real answer, real spoken reply audio, saved turn-by-turn as a "live memo" you can revisit.
  See "Real voice chat & the Gemini speed lane" below for exactly how it works and its one honest limitation.
- **Real "who is" deep dive**: asking about a public figure now triggers actual live web search (Anthropic's own
  web-search tool, not guesswork), returning a current, sourced, neatly structured profile — bio, officially
  confirmed accounts, cited sources. Deliberately scoped to public figures only; see "The 'who is' deep dive" below
  for exactly where that line is and why.
- Three plan tiers (Beginner/Pro/Max), each backed by a real, different model — not a fake label. Pro/Max call the
  real Anthropic API (Max gets a stronger model, a bigger thinking budget, more output tokens). **Beginner runs on
  your own self-hosted fine-tuned Llama model** (see "The hybrid model architecture" below) — this caps the
  cost of the tier that doesn't pay you, while Pro/Max keep frontier quality funded by subscription revenue.
- Real credit ledger (every purchase/spend is its own row, balance is always summed — it can't drift), a $1 grace
  overage before a session is paused, weekly session-time limits that reset every Monday 05:00 **Australia/Sydney**
  time regardless of the user's own timezone, and a daily session-count cap — with an in-app banner (Claude-style)
  showing the reset time in both Sydney time and the viewer's own timezone
- "Find nearest assistance" flow: describe a problem (e.g. a car issue), NexaAi asks clarifying questions, then
  the app looks up the nearest matching business from its own directory and hands off to Apple Maps / Google Maps /
  your own TrackLine app for directions
- Custom agent builder: describe an automation in your own words (e.g. "reply to Instagram DMs about pricing"),
  safely preview what it would reply via a real Claude-generated draft, then genuinely connect and run it — real
  inbound webhooks from Instagram/Facebook Messenger/WhatsApp, real drafts, and real sends via Meta's Graph API
  once connected, plus a fourth "generic webhook" kind with its own real inbound URL that needs no platform review
  at all. See "The agent builder's live-send capability" below for what each needs from you (and, for the Meta
  platforms, Meta's App Review).
- A companion account website (`/website`) for logging in, buying credit packs or a custom amount, and changing
  settings — separate from the chat experience, which lives in the app, per the product spec
- **Permissions screen** (Settings → Permissions): real OS permission status for Camera, Microphone, Location,
  Calendar, and (iOS) Reminders, using each platform's actual permission API. Toggling on requests it for real;
  toggling off an already-granted permission opens the system Settings app, since no app can revoke its own
  permission grant — only iOS/Android can do that.
- **Capabilities screen** (Settings → Capabilities & memory): seven real feature toggles (camera-ask, nearest-business
  lookup, who-is lookups, agent builder, auto-speak, live typing, voice chat) that are enforced **server-side** —
  turning one off makes the matching API endpoint refuse the request with a clear message, not just hide a button.
- **Real memory core**: after each turn, a cheap/fast Claude call decides whether anything durable and safe is worth
  remembering (a preference, an ongoing project) and saves it — gated by the "Generate memory from chats" toggle, with
  a separate "Reference past chats" toggle for whether saved memory is read back into future conversations, and an
  "Include sensitive topics" toggle (off by default) for health/religion/political/etc-adjacent facts. A dedicated
  "Memory files" screen lists everything saved, individually deletable or clearable all at once.
- **Connectors screen** (Settings → Connectors): links a user's account to other platforms. Google and Instagram
  are wired end-to-end with real OAuth 2.0 flows; WhatsApp uses a real (non-OAuth — see below) manual
  credential-entry flow; Notion/Slack are real UI rows that honestly report "not set up yet" with exactly which
  env vars an admin needs to add, the same pattern as this README's Paddle/Apple IAP sections.
- **3 real fonts, pickable** (Settings → Appearance): Inter (clean/modern), Fraunces (fancy/editorial, the closest
  free equivalent to Claude's own serif prose font), and Space Grotesk (techy). Switching applies instantly across
  the whole app — see "How the font switch works" below for the real mechanism and its one honest limitation.
- **4 real switchable background themes** (Settings → Appearance): Galaxy Violet, Nebula Rose, Deep Ocean, Solar
  Amber. Only the background gradient and accent color change between them — card surfaces, borders, and text stay
  the exact same shade in every theme, so contrast against text is guaranteed rather than something to hope a
  themed palette got right.
- **Focus/power modes** (the chip row next to the answer-count toggle in Chat): Quick, Build, Auto, and Gorilla.
  Each one is real, not a label — see "Focus/power modes" below for exactly what each does to the actual Claude API
  call and its credit cost.
- **Real file/photo/video attachments** (the paperclip button in Chat): picks a photo/video from the library or any
  file, uploads it with real multipart streaming (not a giant base64 JSON blob), and — for images in a format
  Claude's vision API accepts — actually analyzes it, the same as camera-ask. See "Attachments & the 30GB question"
  below for the honest limits on video and very large files.
- **Projects** (the Projects tab): a named workspace for building one specific site/app, with real persisted chat
  history per project — not client-side-only state. NexaAi answers inside a project in a dedicated "build" mode:
  one direct answer with real, complete, fenced code blocks instead of several compared approaches. See "Projects
  & the code-build mode" below.
- **Real developer API keys + a public API** (website → Developer): generate a key, then call
  `POST /api/v1/generate` from any app you build yourself — with a real bcrypt-hashed key, shown once at creation,
  billed against your own credit balance exactly like a normal chat message.
- **Owner panel** (website → Owner): every number is a live aggregate query against the real database — total
  users, revenue, messages, connected accounts by provider — plus a per-user history drill-down. Gated by a
  server-side allowlist check on the logged-in account's own email/phone, not a separate login system.
- **Real account deletion** (Settings → Delete account, in the app and on the website): requires re-entering your
  password, then genuinely deletes the row — every chat, project, credit transaction, connector, memory entry, and
  API key cascades with it at the database level, not a soft "deactivated" flag.

## Real, but needs your own credentials to go fully live

- **Anthropic API** (the actual brain): sign up at console.anthropic.com, set `ANTHROPIC_API_KEY`. Without it, chat
  returns a clear "not configured" placeholder instead of pretending to answer.
- **Stripe** (website/Android credit-pack checkout — including a real custom top-up amount, real $5 minimum — AND
  Pro/Max subscription checkout; the active payment provider — `server/src/lib/payments/paddle.ts` and
  `server/src/routes/webhooks/paddle.ts` are kept but dormant, in case that account's business verification
  eventually clears): create one-time Price objects for each credit pack and RECURRING Price objects for Pro/Max
  (`dashboard.stripe.com` → Catalog → Products), set `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` /
  `STRIPE_PRICE_ID_35` / `_80` / `_115` / `_175` / `_PRO` / `_MAX`, and create a webhook endpoint pointed at
  `<APP_BASE_URL>/api/webhooks/stripe` (Developers → Webhooks) subscribed to `checkout.session.completed`,
  `payment_intent.succeeded`, and `customer.subscription.created`/`.updated`/`.deleted`. Until set, checkout
  returns a clear "not configured" error rather than a fake success. Unlike Paddle, Stripe is not a merchant of
  record — you handle your own sales tax/VAT; this repo also disables Stripe's "Managed Payments" bundle
  (`managed_payments[enabled]: false`) on every checkout session, since assigning a real product tax code is a
  business decision for you to make, not one this code should guess at. A Stripe-subscribed user's plan tier is
  kept in sync by the real `customer.subscription.created`/`.updated`/`.deleted` webhook events
  (`server/src/routes/webhooks/stripe.ts`) plus a lazy expiry check (`server/src/lib/planExpiry.ts`) run on `/me`,
  `/plans/usage`, and every chat message — a lapsed or cancelled subscription genuinely loses Pro/Max access, it
  isn't just a display label.
- **Apple In-App Purchase** (iOS Pro/Max subscriptions AND iOS credit-pack purchases — required by App Store
  Guideline 3.1.1, see "Why plans and credits use different payment paths" below): create the products in App Store Connect (2 auto-renewable
  subscriptions for Pro/Max, 4 consumables for the credit packs) and set their exact Product IDs —
  `APPLE_IAP_PRO_PRODUCT_ID` / `APPLE_IAP_MAX_PRODUCT_ID` / `APPLE_IAP_CREDITS_35_PRODUCT_ID` (and `_80`/`_115`/`_175`)
  / `APPLE_APP_STORE_ID` / `APPLE_IAP_BUNDLE_ID`. Verification itself is real and complete
  (`server/src/lib/payments/appleIap.ts`): it cryptographically checks the device's signed transaction against
  Apple's own root CA (bundled at `server/assets/apple/AppleRootCA-G3.cer` — public data, no download or API key
  needed) via `@apple/app-store-server-library`'s `SignedDataVerifier`, the same trust chain Apple's own App Store
  Server Notifications use. `client/src/lib/applePurchase.ts` drives the actual on-device StoreKit purchase via
  `react-native-iap`; `PlansScreen`/`CreditsScreen` use it automatically on iOS instead of ever showing a web
  checkout inside the app.
- **TrackLine** (your own maps app): set `EXPO_PUBLIC_TRACKLINE_URL_SCHEME` (its custom URL scheme) and
  `EXPO_PUBLIC_TRACKLINE_APP_STORE_URL` once it's built/published; `client/src/lib/maps.ts` already builds real deep
  links and falls back to the App Store page if TrackLine isn't installed.
- **Meta Graph API / agent builder live-send** (actually running an Instagram DM or WhatsApp agent against a real
  account): set `META_APP_ID` / `META_APP_SECRET` / `APP_BASE_URL` / `META_WEBHOOK_VERIFY_TOKEN` — see "The agent
  builder's live-send capability" below for the full setup and the real App Review requirement.
- **Google connector** (Settings → Connectors, Calendar read access): create a Google Cloud project, enable the
  Calendar API, add an OAuth Web application client with `<APP_BASE_URL>/api/connectors/google/callback` as an
  authorized redirect URI, and set `GOOGLE_CONNECTOR_CLIENT_ID` / `GOOGLE_CONNECTOR_CLIENT_SECRET` / `APP_BASE_URL`.
  Uses its own dedicated OAuth client, separate from any other app's Google Sign-In. Token storage in
  `nexaai_connectors` is plain text in this scaffold — **encrypt at rest before a real launch.**
- **Notion / Slack connectors**: each needs that platform's own developer app credentials (`NOTION_CLIENT_ID`/`_SECRET`,
  `SLACK_CLIENT_ID`/`_SECRET`) — the Connectors screen tells you exactly which env vars are missing; neither has
  OAuth wired up yet (Google/Instagram/WhatsApp do).
- **Your self-hosted model** (Beginner tier): set `SELF_HOSTED_MODEL_BASE_URL` to your deployed vLLM endpoint — see
  "The hybrid model architecture" below and `finetune/RUNPOD_SETUP.md` for training + deploying it.
- **Gemini speed lane** (voice chat's fast-reasoning step): sign up at aistudio.google.com, set `GEMINI_API_KEY`.
  Without it, voice chat still works end-to-end — it just falls back to your plan tier's own model, which is slower.
- **OpenAI (Whisper + TTS)** — real voice chat's actual speech-to-text and text-to-speech: sign up at platform.openai.com,
  set `OPENAI_API_KEY`. Without it, both the Voice tab and the Chat screen's voice-memo transcription return a clear
  "not configured" error instead of a fake transcript.
- **SiteSpark connector**: your own separate app, so there's no fixed provider to point at — this is a real, generic
  OAuth 2.0 client that becomes functional once SiteSpark implements a standard authorize/token/whoami endpoint
  trio. Set `SITESPARK_CLIENT_ID` / `SITESPARK_CLIENT_SECRET` / `SITESPARK_OAUTH_BASE_URL`. See "Projects & the
  code-build mode" below for the full explanation of what this connector is (and isn't) for.
- **GitHub / Vercel / Netlify / Stripe connectors** (push code, deploy, take payments from a Project): each needs
  that platform's own real OAuth app — `GITHUB_CLIENT_ID`/`_SECRET`, `VERCEL_CLIENT_ID`/`_SECRET`/`_INTEGRATION_SLUG`,
  `NETLIFY_CLIENT_ID`/`_SECRET`, `STRIPE_CLIENT_ID`/`STRIPE_SECRET_KEY`. The Connectors screen tells you exactly
  which are missing.
- **Namecheap connector** (manage a custom domain): no env vars — the user pastes their own API key, username, and
  a whitelisted IP directly into the app (Namecheap's API has no OAuth flow; see
  `server/src/lib/connectors/namecheap.ts`'s header for why).
- **Twilio connector** (a real phone number people can call — see "Real phone calls" below): also no env vars —
  the user pastes their own Account SID, Auth Token, and phone number, and NexaAi auto-wires the number's webhook
  against `APP_BASE_URL`.
- **Owner panel**: set `OWNER_EMAIL` / `OWNER_PHONE` to your own account's email/phone. Nothing else to configure —
  any account matching either value gets the panel; everyone else gets a real 403.

## What's intentionally stubbed, and why

A few things in the original product brief aren't achievable as "real" from inside a coding session — here's each
one and exactly what's in its place:

- **Live eye-tracking / emotion detection from the camera.** This needs an on-device computer-vision model
  (face-landmark + expression classification) integrated into a native build, tuned and tested against real
  faces/lighting — a real ML engineering project in its own right, not something a text-based coding session can
  build or validate. What exists instead: the Settings screen has a genuine, working toggle ("ask if I need help,
  even off the app") that's honestly scoped to mean "NexaAi may send a push notification check-in" — it does not
  claim to watch you through the camera. The permission plumbing (camera/mic requests) is real and ready for a real
  CV model to be dropped in later.
- **Background monitoring while the app is closed, to proactively start a conversation.** Same root cause as above
  (needs a native background service + the CV model) — the toggle exists and is honest about its current scope.
- **Deep "who is X" lookups that scrape a person's Instagram/Facebook/social profiles.** Scraping a platform's
  private-ish data outside its API, or without the person's consent, isn't something to build regardless of
  feasibility. What's real instead: `who_is_lookup` messages are answered from Claude's own training knowledge with
  an explicit instruction to state plainly when it doesn't have confident, genuinely public information, rather than
  inventing follower counts or recent personal details.
- **Speech-to-text for voice memos / live voice conversation.** Recording audio is real (`expo-av`). Transcribing it
  needs a native STT module (e.g. `expo-speech-recognition`) built with a native EAS build, not Expo Go — see
  `client/src/lib/voice.ts`. Until that's wired up, a recorded memo prompts the user to type what they said, which
  they can then edit before sending (the "edit back with interaction text" feature from the spec still works on that
  typed text).
- **A fine-tuned model that matches Claude's general capability.** `finetune/` is real, working tooling (synthetic
  data generation, an Axolotl QLoRA config, a RunPod deployment guide — see "The hybrid model architecture" below),
  but fine-tuning teaches a model your app's *tasks and format*, not general intelligence the base model lacked.
  An 8B self-hosted Llama will visibly underperform Claude on anything outside what it was fine-tuned on — that's
  not a bug to fix, it's the real tradeoff of a much smaller model.
- **Submitting to the App Store.** Needs your own Apple Developer account, signing certificates, and a human
  clicking through App Store Connect — `eas build`/`eas submit` is the real path once `nexaai/eas.json` is filled
  in with your Apple Team ID.

## Why plans and credits use different payment paths

Apple's App Store Review Guideline 3.1.1 requires **digital, in-app-subscription goods bought from inside an iOS
app** (NexaAi's Pro/Max plans) to go through StoreKit/In-App Purchase — a Stripe or PayPal web checkout opened from
inside the iOS app for this purchase would get the app rejected. So on iOS, every plan (Ember, Nova, Zenith) is
sold exclusively via real StoreKit purchases (`client/src/lib/applePurchase.ts`, `react-native-iap`), verified
server-side via `POST /api/plans/apple/verify` and `lib/payments/appleIap.ts` before the account is actually
upgraded — nothing is trusted on the client's word alone. On web/Android, plans go through a real Stripe hosted
checkout (`POST /api/plans/checkout`) instead.

**Credit top-ups (extra usage beyond a plan, including a real custom dollar amount with a real $5 minimum) are
deliberately website-only, on every platform, including iOS** — `CreditsScreen.tsx` shows real Stripe-pack purchase
buttons (and the custom-amount field) on web/Android, but on iOS shows only plain text pointing the user to buy
credits on NexaAi's own website; there is no in-app purchase button or StoreKit flow for credits at all. This is a
real product decision, not an oversight: credits are metered, cost-based add-on usage (see "Real pricing & unit
economics" below), so keeping them off StoreKit avoids Apple's cut on that specific revenue stream, and since the
app never opens or links to the website's checkout from inside itself, nothing here routes around Guideline 3.1.1
— the user visits the website entirely on their own (a real "Add credits" link on the Plans screen's usage block
sends them to the in-app `CreditsScreen`, which shows this same website-only note on iOS). (`routes/credits.ts`'s
`/apple/verify` endpoint and `lib/payments/appleIap.ts`'s credit-pack verification still exist and work — they're
just not wired to any client button right now, in case a future version reintroduces an in-app path.)

A downgrade (`POST /api/plans/switch` with `tier: "beginner"`) is the only unpaid plan path — upgrading always goes
through one of the two real payment flows above, and `grantCredits` dedupes by `providerReference` so a replayed
Stripe webhook or a re-verified Apple purchase can never double-credit an account.

## The "Get more NexaAi" upgrade screen

`client/src/screens/PlansScreen.tsx` is deliberately styled to match Claude's own real "Get more Claude" upgrade
sheet — a light card over the app's usual dark chrome (`headerShown: false` on the Plans route, its own in-content
close button), a serif headline, selectable price boxes for each real tier above the user's current one, a black
pill CTA, and a checklist built from real data (`buildChecklist`): the actual message-limit, token-cap, extended-
thinking, and focus-mode differences between the user's plan and the one they're looking at — never a fabricated
marketing bullet. A user already on Zenith (the top tier) sees an honest "you're on our top plan" state instead of
an empty purchase card. The user's actual current plan, usage bar, and the free downgrade-to-Ember link live in a
smaller block below the promo card, so real account state isn't lost to the redesign, just de-emphasized visually.

## Real pricing & unit economics

Every credit charge in the app (`server/src/lib/costModel.ts`) is computed from an actual real-world per-token/
per-minute/per-character rate for the exact API call it's paying for, then marked up — it is not a flat guess.
This replaced an earlier flat "2 cents per message regardless of plan or model" placeholder, which had a real bug:
it charged a Max-tier (Opus-class) message the same as a Pro-tier (Sonnet-class) one, even though Opus-class output
is roughly 5x pricier per token. That's now fixed — Beginner/Pro/Max each meter against their own real model's rate.

**Methodology** (see the file for the full numbers):
1. Every plan/focus-mode combination has a real technical `max_tokens` ceiling (`resolveMaxTokens` in
   `lib/anthropic.ts`) — the hard cap sent to the Claude API so a reply can't get truncated mid-sentence.
2. Pricing uses a *realistic* fraction of that ceiling (22%), not the ceiling itself — Claude essentially never
   fills the technical safety cap on an ordinary reply, so charging every message for the absolute worst case would
   make a single Gorilla-mode reply cost several real dollars for no real reason. The actual tail risk (an
   unusually long reply) is bounded the way it already was: `lib/credits.ts`'s `GRACE_OVERAGE_CENTS` caps how far
   one user's balance can go negative (currently $1) before their session pauses.
3. That realistic token count is priced at the closest real, currently-published Anthropic per-model-tier rate
   (`COST_RATES` — Sonnet-class $3/$15 per M input/output tokens, Opus-class $15/$75 per M; **update these the
   moment you have your actual invoiced "Sonnet 5"/"Opus 5" rate**, since neither has public pricing yet).
4. A 2.5x margin is applied on top. That multiplier is sized to survive Apple's in-app-purchase cut — up to 30% off
   the sticker price of the credit pack funding the message — and still leave real profit after it, not just to
   pad margin on the (much cheaper) Stripe/web path.

**Worked example** (current numbers, live-verified against the actual formula): a Pro-tier Quick message costs
~4¢ in credits; the same message on Max (Opus-class) costs ~27¢, and a full-budget Max Gorilla message ~80¢. A
$175 credit pack (+$30 bonus = $205 spendable) costs NexaAi roughly $82 in real API fees if fully spent — leaving
~$40 profit even if bought via Apple IAP (worst-case 30% cut) and ~$84 profit via Stripe (before Stripe's own
processing fee — roughly 2.9% + $0.30 per real transaction, plus whatever real sales tax/VAT you're responsible
for filing yourself, since Stripe isn't a merchant of record the way Paddle would be). Voice turns are metered
the same way, using real OpenAI Whisper/TTS and Gemini Flash (or the user's own plan model as fallback) rates.

**Plan subscription prices are pure "unlock" revenue, not usage credit** — Pro/Nova ($109.99/mo) and Max/Zenith
($239.99/mo) don't include any free messages; every message still draws from the user's own credit balance,
metered as above. That means the subscription price carries no API-cost exposure at all (100% margin on it) — it
only had to stop being *free* to switch into (see "Why plans and credits use different payment paths" above).
Beginner (Nexa Ember) shows a real reference price ($39.99/mo — what it would cost as a paid subscription) for
comparison against Pro/Max in the model picker, but staying on it is actually still free: the 2-day trial and
pay-as-you-go credits afterward, unchanged, since there's no functional difference between "on Beginner, paying
per message" and "on Beginner, paying a flat monthly fee for the same thing" — charging for it would be strictly
worse for the user than pay-as-you-go, so `POST /api/plans/switch` to `beginner` stays the one free, unpaid path
(see "Why plans and credits use different payment paths" above).

The client also deliberately never names which underlying model powers a tier (`modelComparisonLine` in
`PlansScreen.tsx`/`ModeDropdown.tsx`) — it compares tiers by real outcome instead of surfacing the Anthropic model
id, matching how Claude/ChatGPT's own model pickers describe capability rather than infrastructure. The displayed
"Xx" power number is a separate `marketingStrength` field (`server/src/lib/plans.ts`), intentionally decoupled
from the internal `strengthMultiplier` knob that drives real backend behavior (humor-tier threshold in
`shared/src/nexaPersona.ts`) — so a marketing number change (Ember 3x baseline, Nova 4x-vs-Ember, Zenith
17x-vs-Ember) can never accidentally shift real model behavior.

**What this doesn't cover**: the Beginner tier's self-hosted GPU has a real fixed hourly hosting cost regardless
of traffic, which a per-message number can't absorb — that has to be covered by overall Pro/Max/credit-pack
volume, same as any freemium tier funded by paid tiers elsewhere. Stripe's own transaction fee (roughly 2.9% + $0.30)
and Apple's 15-30% cut both come out of the *subscription/pack sticker price*, not out of credit metering — they're
accounted for in the 2.5x margin above, but if you change Stripe/Apple's actual fee structure on your account,
revisit `MARGIN_MULTIPLIER`.

## The weekly/daily session-limit "rest" algorithm

The spec's example (usage starts at 1pm, runs out at 2:47pm, and the next allowed time is "4pm or 3:30pm depending
on how it was used") is illustrative, not an exact formula — `server/src/lib/usageClock.ts` turns it into one
explicit, documented rule: round the moment credits/time ran out up to the next 30-minute boundary, then add one more
30-minute slot if usage was paced smoothly, or a full extra hour if messages were fired back-to-back ("forced"). The
weekly cap always resets Monday 05:00 **Australia/Sydney** time for every user, worldwide, per the spec.

## The chat limit banner, and why it's two different messages

`ChatScreen.tsx`'s `limitBanner` covers two real server errors that look similar but aren't: a 429 (the rolling
message-window cap, `middleware/usage.ts`) and a 402 (out of credit, `lib/credits.ts`). They get genuinely
different UI, not the same banner reused:

- **429 (window limit)** has a real, server-computed reset instant — `checkUsageWindow`'s `resetAt` — because the
  window really does refill on its own on a clock. `UsageBanner.tsx` shows it in the viewer's own local time, with
  the date included whenever the reset isn't simply "later today" (e.g. "Resets Sep 13, 10:00 PM GMT+10" vs. just
  "Resets 4:00 PM GMT+10").
- **402 (insufficient credit)** has no reset time at all — there's no recurring free refill, just a one-time $5
  trial grant at signup (`routes/auth.ts`'s `TRIAL_GRANT_CENTS`) and whatever the user buys after that. An earlier
  version of this banner defaulted a missing `resetAt` to "right now", which rendered as a real lie ("Resets
  [current time]" on a limit that never actually resets) — fixed by having the client treat this case as
  `resetAt: null` and render a real "Buy credits" button instead of a fabricated countdown.

## Resuming a session — the live marker and auto-resume

Two real, connected pieces, live-verified against the real API (a genuine 429 with its real `resetAt`, and a real
402 with no `resetAt` at all, both reproduced by driving the database directly):

- **Auto-resume** (`client/src/lib/api.ts`'s `getLastSessionId`/`setLastSessionId`, expo-secure-store-backed same
  as the auth token): every successful send and every opened session persists its id, and Chat's first mount
  checks for one and reopens it — so relaunching the app picks the conversation back up instead of always starting
  a blank "New chat".
- **The "Resumed session" marker** (`ChatScreen.tsx`'s `openSession`, `MessageBubble.tsx`'s `ResumedSessionMarker`):
  when a reopened session's real last message is older than `RESUME_GAP_MS` (20 minutes — long enough to mean
  "came back later" or "next day", not "switched tabs for a second"), a real divider is inserted with the exact
  live moment the resumption happened (not the old message's own timestamp). It's a genuine list item, not a
  cosmetic label — the very next message sent renders right below it, and the existing live "Thinking"/"Building"/
  etc. status feed (`deriveLiveStatus`, `WAITING_WORD`) picks up from there exactly as it does on a fresh reply.

## The real send queue

Sending is genuinely serialized per session — `send()` in `ChatScreen.tsx` still only lets one turn be in flight at
once — but the composer no longer just ignores a second send attempt while NexaAi is replying. Typing while a reply
is streaming swaps the composer's trailing button from a real "actively working" indicator
(`components/ActiveRunIndicator.tsx`, empty input, nothing to queue yet) to a real, enabled send button; tapping it
queues the message (a visible chip above the composer, `queue` state) instead of firing it immediately or doing
nothing. A `React.useEffect` watching `sending`/`queue` dequeues and dispatches the front of the queue through the
exact same `send()` path the instant the active turn settles — success or failure, first in, first out, real
messages the whole way (each queue chip is exactly what will be sent, not a summary). Starting a new chat or
opening a different session clears whatever was still queued, since it was written for the conversation being
left behind. `ActiveRunIndicator` is deliberately not tappable: there's no real interrupt/cancel wired to the
in-flight request yet (see the still-open "stops on tap" backlog item), and faking one would be exactly the kind
of dishonest control this app avoids everywhere else.

## Auto-recharge — real on the web, an honest limit on iOS

A real threshold-triggered top-up, hooked straight into `lib/credits.ts`'s `spendCredits` — the one choke point
every credit spend in the app already runs through, so it fires no matter which feature spent the credit. The
Credits screen's toggle sets `autoRechargeEnabled`/`autoRechargeThresholdCents`/`autoRechargePackLabel` on the
user record; `lib/autoRecharge.ts` checks the balance after every spend and, when it's dropped below the
threshold, tries to act.

**On the web (Stripe), this genuinely fires with zero interaction.** The first time a user completes any real
Stripe checkout, the webhook (`routes/webhooks/stripe.ts`) captures their real `customer` id (Stripe's Checkout
Session was created with `payment_intent_data[setup_future_usage]: "off_session"`, so the card is actually saved
for this). From then on, `stripeProvider.chargeSavedPaymentMethod` can charge that same saved payment method
directly — a normal off-session `PaymentIntent` with `customer`/`payment_method` set and no checkout/redirect at
all. A short-lived `autoRechargeInFlightAt` claim (cleared by the real `payment_intent.succeeded` webhook, or
released on a caught failure) stops a burst of spends from firing the same top-up multiple times before the
first one's webhook lands.

**On iOS there's no equivalent, and the UI says so honestly rather than pretending otherwise.** Apple's StoreKit
flatly disallows a server- or app-initiated purchase with no on-device tap — full stop, not a choice made here.
So an Apple-only account (`hasPaddlePaymentMethodOnFile: false`) sees the toggle disabled with real copy
explaining why: add credits once on the web first, and auto-recharge starts working off that same saved payment
method. This mirrors the Credits screen's existing choice to keep top-ups web-only on iOS (see "What's
intentionally stubbed" above) rather than adding a new StoreKit purchase path.

## No money refunds, but real, AI-reviewed credit refunds

NexaAi never refunds a payment method — see terms.html's Refunds section. Instead, `server/src/lib/creditDisputes.ts`
runs a real, bounded system for genuine billing errors on already-spent credit, split into what's certain and what
needs judgment:

- **Automatic, no AI, no request needed**: every real charge is now linked to the exact message it paid for
  (`creditTransactions.messageId`, set right after that message exists — `lib/credits.ts`'s
  `linkTransactionToMessage`). If the turn that charge paid for then genuinely fails to produce a reply
  (`resolveAnswer`/`turn.finish` throws — a real Anthropic API error, live-verified by actually breaking the API key
  and confirming the exact charged amount comes back as a `refund` transaction), `routes/chat.ts`'s `onFailure`
  refunds it immediately from the route handler's own catch block. Same in the edit-message route.
- **User-reported, but still deterministic where possible**: tapping "Report issue" on any reply
  (`MessageBubble.tsx`'s `ReportIssueButton`) sends a plain-language description to `POST /api/credits/disputes`.
  The review is deliberately privacy-preserving — it never reads the actual message/reply content, only real
  structural facts about that one charge (did a reply exist, how long was it, what was charged, message
  kind/focus mode parsed from the transaction's own `note`). A charge above the app's own documented cost ceiling
  (`GRACE_OVERAGE_CENTS`, $1) is a real formula/bug problem and is auto-approved with no AI call at all.
- **Genuinely fuzzy cases**: everything else goes to one bounded Claude call, given only those structural facts
  plus the user's own description, explicitly instructed to decline (not guess) when the complaint is really about
  reply quality rather than a billing mismatch, since it's deliberately never shown enough to judge that fairly.
  Live-verified: a normal, correctly-priced message disputed with a made-up complaint came back declined with a
  real, specific explanation grounded in the actual numbers, not a canned response.

Every dispute — approved or declined — is permanently logged with its real reasoning (`creditDisputes` table) and
visible in the Owner panel's Credit disputes section, which can also manually override a declined one
(`POST /api/owner/disputes/:id/override`) — a real human-in-the-loop safety net for whatever the automated review
gets wrong.

## How the font switch works

`client/src/lib/globalFont.ts` overrides `Text`/`TextInput`'s `defaultProps.style` — the same technique the
`react-native-global-props` package uses — instead of threading a font prop through every screen's `StyleSheet`.
That works because none of this app's styles set `fontFamily` explicitly, so the default always wins at the lowest
priority. The one honest limitation: each Google Font weight ships as its own distinct font family (`Inter_700Bold`
is not "Inter" + bold), so an existing style's numeric `fontWeight` can't perfectly re-synthesize a different weight
of a custom family the way it does for a system font — headings still read as bold on most platforms via partial
synthetic boldening, just not pixel-identical to a dedicated Bold cut.

## Focus/power modes

A second axis on top of the plan tier (`server/src/lib/plans.ts`'s `FOCUS_MODE_DEFINITIONS`). The plan tier picks
which Claude model answers you; the focus mode picks how hard it tries on *this* message, using Claude's real
`thinking` parameter (extended thinking with an actual token budget, not a cosmetic setting) plus a real credit-cost
multiplier:

| Mode | For | Min plan | Thinking budget | Credit cost |
|---|---|---|---|---|
| Quick | Fast everyday edits & tasks | Beginner | — | 1x |
| Build | Complex, multi-step builds | Beginner | 4,000 tokens | 1.5x |
| Auto | Autonomous tasks & builds | Pro | 8,000 tokens | 2.5x |
| Gorilla | Maximum power | Max | 16,000 tokens | 4x |

Locked modes show a real upgrade prompt (with a "See plans" button) rather than silently downgrading. "Auto" mode's
system-prompt addendum is honest with the model itself: it instructs Claude to deliver a complete result in one
turn rather than stalling on clarifying questions, but it explicitly is **not** a sandboxed multi-step execution
loop that can actually run code or click through steps unattended — that would be a materially different, much
larger project (a real code-execution sandbox with its own security model).

## Attachments & the 30GB question

The paperclip button in Chat uploads through `server/src/routes/attachments.ts`, which streams the multipart body
straight to disk via `multer` (never buffers the whole file in memory) — this is a real difference from camera-ask's
inline base64-in-JSON approach, and it's what makes genuinely large files possible at all.

Two honest limits, stated plainly rather than silently capped:
- **A single HTTP request moving tens of gigabytes over a mobile connection isn't realistic**, independent of any
  server code — a dropped connection restarts the whole upload from zero. A real "up to 30GB" experience needs a
  resumable/chunked upload protocol (e.g. [tus](https://tus.io)), which this endpoint does not implement. `MAX_UPLOAD_BYTES`
  (`.env.example`) defaults to a real, useful 2GB; raise it if your hosting's disk/bandwidth budget supports more,
  but treat anything past a few GB in one request as fragile until a resumable uploader replaces this endpoint.
- **NexaAi "watches" a video by real frame sampling, not full motion.** Claude's API has no native video input at
  all, so `server/src/lib/videoFrames.ts` extracts 4 real JPEG stills spread across the video's actual duration
  (using `@ffmpeg-installer/ffmpeg`'s bundled static binary — no system `ffmpeg`/`ffprobe` install needed; duration
  is read straight from ffmpeg's own stderr output, not a separate probe) and sends them to the model as real
  vision content, with an explicit note that it's working from sampled stills, not the whole video. A real
  extraction failure (corrupt file, unsupported codec) falls back to the honest "can't view it directly" note
  instead of pretending. Verified against a real 3-scene test video with distinct labeled colors — NexaAi
  correctly named all three, and correctly noticed two of the four sampled frames landed in the same middle scene.
  Images in a format Claude's vision API accepts (JPEG/PNG/WebP/GIF) get real full-image analysis; unsupported
  image formats (e.g. HEIC) get the same honest "can't open this" note.
- **Live, real frame-by-frame video breakdown.** When a video is attached, the same 4 real sampled stills above
  (each with a real elapsed-seconds `timestampSeconds`, not just an index) are streamed to the client live over
  SSE the moment each one is ready (`videoFrame` event), immediately followed by a real, separate Claude Haiku
  vision call describing specifically what that still shows (`videoFrameDescription` event) — genuinely one frame
  at a time, in real elapsed order, not a batch dumped at the end (`server/src/routes/chat.ts`'s `/messages/stream`;
  `lib/anthropic.ts`'s `describeVideoFrame`). The client renders this as a vertical timeline
  (`components/VideoFrameBreakdown.tsx`) with a real mm:ss timestamp and a custom-styled connecting rail between
  entries. The real timestamp + description (never the image itself, to keep message rows small) is persisted on
  the assistant message's `metadata.videoFrames`, so reopening the conversation later shows the same breakdown —
  live-verified end to end against a real generated test video, including a full server restart and history
  reload. Charged as real extra credit cost: one real Claude vision call per frame on top of the main answer
  (`lib/costModel.ts`'s `videoFrameDescriptionCount`).
- **Real text/PDF breakdown for file attachments.** `server/src/lib/extractFileText.ts` actually reads a plain
  text/code/data file directly, and a real PDF via `pdf-parse`, and hands the model the file's real content (with
  an explicit instruction to break it down section by section) — not just its filename and size. Anything with no
  real reader here (a `.docx`, a spreadsheet binary, etc.) still gets the honest "can't open this" fallback rather
  than a fabricated summary.

## Scanning a QR code / barcode

The "Ask with camera" tab (`client/src/screens/CameraAskScreen.tsx`) has a real "Scan a code" mode alongside
"Ask about a photo", using `expo-camera`'s real `onBarcodeScanned` detector (QR, EAN-13/8, Code128/39, PDF417,
UPC) — not a placeholder. Once something decodes, NexaAi is asked in the background to break down plainly what it
is; a decoded `http(s)://` link additionally gets a one-tap "Open link" button (`Linking.openURL`) rather than
making the user retype it.

## Building an agent from Chat

Chat can kick off an agent (e.g. "build me an agent for Instagram DMs"), but the Agent Builder tab is where the
real thing lives — connecting a real platform, testing with a real dry run, and turning it on. A deterministic
detector (`server/src/lib/agents/detectAgentRequest.ts`, matched on the request text — not left up to the model)
creates a real, off-by-default draft row in `nexaai_agents` right then, and the model's reply tells the user
plainly that it's waiting for them in Agents. If Agent Builder is turned off in Capabilities, no draft is created
and NexaAi says so instead.

## The hybrid model architecture

Beginner and Pro/Max don't just get different settings on the same model — they call genuinely different
providers, dispatched by `server/src/lib/modelRouter.ts`:
- **Beginner** → your own self-hosted, fine-tuned Llama (`server/src/lib/selfHostedModel.ts`, an OpenAI-compatible
  client pointed at `SELF_HOSTED_MODEL_BASE_URL` — your vLLM endpoint from `finetune/RUNPOD_SETUP.md`).
- **Pro/Max** → the real Anthropic API, unchanged.

This is deliberate cost allocation: Beginner is the free/trial tier that doesn't generate revenue, so its cost is
capped by what you spend on GPU hosting rather than scaling per-token with usage; Pro/Max keep paying for frontier
quality because their subscription revenue funds it.

Two things `modelRouter.ts` handles honestly rather than silently:
- **Self-hosted endpoint not deployed yet** → Beginner tier transparently falls back to the Anthropic API (a fixed
  cheap model) instead of the app just being broken for free-tier users while you're still training/deploying.
  You'll want to remove this fallback (or budget for it) once real Beginner traffic exists, since it does spend
  real Anthropic API credits until your own endpoint is live.
- **Beginner tier + an image attachment** → Llama 3.1 8B Instruct has no vision. Rather than silently ignoring the
  image or quietly upgrading the request to a paid Claude call, the image is dropped with an honest note telling
  the model (and, in its reply, the user) that image analysis needs Pro/Max.

The exact same system prompt (`shared/src/nexaPersona.ts`) is used both when generating fine-tuning data
(`finetune/generateSyntheticData.ts`) and at inference time (`lib/anthropic.ts`, `lib/selfHostedModel.ts`,
`lib/geminiModel.ts`) — kept as one shared module specifically so the two can't drift out of sync, since a
fine-tuned model's quality depends on being prompted the same way it was trained.

**The structured breakdown format** is the concrete answer to "understand information better than any other app" —
not a vibe, a real, enforced output shape. `buildNexaSystemPrompt` in `nexaPersona.ts` requires every text answer to
break each approach into the same five labeled parts, every time: **Title**, **Description**, **Image findings**
(only when a photo was actually attached — never invented), **Reasoning** (the numbered "why" that comes before the
steps), then **Steps**. Because this lives in the one shared prompt module, it's already real and in effect for
every provider today (Claude and self-hosted Llama alike); it's also exactly what future fine-tuning runs
(`finetune/`) will train the self-hosted model to reproduce on its own without needing the instruction spelled out
in the prompt every time — that's the actual, buildable version of "train it to be better than any other app at
this," as opposed to a vague claim that more GPU time makes it smarter than Claude/GPT-5 in general (see the
budget breakdown in `finetune/README.md` for why that specific claim doesn't hold up).

## Real voice chat & the Gemini speed lane

The Voice tab is a genuine spoken back-and-forth with NexaAi, not the voice-memo-then-type flow in Chat. Each turn
(`server/src/routes/voice.ts`) does four real steps in sequence:

1. **Record** — `expo-av` captures the user's speech on-device.
2. **Transcribe** — the recording uploads to the server and OpenAI's Whisper API (`lib/voice/speechToText.ts`)
   transcribes it. This is also what now powers Chat's own voice-memo transcription (`client/src/lib/voice.ts`'s
   `transcribeVoiceMemo`, previously a stub that threw because on-device STT needs a native EAS build) — doing it
   server-side sidesteps that limitation entirely.
3. **Reason** — the transcript is answered using NexaAi's "voice" prompt mode (plain spoken language, no markdown,
   one direct answer instead of several compared approaches — see `nexaPersona.ts`). This step runs on **Gemini**
   (`lib/geminiModel.ts`), the app's "speed lane": per the explicit decision behind this feature, Gemini is scoped
   to fast/voice/multimodal work only, not a second selectable chat provider — Claude stays the sole premium text
   model for Pro/Max. If `GEMINI_API_KEY` isn't set, this step transparently falls back to the user's own plan-tier
   model (self-hosted Llama or Claude, via the same `modelRouter.ts` chat uses) so voice chat still works end to
   end, just slower.
4. **Speak** — the reply text is synthesized to real audio via OpenAI's TTS API (`lib/voice/textToSpeech.ts`,
   mapped from the user's chosen voice character) and played back on-device.

Every turn is saved as a real "live memo" row (`voiceTurns` in the schema) — transcript, reply text, and reply
audio URL — so a past conversation has an actual record to revisit, not audio that's gone once it's played.

**The one honest limitation:** this is a turn-based pipeline (record → transcribe → think → speak), not full-duplex
streaming. You get real control over every stage — which model reasons, which voice speaks, what the prompt says —
which is exactly what "DIY" was chosen for, but you don't get the seamless "interrupt it mid-sentence" feel of a
sealed product like OpenAI's Realtime API or Gemini's Live API. There's also no live word-by-word caption while
you're still talking (that needs a streaming STT connection with partial results) — instead the Voice screen shows
real, distinct progress states per turn (listening → transcribing → thinking → speaking), which is an honest
approximation of "second by second" rather than the literal thing.

Without `OPENAI_API_KEY` set, both the transcribe and speak steps return a clear "not configured" error — voice
chat won't pretend to work with fake transcripts or silent replies.

## Real phone calls (Twilio)

You can give NexaAi a real phone number people can call and actually talk to. Connect a Twilio account
(Connectors screen → Twilio → paste your Account SID, Auth Token, and a Voice-capable phone number) and NexaAi
automatically points that number's Voice webhook at itself — no manual dashboard wiring needed
(`server/src/lib/connectors/twilio.ts`). From then on, an inbound call to that real number is answered for real:

1. **Answer** — Twilio hits `POST /api/voice-phone/incoming` (`server/src/routes/voicePhone.ts`); NexaAi looks up
   which account owns the dialed number, spends real credit, generates a genuine spoken greeting through the same
   Gemini-speed-lane/plan-tier-model pipeline voice chat uses, and speaks it back with `<Play>` (or `<Say>` if
   `OPENAI_API_KEY`/TTS isn't configured).
2. **Listen** — a `<Gather input="speech">` verb hands the caller's speech to **Twilio's own** speech-to-text, so
   phone calls don't need a Whisper upload round-trip the way the in-app Voice tab does.
3. **Reason & reply** — `POST /api/voice-phone/gather` charges another real credit turn, builds conversation
   history from the same `voiceTurns` table voice chat uses (tagged `channel: "phone"`), reasons with
   Gemini/Claude, and speaks the reply — then re-opens the `<Gather>` so the call keeps going until the caller
   says a real goodbye or hangs up (`POST /api/voice-phone/status`, Twilio's call-status callback, marks the
   conversation ended even on a silent hangup).

Every webhook request's `X-Twilio-Signature` header is verified for real (`verifyTwilioSignature`, Twilio's
documented HMAC-SHA1 algorithm) — a request that doesn't genuinely come from Twilio gets a 403, not a free ride
into the reasoning pipeline. And a caller on an account that's run out of credit gets told so, honestly, and the
call ends — it's charged and gated exactly like every other real turn in this app.

**Requirement:** `APP_BASE_URL` must be a real, publicly reachable URL (not `localhost`) for Twilio's servers to
reach these webhooks — this only works once NexaAi is actually deployed somewhere with a public address.

## The "who is" deep dive

Asking a "who is X" question (`server/src/lib/whoIsSearch.ts`) now runs Anthropic's real, server-side web-search
tool — genuinely current results, not a recall of training data — and lays the answer out in a fixed structure:
name, one-line "known for," a short bio, officially confirmed accounts, and a numbered source list of everything
cited. This always calls Anthropic directly (the plan's own model for Pro/Max, the same cheap fallback model
Beginner already uses elsewhere), bypassing the self-hosted/Anthropic router entirely, because the self-hosted
Llama model has no tool-use capability at all — there's no self-hosted path for a feature that depends on live
search. It costs more credit than a normal message (3x) for the same reason: it's a multi-step tool-use loop
against the real API, not one call.

**This is deliberately not a general people-search tool, and that's a real design line, not a technical
shortcoming:**
- The prompt (`shared/src/nexaPersona.ts`'s `WHO_IS_FORMAT`) requires the model to decide, before searching, whether
  the name given is a genuinely public figure. If it isn't — a coworker, an ex, a neighbor, anyone without
  independent public notability — it refuses outright and says so, rather than searching. Verified against the real
  API: asking about "my coworker Jessica Martinez" gets an explicit refusal, no search ever runs.
- It never invents or guesses a social-media handle. An account is only reported when multiple reputable sources
  actually confirm it (their own official site, Wikipedia, a verified badge); anything it can't confirm is labeled
  "not confidently found," not filled in with a plausible-looking guess.
- **There is no photo/face-matching of any kind, anywhere in this feature.** The model may include exactly one
  photo, and only when a reputable source (e.g. Wikipedia's own infobox) explicitly attributes that exact image
  file to that exact named person — it is never the result of the model trying to identify someone by appearance,
  because it has no such capability and none was built. `MessageBubble.tsx`'s `FormattedAnswer` renders that one
  attributed-photo line (`![Photo](url)`) as a real image; every other line stays plain structured text.
- An ambiguous name (matches more than one notable person) gets a clarifying question instead of a merged,
  guessed-at profile.

The underlying reason this exists as a hard scope line: "search the web and social media for a named person and
return their accounts, photos, and personal info" is a people-search/OSINT capability regardless of how it's
framed, and building it without a public-figure restriction would make this app a doxxing tool. Restricting it to
public figures — the same restriction the original training-knowledge-only version of this feature already had —
keeps the real, useful part (fast, sourced answers about well-known people) without the part that enables locating
a private individual.

## Projects & the code-build mode

The Projects tab is a named workspace for building one specific site/app (`server/src/routes/projects.ts`) — a
real `projects` table, with real chat sessions (`chatSessions.projectId`) hanging off it, so "recent chats" and
full history are queryable rows, not client-side state that vanishes on reinstall. Sending a message inside a
project switches NexaAi into `build_project` mode (`shared/src/nexaPersona.ts`'s `CODE_BUILD_FORMAT`): one direct
answer, real complete fenced code blocks with filenames, not several compared approaches and not
`// rest of the code...` placeholders. Verified against the real API — asking for "a tiny one-page hello world
site" returns a complete, working `index.html` file plus real usage steps.

**A Project's real file tree, not just chat transcript.** Every `build_project` reply's fenced
```lang filename="..."``` blocks are parsed and upserted into a real `nexaai_project_files` table
(`server/src/lib/projectFiles.ts`, wired into `routes/chat.ts`'s `finish()`) — keyed by `(projectId, path)`, so
asking NexaAi to change one file later updates that same row instead of piling up duplicates. This is the
project's actual "session memory" for code: `GET /api/projects/:id/files` returns the real current file tree, and
the mobile app's Project screen shows it behind a folder icon in the header (file count included) rather than
requiring you to scroll back through old messages to find a file's current contents.

**The SiteSpark connector, and why it's shaped the way it is.** Per the explicit decision behind this feature: this
app does not become SiteSpark, and SiteSpark's code isn't in this repo — instead, Connectors gained a real "connect
your SiteSpark account" entry, the same way Claude.ai's own Connectors let you link an external account. Because
SiteSpark is genuinely a separate app with no fixed API this session has ever seen, `lib/connectors/sitespark.ts`
is a generic, standard OAuth 2.0 Authorization Code client (RFC 6749) rather than a bespoke integration — it
becomes real and functional the moment SiteSpark implements the endpoints any OAuth provider needs (authorize,
token exchange, "who am I"), **plus one real site-import endpoint** (`POST /api/v1/sites/import`, Bearer-authed
with that same OAuth token, body `{ externalRef, name, files: [{ path, content }] }`, response
`{ siteId, url }` — see that file's header for the exact contract). Once both exist, a Project's "Export to
SiteSpark" button (`routes/projects.ts`'s `POST /:id/export/sitespark`) pushes its real accumulated file tree
there in one call and hands back the live site's URL. Until then it shows as "not set up yet," or the export
fails with an honest error naming exactly what's missing — the same pattern every other missing-credentials
connector in this app uses; nothing here fakes a successful export.

**Smart Build: "hey Nexa, build me a website" straight from Chat.** A real, deterministic detector
(`server/src/lib/build/detectSiteBuildRequest.ts`, sibling to the agent-request detector below) recognizes a
build-a-site/app request typed into ordinary Chat — no need to open Projects first. When it fires (gated by the
`smartBuild` capability, on by default), `routes/chat.ts`'s `prepareTurn` auto-creates a real Project and links the
chat session to it (`chatSessions.projectId`) before the model ever runs, so this turn — and every later turn in
that same conversation — lands in real `build_project` mode. The model decides, Claude-style, whether the request
already has enough real detail to build now or needs 1-2 clarifying questions first (instructed via `extraContext`,
never hardcoded). Once real files exist, if SiteSpark is connected (`lib/connectors/sitespark.ts`'s
`isSiteSparkConnected`), the export that's normally a manual button press fires automatically, and a genuine second
assistant message reports the real outcome — the live URL on success, or the exact real error on failure, never a
fake "done!". The reply is spoken aloud through the same on-device `expo-speech` pipeline Chat's general
"Auto-speak replies" toggle already uses (`client/src/lib/voice.ts`'s `speak()`), but through its own dedicated
`smartBuild` capability — it narrates even when general auto-speak is off, and never speaks twice when both happen
to be on. Two real, server-persisted banners (`users.smartBuildIntroDismissedAt`/`smartBuildFirstRunAt`/
`smartBuildFollowUpDismissedAt`, `POST /api/auth/smart-build/{intro,followup}-seen`) introduce the feature on first
Chat open and, separately, ask once more whether to keep it on right after its first real completed build — both
dismissible with a real X, and both survive a reinstall since the state lives on the account, not local storage.

**MCP "authorise control": real actions are opt-in per server, not automatic.** `mcpServers.requireApproval`
defaults to `true` for every connector. `lib/mcp/toolBridge.ts` classifies each of a server's discovered tools as
read-only or mutating by a name/description heuristic (create/update/delete/write/push/deploy/send/...); while a
server requires approval, its mutating tools are left out of what the model is even given — not just discouraged,
structurally uncallable — and `routes/chat.ts` tells the model plainly which real actions exist but are withheld,
so it can tell the user which connector to open and switch on. The user flips "Allow real actions" per server in
Connectors (a real `ToggleSwitch`, `PATCH /api/mcp/:id`) once they actually want NexaAi acting there, not just
reading. Read-only tools were never gated — this only touches the ones with a real side effect.

**GitHub, Vercel, Netlify, Stripe, and Namecheap** round out what a Project actually needs to go from code to a
live, real site: push to a repo, deploy it, take payments on it, and point a domain at it. All five are real OAuth
(or, for Namecheap, real manual API-key entry — it has no OAuth flow) — see `server/src/lib/connectors/` for each.
None of this is wired into an automatic "one-click ship it" pipeline yet; the model will tell you plainly which
connector a step depends on and whether it's connected, rather than pretending a site went live when it didn't.

## The agent builder's live-send capability

Once a business connects Instagram, Facebook Messenger, and/or WhatsApp (Settings → Connectors) and activates an
agent for that platform, real inbound messages actually reach it:

1. Meta calls `POST /api/webhooks/meta` (real signature-verified webhook — `server/src/routes/webhooks/meta.ts`)
   with the incoming DM/message.
2. The message is matched to the connected account (by Instagram business account ID, Facebook Page ID, or
   WhatsApp `phone_number_id`) and that account's active agent.
3. Claude drafts a reply (`lib/agents/agentRunner.ts`'s `dryRunAgent`, same function the safe-preview button uses).
4. If the agent's "autoSend" is on, the reply is sent immediately via `lib/agents/metaGraph.ts`'s real Graph API
   call. If it's off, the draft lands in the Agents screen's "Waiting for your approval" list instead, for the
   business owner to approve (sends it) or reject (discards it) by hand.

A fourth agent kind, **generic_webhook**, doesn't go through Meta at all: each one gets its own real inbound URL
(`POST /api/webhooks/agent/:agentId/:token` — `server/src/routes/webhooks/agent.ts`), secured by a random token
generated at creation. Any external caller (Zapier/Make, your own backend, a website chat widget) can `POST
{"message": "..."}` to it and get back `{"draftReply": "..."}` synchronously — real, Claude-drafted, no third-party
app review or OAuth needed since there's no specific platform to integrate with. The URL is shown (with a copy
button) on the agent's card once it's created.

**What you need before Instagram/Messenger/WhatsApp work with real customers:**
- Your own Meta Developer app (`META_APP_ID` / `META_APP_SECRET` / `APP_BASE_URL` / `META_WEBHOOK_VERIFY_TOKEN`).
- **Instagram**: connects via a real OAuth flow (Settings → Connectors → Instagram) — Facebook Login for Business,
  discovering the Page + linked Instagram professional account you manage.
- **Facebook Messenger**: the exact same OAuth flow and the exact same Page access token as Instagram (Meta's Send
  API for both is the same `/me/messages` endpoint) — the only difference is Messenger doesn't need a linked
  Instagram account, so any Page you manage qualifies.
- **WhatsApp**: connects via a manual credential-entry form (Settings → Connectors → WhatsApp), not OAuth — that's
  the real, standard way third-party apps use WhatsApp Cloud API without Meta's separate, more heavily gated
  "Embedded Signup" product. You paste the permanent access token and phone_number_id Meta Business Suite gives
  you when you set up WhatsApp Cloud API there.
- **Meta App Review.** `instagram_manage_messages`, `pages_messaging`, and `whatsapp_business_messaging` are
  restricted permissions — until Meta approves your app's review submission for them, this only works with
  accounts you've explicitly added as Testers/Developers on your Meta app. That review is a real external process
  (can take days to weeks, isn't guaranteed) that no code here can shortcut.
- Registering the webhook URL (`<APP_BASE_URL>/api/webhooks/meta`) and your verify token in the Meta App Dashboard,
  and subscribing to the relevant webhook fields (`messages` for Instagram/WhatsApp, `messages` under the Page
  subscription for Messenger).
- **Optional, for automatic human-takeover detection** (see below): also subscribe to `message_echoes`. Without it,
  the automatic detection silently does nothing for Instagram/Messenger (the manual "I'll reply myself" button
  still works everywhere regardless).

**Real pacing, pausing, and human takeover** — an agent doesn't have to talk like an obvious bot:
- Every auto-sent reply waits a real, randomized human-like delay (`agentRunner.ts`'s `computeHumanReplyDelayMs`,
  roughly proportional to the reply's own length) before actually sending — not instant, the way a person
  genuinely typing a reply on Instagram/WhatsApp/Slack/X isn't instant either.
- Each agent has a real **Pause** toggle (Agents screen) — flip it on and NexaAi goes completely silent for that
  agent across every conversation (no draft, no send) until you flip it back off, for whenever you want to chat
  through the platform's own app yourself without interruption.
- **Automatic per-conversation takeover** (Instagram/Messenger only, and only with `message_echoes` subscribed):
  when the real account owner (or a teammate) replies to a customer through the Page/IG app's own native inbox,
  Meta's echo webhook tells NexaAi that happened — `routes/webhooks/meta.ts` distinguishes a genuine human reply
  from NexaAi's own auto-sent echo by `app_id`, then silences just that one conversation for a real 5 minutes,
  refreshed on every further human reply. WhatsApp/Slack/X don't have an equivalent reliable "a human just
  replied through the native app" signal available, so for those, use the manual "I'll reply myself" button on a
  pending draft (Agents screen) — same real 5-minute window, triggered by hand instead of detected automatically.

## Real MCP connectors

`server/src/lib/mcp/client.ts` is a real Model Context Protocol client (`@modelcontextprotocol/sdk`, not a
hand-rolled stand-in) — the same idea as Claude's own "Add custom connector": paste any real MCP server's URL
(plus an optional bearer token) in Settings → Connectors or the website's MCP page, and NexaAi actually connects
to it, discovers its real tools, and can call them live during a normal chat turn.

- `shared/src/schema.ts`'s `mcpServers` table stores each connector (name, URL, optional bearer token, cached
  tool list, connection status/error). `routes/mcp.ts` is plain CRUD plus a real "reconnect" endpoint that
  re-discovers tools on demand.
- Connects fresh per call rather than pooling a persistent session (simpler and correct for a stateless HTTP
  server); tries the modern Streamable HTTP transport first and falls back to the older HTTP+SSE transport for
  servers that predate it.
- At chat time, `lib/mcp/toolBridge.ts` turns every enabled, currently-connected server's tools into real
  Anthropic tool definitions (namespaced per server so two servers can't collide on a tool name) and
  `lib/anthropic.ts` runs a real bounded tool-use loop — the model calls a tool, the result goes back in as a
  `tool_result`, and the loop continues until the model gives a final answer (same shape as `lib/whoIsSearch.ts`'s
  own `pause_turn` loop for web search, capped at 5 iterations so a misbehaving tool can't hang a turn forever).
  Only ever wired in for the Anthropic-provider path — the self-hosted Beginner-tier model has no tool-calling
  support at all, same limitation already documented for images.

## Web vs. mobile: what's mobile-only, what's web-only, and why

Same split Claude's own apps use: the phone is the fast "get something done" surface (chat, voice, projects,
camera/QR); anything that's easier or safer to do in a real browser lives on the account website
(`nexaai/website`) instead, and the app *links out* to it rather than rebuilding it natively — it doesn't just
mention that the website exists. `client/src/lib/webLinks.ts`'s `openOnWeb(path)` opens the right website page
with the current session handed off via a one-time `?token=` query param (`website/api.js` reads it into
`localStorage` and strips it from the URL), so the user lands already signed in instead of hitting a second login
screen. Settings → "Continue on web" uses this for:

- **Developer & API keys** and **full MCP tool schemas** (the mobile Connectors screen only shows a tool count —
  the website's MCP page shows every tool's actual JSON input schema, useful for checking exactly what you're
  giving NexaAi access to).
- **Owner panel** — only shown at all when `/api/auth/me`'s real `isOwner` field (an allowlist check, see below)
  says this account is the owner; a non-owner never even sees the link.

Buying credits and Plans is the one deliberate exception to "the app links out to the website": on iOS both
`PlansScreen.tsx` and `CreditsScreen.tsx` purchase through real on-device StoreKit (`useApplePurchase`/
`useApplePurchaseCatalog`, `client/src/lib/applePurchase.ts`) rather than opening the website, because Guideline
3.1.1 requires it — an external purchase link for this specific purchase needs Apple's separate "External Purchase
Link" entitlement/review process, which this app doesn't have. On web/Android, both screens instead open the
website's real Paddle checkout, which is also where the credits screen's custom-dollar-amount option lives — a
fixed-tier Apple IAP product can't represent an arbitrary amount, so iOS only offers the four fixed packs.

## Developer API keys, the public API, and the Owner panel

Per the explicit split between the two clients: the mobile app is the "usage" experience (chat, voice, projects);
anything about connecting external services or managing developer/owner tooling lives on the website
(`nexaai/website`) instead. Three real pieces:

- **API keys** (website → Developer, `server/src/routes/apiKeys.ts`): generate a key — it's shown exactly once, and
  only a bcrypt hash + a short prefix are ever stored, same principle as password storage. Use it to call
  `POST /api/v1/generate` (`server/src/routes/publicApi.ts`) from any app you build yourself, e.g. your own
  SiteSpark, with an `x-api-key` header and a JSON body of `{"prompt": "..."}` — billed against that account's own
  credit balance exactly like a normal chat message. Verified against the real API end to end: create a key, call
  the endpoint with it, get a real Claude-generated answer back.
- **Owner panel** (website → Owner, `server/src/routes/owner.ts` + `middleware/owner.ts`): every number is a live
  aggregate query — total users, revenue (summed straight from the credit ledger), messages, connected accounts per
  provider — plus a per-user drill-down into their real sessions/projects/agents/connectors and recent message
  history. Access is a server-side allowlist check: the logged-in account's own `email`/`phone` against
  `OWNER_EMAIL`/`OWNER_PHONE`, no separate login system. Verified against the real API: a non-matching account gets
  a real 403 (`{"error":"not_owner"}`); the matching account sees real numbers. The History access section
  (`/users/:id/history`) is deliberately unfiltered by `hiddenAt` — see below.
- **User-facing History, and why "delete" there is a soft delete** (`server/src/routes/history.ts`, client's
  `HistoryScreen.tsx`): a real, working "remove this from my history" for every prompt/image/video a user has ever
  sent — real multi-select, real bulk delete, real pagination. It is deliberately a *soft* delete: it sets
  `shared/src/schema.ts`'s `messages.hiddenAt`, hiding the row from that user's own History list and session view
  (and from what future turns see as conversation context) without ever actually erasing it. The permanent copy
  stays visible to the account owner in the Owner panel's History access section, marked "Removed by user" there —
  see the Privacy policy's "Retention & deletion" section for the honest, plainly-stated reasoning (internal
  retention for security/support ≠ sharing with anyone outside NexaAi). Real account deletion is the one path that
  actually erases everything, `hiddenAt` rows included. Live-verified end to end: deleting a prompt makes it
  disappear from `/api/history` and from its session's `/messages`, while the exact same row (with its `hiddenAt`
  timestamp) still appears in the owner's `/api/owner/users/:id/history` response.
- **Memory on/off, for real** (`shared/src/schema.ts`'s `memoryEnabled`/`referenceChatsEnabled`/
  `includeSensitiveInMemory`, `lib/memory.ts`, `CapabilitiesScreen.tsx`): `memoryEnabled` gates whether anything is
  ever written after a turn; `referenceChatsEnabled` gates whether saved memory is read back into later
  conversations; both are real toggles a user flips in Settings, not cosmetic. Live-verified: with memory off, a
  message containing an obviously memorable fact produces zero new rows in `/api/memory`; turning it back on and
  repeating the same message produces a real extracted entry.
- **Account deletion** (`POST /api/auth/delete-account`): requires re-entering your password (checked with the
  same bcrypt comparison as login), then genuinely `DELETE`s the user row. Every other table's `userId` column is
  declared `onDelete: "cascade"` in `shared/src/schema.ts`, so Postgres itself removes every chat, project, credit
  transaction, connector, memory entry, and API key — verified against the real API: deleting an account, then
  trying to log in with the same credentials, returns "Invalid email or password."

## Sign-in methods (Email / Phone / Google / GitHub / Apple)

The Auth screen has an Email/Phone segmented switcher up top plus three "or continue with" buttons underneath.
Apple's button is deliberately shown disabled with a "Soon" badge — the code and server route for it (below) are
real and already wired, but it's held back from the UI on purpose until the account owner finishes rolling it out.

- **Email** — the original signup/login form, `POST /api/auth/signup` / `/login`, bcrypt-hashed passwords.
- **Phone** — real Twilio Verify SMS one-time codes (`server/src/lib/socialAuth/phone.ts`): `POST
  /api/auth/phone/start` sends a real code to the number typed in; `POST /api/auth/phone/verify` checks it against
  Twilio's own Verify service (NexaAi never generates or stores the code itself) and finds-or-creates the account
  by phone number, same as the OAuth providers below. Needs `TWILIO_VERIFY_ACCOUNT_SID`/`_AUTH_TOKEN`/`_SERVICE_SID`
  — until set, the server honestly returns `not_configured` instead of pretending to text anyone.
- **Google** and **GitHub** — a real OAuth Authorization Code flow, driven by `expo-web-browser`'s
  `openAuthSessionAsync` (the same "open a browser, catch the deep-link redirect" pattern the Connectors screen
  already uses, just completing all the way to a real signed-in session instead of stopping at "you can close this
  tab"). Each needs its **own dedicated OAuth app** — never reuse the Connectors screen's Google/GitHub client
  credentials for these, the scopes and redirect URIs differ:
  - Google: console.cloud.google.com → OAuth client ID (Web application) → redirect URI
    `<APP_BASE_URL>/api/auth/google/callback` → set `GOOGLE_AUTH_CLIENT_ID`/`_SECRET`.
  - GitHub: github.com/settings/developers → New OAuth App → callback URL
    `<APP_BASE_URL>/api/auth/github/callback` → set `GITHUB_AUTH_CLIENT_ID`/`_SECRET`.
  Without these set, the button still appears but the server honestly returns `not_configured` rather than
  pretending to sign in.
- **Apple** (code real, UI held back — see above) — the client's native `expo-apple-authentication` modal hands
  back a signed identity token; the server verifies it directly against Apple's own public keys
  (`https://appleid.apple.com/auth/keys`, `apple.ts`) — no client secret needed. The bundle ID's "Sign In with
  Apple" capability is already enabled for real on `com.nexaai.chat` via the App Store Connect API.

One account per person regardless of which method they used: `findOrCreateSocialUser` (`socialAuth/common.ts`)
first looks up the provider's stable id (`appleUserId`/`googleAuthId`/`githubAuthId`/`phone` on `users`), then
falls back to linking a matching email, before creating a new account — with the same 2-day trial grant a normal
email signup gets. A phone-only or social-only account still gets a real (but securely random, never-disclosed)
`passwordHash`, since that column is `NOT NULL` and password login simply isn't offered for it.

## Forgot password

Real, real email, real one-time token — no dead end. `POST /api/auth/forgot-password` (called from the "Forgot
password?" link on the Auth screen's login form) always responds the same generic way regardless of whether the
email is registered, so it can't be used to probe which addresses have accounts. When it *is* registered, a
32-byte random token is generated, its sha256 hash (never the raw token) is saved on the user row with a 30-minute
expiry, and a real email goes out via Resend (`server/src/lib/email.ts`) linking to
`website/reset-password.html?token=...&email=...`, a small standalone page that calls `POST
/api/auth/reset-password` to set the new password — the token is checked with a constant-time hash comparison and
is single-use (cleared the moment it's redeemed). Needs `RESEND_API_KEY` — until set, the endpoint still returns
its generic "check your email" response (so the UI never looks broken) but honestly does nothing, rather than
pretending to have sent mail.

## The app icon/logo

`assets/icon.png` is the official NexaAi logo, used as-is (never recolored, cropped, or otherwise altered) for the
real iOS icon (`app.config.js`'s `icon`/`ios.icon`), the Android adaptive icon (`android.adaptiveIcon`, foreground
+ a white `backgroundColor` matching the logo's own background), the splash screen (`expo-splash-screen` plugin,
same reasoning — its `backgroundColor` is white to match rather than trying to key the logo onto something else),
and the website's favicon/nav mark (`website/favicon.png`, a real downscaled copy — the website's Express static
route only serves `nexaai/website`, not `nexaai/assets`, so a copy lives there too). One real attempt at a
transparent version for the splash screen (`ffmpeg colorkey`) silently faded out the "AI" wordmark's thin strokes,
so that was reverted rather than shipping an altered version of the official asset.

## Local development

```bash
cd nexaai
cp .env.example .env      # fill in what you have
npm install
npm run db:push           # creates tables in your Postgres database
npm run seed               # adds a few example businesses (NRMA etc.) + voice characters
npm run dev                 # runs the API (:5080) and Expo web (:8090ish) together
```

Open the Expo web URL it prints for the app, or scan the QR code with Expo Go. The account website is served by the
same API process at `/account` (e.g. `http://localhost:5080/account/index.html`) once the server is running.

**Why port 5080, not the more obvious 5060/5000/3000:** verified against a real Chromium browser during testing —
port 5060 is on Chrome's hardcoded list of "unsafe" ports (an old SIP-signaling reservation) and gets silently
blocked with `net::ERR_UNSAFE_PORT`, which breaks every API call from the website *and* from the mobile client's
own web build. If you change `PORT`, avoid Chrome's restricted list (5060/5061/6000/6666-6669 and a few dozen
others) or you'll hit the same wall.

**A second real bug this surfaced and fixed while testing in an actual browser:** `expo-secure-store` has no web
implementation at all — it throws rather than no-oping — so token storage (`client/src/lib/api.ts`) falls back to
`localStorage` on `Platform.OS === "web"` and uses SecureStore everywhere else. Without this, logging in from the
web build (part of `npm run dev`) fails outright.

## Deploying

Build command `npm run web:build && npm run server:build`, pre-deploy command `npm run db:push`, start command
`npm run server:start`. Set every env var from `.env.example` on your host.

Uploaded attachments live in `nexaai/uploads/` on local disk by default: most hosts (Render, Railway, etc.) wipe
this on every deploy/restart unless it's a persistent volume. Point it at S3-compatible object storage for anything
beyond local testing.

### Deploying to Render

`render.yaml` (repo root) is a real Render Blueprint — it provisions a managed Postgres database and the server as
one unit, rather than you clicking through each piece by hand:

1. Push this repo to GitHub (Render deploys from a connected repo).
2. Render dashboard → **New → Blueprint** → connect the repo. Render reads `render.yaml` and proposes the
   `nexaai-db` database and `nexaai-server` web service.
3. Apply it. Render provisions the database first, then builds and deploys the server — `DATABASE_URL` is wired
   automatically from the database to the service; you never type a connection string by hand.
4. You'll be prompted for the handful of secrets `render.yaml` deliberately doesn't hardcode: `ANTHROPIC_API_KEY`,
   `APP_BASE_URL`/`EXPO_PUBLIC_API_URL` (leave blank for the first deploy — see step 5), and `OWNER_EMAIL`/
   `OWNER_PHONE`. Everything else in `.env.example` (Paddle, Apple IAP, Meta/Slack/X/Notion/GitHub/Vercel/Netlify/
   Stripe/SiteSpark/Google connectors, the self-hosted model, Gemini, OpenAI voice) is optional and can be added
   later straight in the service's **Environment** tab — nothing about the Blueprint needs to change, since every
   one of those already degrades to a real "not configured" message until set, rather than pretending to work.
5. Once deployed, Render gives you a real URL (`https://nexaai-server-xxxx.onrender.com`, or your own domain —
   `asknexaai.com` is already registered for this app — once its DNS points here). Set `APP_BASE_URL` and
   `EXPO_PUBLIC_API_URL` to that real URL in the Environment tab and redeploy — these can't be known before the
   service exists once, so the Blueprint can't fill them in for you.
6. The `disk` in `render.yaml` gives `/uploads` a real persistent volume so attachments survive a redeploy — this
   needs a paid instance type (not Render's Free plan). For real production scale, switch attachment storage to an
   S3-compatible bucket instead (see above) rather than relying on a single instance's local disk.

The mobile app itself (Expo) isn't deployed by this Blueprint — it's built and submitted separately via
`eas build`/`eas submit` (see "What's intentionally stubbed" above) and just needs `EXPO_PUBLIC_API_URL` pointed at
this same deployed server.
