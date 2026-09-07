# NexaAi

A galaxy-themed AI assistant app: real-time chat + voice with a custom bot character, camera "ask about this photo",
tiered plans (Beginner/Pro/Max) with credit-based billing and session limits, a custom-agent builder, and a
companion account website. Built as a fully separate project inside this repo — it does not touch or depend on
PullMarket TCG's code.

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
  reveal effect) — text in, formatted answer out (bold headings, numbered steps, image-hint callouts), with an
  animated "thinking… tinkering… gathering info…" state while waiting
- A bot avatar that actually talks: its mouth opens/closes in an irregular loop while tokens are streaming in, and
  again while `expo-speech`'s own playback callbacks confirm audio is actually sounding out — not a decorative loop
  that runs regardless of state
- Answer-count toggle: 1 ("strong, straight to the point"), 2 ("extra info"), or 3 (normal) answers per question —
  and if you explicitly ask for a specific number in the message itself, that overrides the toggle for that message
- Camera "ask about this photo": snap a photo, ask a question, the photo + question go to Claude together
- Voice memo recording (real audio capture via `expo-av`) with an edit-before-send step
- On-device text-to-speech playback of NexaAi's replies, with 4 switchable voice characters (gender + tone presets)
- Three plan tiers (Beginner/Pro/Max) mapped to real, different Claude models + token budgets — not a fake label:
  Max genuinely gets a stronger model, a bigger thinking budget, and more output tokens than Beginner
- Real credit ledger (every purchase/spend is its own row, balance is always summed — it can't drift), a $1 grace
  overage before a session is paused, weekly session-time limits that reset every Monday 05:00 **Australia/Sydney**
  time regardless of the user's own timezone, and a daily session-count cap — with an in-app banner (Claude-style)
  showing the reset time in both Sydney time and the viewer's own timezone
- "Find nearest assistance" flow: describe a problem (e.g. a car issue), NexaAi asks clarifying questions, then
  the app looks up the nearest matching business from its own directory and hands off to Apple Maps / Google Maps /
  your own TrackLine app for directions
- Custom agent builder: describe an automation in your own words (e.g. "reply to Instagram DMs about pricing"), and
  safely preview what it would reply via a real Claude-generated draft — before connecting it to any real account
- A companion account website (`/website`) for logging in, buying credit packs or a custom amount, and changing
  settings — separate from the chat experience, which lives in the app, per the product spec
- **Permissions screen** (Settings → Permissions): real OS permission status for Camera, Microphone, Location,
  Calendar, and (iOS) Reminders, using each platform's actual permission API. Toggling on requests it for real;
  toggling off an already-granted permission opens the system Settings app, since no app can revoke its own
  permission grant — only iOS/Android can do that.
- **Capabilities screen** (Settings → Capabilities & memory): six real feature toggles (camera-ask, nearest-business
  lookup, who-is lookups, agent builder, auto-speak, live typing) that are enforced **server-side** — turning one off
  makes the matching API endpoint refuse the request with a clear message, not just hide a button.
- **Real memory core**: after each turn, a cheap/fast Claude call decides whether anything durable and safe is worth
  remembering (a preference, an ongoing project) and saves it — gated by the "Generate memory from chats" toggle, with
  a separate "Reference past chats" toggle for whether saved memory is read back into future conversations, and an
  "Include sensitive topics" toggle (off by default) for health/religion/political/etc-adjacent facts. A dedicated
  "Memory files" screen lists everything saved, individually deletable or clearable all at once.
- **Connectors screen** (Settings → Connectors): links a user's account to other platforms. Google is wired
  end-to-end with a real OAuth 2.0 Authorization Code flow (Calendar read access); Notion/Slack/Instagram/WhatsApp
  are real UI rows that honestly report "not set up yet" with exactly which env vars an admin needs to add, the same
  pattern as this README's Paddle/Apple IAP sections.

## Real, but needs your own credentials to go fully live

- **Anthropic API** (the actual brain): sign up at console.anthropic.com, set `ANTHROPIC_API_KEY`. Without it, chat
  returns a clear "not configured" placeholder instead of pretending to answer.
- **Paddle** (website credit-pack checkout — chosen as "something other than Stripe" per the spec; Paddle acts as
  merchant-of-record so it handles its own card processing and global tax): sign up at paddle.com, create one-time
  Price objects for each pack, set `PADDLE_API_KEY` / `PADDLE_WEBHOOK_SECRET` / `PADDLE_PRICE_ID_35` / `_80` / `_115`
  / `_175`. Until set, checkout returns a clear "not configured" error.
- **Apple In-App Purchase** (iOS in-app credit purchases): Apple requires digital consumables bought *inside* an iOS
  app to go through StoreKit, not a web checkout — see "Why two payment paths" below. Create an App Store Connect
  in-app-purchase API key and set `APPLE_IAP_KEY_ID` / `APPLE_IAP_ISSUER_ID` / `APPLE_IAP_PRIVATE_KEY` /
  `APPLE_IAP_BUNDLE_ID`. The server-side receipt verification in `server/src/lib/payments/appleIap.ts` is scaffolded
  against Apple's real App Store Server API but deliberately left unfinished — it needs your downloaded Apple root
  certs, which can't be fetched from inside this session.
- **TrackLine** (your own maps app): set `EXPO_PUBLIC_TRACKLINE_URL_SCHEME` (its custom URL scheme) and
  `EXPO_PUBLIC_TRACKLINE_APP_STORE_URL` once it's built/published; `client/src/lib/maps.ts` already builds real deep
  links and falls back to the App Store page if TrackLine isn't installed.
- **Meta Graph API** (actually running an Instagram DM or WhatsApp agent against a real account): needs a reviewed
  Meta Developer app with `instagram_manage_messages` or WhatsApp Cloud API access — see the comments in
  `server/src/lib/agents/agentRunner.ts`. The agent builder itself, and safe reply-drafting, work today without this.
- **Google connector** (Settings → Connectors, Calendar read access): create a Google Cloud project, enable the
  Calendar API, add an OAuth Web application client with `<APP_BASE_URL>/api/connectors/google/callback` as an
  authorized redirect URI, and set `GOOGLE_CONNECTOR_CLIENT_ID` / `GOOGLE_CONNECTOR_CLIENT_SECRET` / `APP_BASE_URL`.
  Deliberately a separate OAuth client from the root PullMarket TCG app's own Google Sign-In. Token storage in
  `nexaai_connectors` is plain text in this scaffold — **encrypt at rest before a real launch.**
- **Notion / Slack / Instagram / WhatsApp connectors**: each needs that platform's own developer app credentials
  (`NOTION_CLIENT_ID`/`_SECRET`, `SLACK_CLIENT_ID`/`_SECRET`, `META_APP_ID`/`_SECRET`) — the Connectors screen tells
  you exactly which env vars are missing per connector; none of them have OAuth wired up yet beyond Google.

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
- **Custom ML model training** ("build your own model"). Claude can write real PyTorch/TensorFlow training code and
  data-prep scripts on request — that's a coding task, and this repo doesn't need one yet since the app's own AI
  answers come from the Claude API, not a locally trained model. If/when a specific custom model is needed (e.g. a
  bespoke classifier), ask for that as its own task with a concrete dataset and goal.
- **Submitting to the App Store.** Needs your own Apple Developer account, signing certificates, and a human
  clicking through App Store Connect — `eas build`/`eas submit` (already used by the root PullMarket TCG app) is the
  real path once `nexaai/eas.json` is filled in with your Apple Team ID.

## Why two payment paths (Paddle + Apple IAP)

Apple's App Store Review Guideline 3.1.1 requires **digital, in-app-consumable goods bought from inside an iOS app**
(NexaAi's credits, bought via the app's own "Add credits" button) to go through StoreKit/In-App Purchase — a Paddle
or PayPal web checkout opened from inside the iOS app for this specific purchase would get the app rejected. That's
why:
- **Website** "Add credits" → Paddle hosted checkout (real, not Stripe, exactly as asked).
- **iOS app** "Add credits" → must use real StoreKit purchases (e.g. `react-native-iap`) with Product IDs matching
  `CREDIT_PACKS`, verified server-side via `lib/payments/appleIap.ts`. If you'd rather route iOS credit top-ups to
  the website (a plain external link) instead of building StoreKit purchases, note Apple's separate "External
  Purchase Link" entitlement/review process applies — the app can't just open a payment webpage for this without
  that.

## The weekly/daily session-limit "rest" algorithm

The spec's example (usage starts at 1pm, runs out at 2:47pm, and the next allowed time is "4pm or 3:30pm depending
on how it was used") is illustrative, not an exact formula — `server/src/lib/usageClock.ts` turns it into one
explicit, documented rule: round the moment credits/time ran out up to the next 30-minute boundary, then add one more
30-minute slot if usage was paced smoothly, or a full extra hour if messages were fired back-to-back ("forced"). The
weekly cap always resets Monday 05:00 **Australia/Sydney** time for every user, worldwide, per the spec.

## Local development

```bash
cd nexaai
cp .env.example .env      # fill in what you have
npm install
npm run db:push           # creates tables in your Postgres database
npm run seed               # adds a few example businesses (NRMA etc.) + voice characters
npm run dev                 # runs the API (:5060) and Expo web (:8090ish) together
```

Open the Expo web URL it prints for the app, or scan the QR code with Expo Go. The account website is served by the
same API process at `/account` (e.g. `http://localhost:5060/account/index.html`) once the server is running.

## Deploying

Same shape as the root app: build command `npm run web:build && npm run server:build`, pre-deploy command
`npm run db:push`, start command `npm run server:start`. Set every env var from `.env.example` on your host.
