# PullMarket TCG

A mobile marketplace for buying and selling Pokémon and One Piece trading cards — built with Expo (React Native + web) and an Express/Postgres API.

## What's here

**Real, working end-to-end:**
- Phone OTP and email OTP sign-in (any country's dial code), first-time username creation, Google Sign-In endpoint, delete-account
- Home marketplace feed, search, multi-select franchise/condition filters
- Listing creation: camera "horizontal card scan" capture or gallery upload (up to 6 images, reorderable), title validated to mention "Pokémon" or "One Piece", description, price, condition, quantity
- Listing detail with swipeable image carousel + full-screen viewer, working star-to-favorite, +-to-cart
- Favorites tab, cart (grouped per seller), Stripe Checkout "Pay Now" → real hosted Stripe payment page
- $2 flat platform fee on every order, applied via Stripe Connect `application_fee_amount`, with the remainder auto-transferred to the seller's connected account
- Seller Stripe Connect Express onboarding, Stripe Identity verification (ID + selfie match) gating who can sell
- Orders tab (buying/selling), tracking-number entry validated against real Australia Post / DHL / FedEx number formats, "Mark as Shipped" gated on a valid tracking number, 5-business-day shipping deadline, buyer refund requests (before shipping) processed as real Stripe refunds
- In-app notifications for purchases, sales, shipping, "new card" alerts (subscribe by franchise)
- Report-a-listing → Owner Panel (gated to `OWNER_PHONE_NUMBER`) with incident detail + reply-by-email back to the reporter, user suspension

**Needs your own credentials to go fully live** (the code is real and wired up — these are third-party accounts only you can create):
- **Stripe**: sign up at stripe.com, enable Connect + Identity, set `STRIPE_SECRET_KEY` / `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` / `STRIPE_WEBHOOK_SECRET`. Until set, checkout/payouts/identity endpoints return a clear "not configured" message instead of pretending to work.
- **Google Sign-In**: fully wired on both web and native. Create an OAuth 2.0 Client ID (type "Web application") at console.cloud.google.com, add your live URL(s) to "Authorized JavaScript origins", and set `GOOGLE_WEB_CLIENT_ID` / `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — that alone makes the web button real (popup authorization-code flow via Google Identity Services, exchanged server-side at `POST /api/auth/google/code`). For iOS, also create an "iOS" type OAuth client with bundle ID `com.pullmarket.tcg` and set `GOOGLE_IOS_CLIENT_ID` — `app.config.js` derives the required URL scheme from it automatically. For Android, create an "Android" type client with package `com.pullmarket.tcg` and the SHA-1 fingerprint from your EAS build credentials (`eas credentials`), and set `GOOGLE_ANDROID_CLIENT_ID`. Native sign-in (`@react-native-google-signin/google-signin`) only works in an EAS-built app, not Expo Go or the web preview — it POSTs the resulting idToken to `POST /api/auth/google`, the same verification endpoint used everywhere else.
- **SMS delivery for phone OTP** (`server/src/lib/sms.ts` tries Vonage first, then Twilio, then falls back to console logging): **Vonage** is the easier path — sign up at vonage.com, grab the API key/secret from the dashboard (available instantly, no compliance review), set `VONAGE_API_KEY` / `VONAGE_API_SECRET` / `VONAGE_FROM` (an alphanumeric sender name like "PullMarket" — no need to buy a number). **Twilio** works too but requires a Trust Hub compliance profile to be approved before you can buy a number capable of sending SMS — set `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` if you go that route. Without either, OTP codes are logged to the server console instead of texted — fine for development, not for real users.
- **SMTP** (real email delivery for email OTP + owner report replies): set `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM`. Without it, emails are logged to the console instead of sent.
- **Courier tracking numbers** are validated against each carrier's real public numbering *format* (regex), not looked up live against AusPost/DHL/FedEx's tracking APIs — those require a business account with each carrier. If you want live tracking-number verification, add their APIs behind `shared/src/validation.ts`'s `isValidTrackingNumber`.
- **Persistent image storage**: uploads (avatars, listing photos, chat media, scanned card composites) are saved to local disk (`/uploads`) by default, which is fine locally but is wiped on every Render deploy/restart. Set `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` / `S3_ENDPOINT` / `S3_PUBLIC_URL_BASE` (see `.env.example`) to switch every upload over to S3-compatible object storage instead — Cloudflare R2 (recommended, no egress fees), Backblaze B2, or real AWS S3 — no code changes needed, just an account and a bucket.

## Project structure

```
client/   Expo app (React Native + react-native-web)
server/   Express API (TypeScript, Drizzle ORM, Postgres)
shared/   Drizzle schema + validation logic shared by client and server
```

## Local development

```bash
cp .env.example .env      # fill in what you have; everything else degrades gracefully
npm install
npm run db:push           # creates tables in your Postgres database
npm run seed               # optional: adds demo listings so the feed isn't empty
npm run dev                 # runs the API (:5050) and Expo web (:8090) together
```

Open http://localhost:8090 for the web build, or run `npm run dev:client` alone and scan the QR code with Expo Go for a real device.

## Deploying the API + web app — making it live and public

A single Node process serves both the JSON API and the exported web build (production-tested locally: `npm run web:build && npm run server:build && npm run server:start` serves everything from one port) — no separate frontend host needed.

**One-click path (recommended):** this repo includes `render.yaml`, a [Render Blueprint](https://render.com/docs/blueprint-spec). In the Render dashboard: **New → Blueprint** → connect the `PullMarket-TCG` GitHub repo → Render reads `render.yaml` and provisions a free Postgres database and a web service together automatically, with `DATABASE_URL` and `JWT_SECRET` wired up for you.

After the first deploy finishes:
1. Copy the URL Render assigned the service (top of its dashboard page, looks like `https://pullmarket-tcg.onrender.com`).
2. Service → **Environment** → set both `APP_BASE_URL` and `EXPO_PUBLIC_API_URL` to that exact URL.
3. Add the Stripe/Twilio/SMTP/Google values from the setup steps below as you get them (each one is optional at first — the app degrades gracefully, not silently, when one is missing).
4. Click **Manual Deploy → Deploy latest commit** to pick up the env var changes.

Your app is then live and public at that URL — open it in any browser for the web version, and point `EXPO_PUBLIC_API_URL` at it for the mobile build (see below) so the app in your pocket talks to the same live backend.

**Manual path (any Node host):** build command `npm run web:build && npm run server:build`, pre-deploy/migration command `npm run db:push`, start command `npm run server:start`. Set every env var from `.env.example`.

## Building & submitting the mobile app (via expo.dev / EAS)

This is the real, standard path to get PullMarket into the App Store / Play Store — Expo's own build service, not a local Xcode/Android Studio build:

```bash
npm install -g eas-cli
eas login
eas build:configure   # first time only — links this project to your expo.dev account and fills in extra.eas.projectId
eas build --profile preview --platform all      # internal test build
eas build --profile production --platform all   # store-ready build
eas submit --platform ios --profile production
eas submit --platform android --profile production
```

`eas.json` already defines `development` / `preview` / `production` build profiles and a `submit` profile — fill in your Apple Team ID, App Store Connect app ID, and Google Play service account key before submitting (see the placeholders in `eas.json`).

## Environment variables

See `.env.example` for the full list with explanations. At minimum for a working demo: `DATABASE_URL` and `JWT_SECRET`.

## Owner Panel

Set `OWNER_PHONE_NUMBER` (E.164, e.g. `+61474011265`) — whoever signs up with that phone number (or `OWNER_EMAIL`) automatically gets `isOwner = true` and sees the Owner Panel in their Profile tab: incident reports with the reporting customer's details, a reply box that emails them back, and user suspension.
