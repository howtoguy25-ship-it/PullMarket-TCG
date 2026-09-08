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
  inbound webhooks from Instagram/WhatsApp, real drafts, and real sends via Meta's Graph API once connected. See
  "The agent builder's live-send capability" below for what that needs from you and Meta's App Review.
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
- **Meta Graph API / agent builder live-send** (actually running an Instagram DM or WhatsApp agent against a real
  account): set `META_APP_ID` / `META_APP_SECRET` / `APP_BASE_URL` / `META_WEBHOOK_VERIFY_TOKEN` — see "The agent
  builder's live-send capability" below for the full setup and the real App Review requirement.
- **Google connector** (Settings → Connectors, Calendar read access): create a Google Cloud project, enable the
  Calendar API, add an OAuth Web application client with `<APP_BASE_URL>/api/connectors/google/callback` as an
  authorized redirect URI, and set `GOOGLE_CONNECTOR_CLIENT_ID` / `GOOGLE_CONNECTOR_CLIENT_SECRET` / `APP_BASE_URL`.
  Deliberately a separate OAuth client from the root PullMarket TCG app's own Google Sign-In. Token storage in
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

**The SiteSpark connector, and why it's shaped the way it is.** Per the explicit decision behind this feature: this
app does not become SiteSpark, and SiteSpark's code isn't in this repo — instead, Connectors gained a real "connect
your SiteSpark account" entry, the same way Claude.ai's own Connectors let you link an external account. Because
SiteSpark is genuinely a separate app with no fixed API this session has ever seen, `lib/connectors/sitespark.ts`
is a generic, standard OAuth 2.0 Authorization Code client (RFC 6749) rather than a bespoke integration — it
becomes real and functional the moment SiteSpark implements the three endpoints any OAuth provider needs
(authorize, token exchange, "who am I"). Until then it shows as "not set up yet," the same honest pattern every
other missing-credentials connector in this app uses.

**GitHub, Vercel, Netlify, Stripe, and Namecheap** round out what a Project actually needs to go from code to a
live, real site: push to a repo, deploy it, take payments on it, and point a domain at it. All five are real OAuth
(or, for Namecheap, real manual API-key entry — it has no OAuth flow) — see `server/src/lib/connectors/` for each.
None of this is wired into an automatic "one-click ship it" pipeline yet; the model will tell you plainly which
connector a step depends on and whether it's connected, rather than pretending a site went live when it didn't.

## The agent builder's live-send capability

Once a business connects Instagram and/or WhatsApp (Settings → Connectors) and activates an agent for that
platform, real inbound messages actually reach it:

1. Meta calls `POST /api/webhooks/meta` (real signature-verified webhook — `server/src/routes/webhooks/meta.ts`)
   with the incoming DM/message.
2. The message is matched to the connected account (by Instagram business account ID or WhatsApp
   `phone_number_id`) and that account's active agent.
3. Claude drafts a reply (`lib/agents/agentRunner.ts`'s `dryRunAgent`, same function the safe-preview button uses).
4. If the agent's "autoSend" is on, the reply is sent immediately via `lib/agents/metaGraph.ts`'s real Graph API
   call. If it's off, the draft lands in the Agents screen's "Waiting for your approval" list instead, for the
   business owner to approve (sends it) or reject (discards it) by hand.

**What you need before any of this works with real customers:**
- Your own Meta Developer app (`META_APP_ID` / `META_APP_SECRET` / `APP_BASE_URL` / `META_WEBHOOK_VERIFY_TOKEN`).
- **Instagram**: connects via a real OAuth flow (Settings → Connectors → Instagram) — Facebook Login for Business,
  discovering the Page + linked Instagram professional account you manage.
- **WhatsApp**: connects via a manual credential-entry form (Settings → Connectors → WhatsApp), not OAuth — that's
  the real, standard way third-party apps use WhatsApp Cloud API without Meta's separate, more heavily gated
  "Embedded Signup" product. You paste the permanent access token and phone_number_id Meta Business Suite gives
  you when you set up WhatsApp Cloud API there.
- **Meta App Review.** Both `instagram_manage_messages` and `whatsapp_business_messaging` are restricted
  permissions — until Meta approves your app's review submission for them, this only works with accounts you've
  explicitly added as Testers/Developers on your Meta app. That review is a real external process (can take days
  to weeks, isn't guaranteed) that no code here can shortcut.
- Registering the webhook URL (`<APP_BASE_URL>/api/webhooks/meta`) and your verify token in the Meta App Dashboard,
  and subscribing to the relevant webhook fields (`messages` for both platforms).

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

Buying credits already worked this way before this pass: iOS always opens the website's real Paddle checkout
(`CreditsScreen.tsx` → `WebBrowser.openBrowserAsync`) rather than a native card form, both because Apple's rules
require it for external purchase links and because it's what lets the website's checkout offer a custom dollar
amount that a fixed-tier Apple IAP product can't.

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
  a real 403 (`{"error":"not_owner"}`); the matching account sees real numbers.
- **Account deletion** (`POST /api/auth/delete-account`): requires re-entering your password (checked with the
  same bcrypt comparison as login), then genuinely `DELETE`s the user row. Every other table's `userId` column is
  declared `onDelete: "cascade"` in `shared/src/schema.ts`, so Postgres itself removes every chat, project, credit
  transaction, connector, memory entry, and API key — verified against the real API: deleting an account, then
  trying to log in with the same credentials, returns "Invalid email or password."

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

Same shape as the root app: build command `npm run web:build && npm run server:build`, pre-deploy command
`npm run db:push`, start command `npm run server:start`. Set every env var from `.env.example` on your host.

Uploaded attachments live in `nexaai/uploads/` on local disk by default — same caveat as the root PullMarket TCG
app's own `/uploads`: most hosts (Render, Railway, etc.) wipe this on every deploy/restart unless it's a persistent
volume. Point it at S3-compatible object storage for anything beyond local testing.
