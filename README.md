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
- **Google Sign-In**: create an OAuth client at console.cloud.google.com, set `GOOGLE_WEB_CLIENT_ID`. Then wire `@react-native-google-signin/google-signin` (native) or Google Identity Services (web) in `WelcomeScreen.tsx` — the server-side verification endpoint (`POST /api/auth/google`) is already implemented.
- **Twilio** (real SMS delivery for phone OTP): set `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER`. Without it, OTP codes are logged to the server console instead of texted — fine for development, not for real users.
- **SMTP** (real email delivery for email OTP + owner report replies): set `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM`. Without it, emails are logged to the console instead of sent.
- **Courier tracking numbers** are validated against each carrier's real public numbering *format* (regex), not looked up live against AusPost/DHL/FedEx's tracking APIs — those require a business account with each carrier. If you want live tracking-number verification, add their APIs behind `shared/src/validation.ts`'s `isValidTrackingNumber`.
- **Persistent image storage**: uploaded card photos are saved to local disk (`/uploads`) by default, which is fine locally but is wiped on every Render deploy/restart. For production, swap `server/src/lib/upload.ts`'s disk storage for an S3-compatible bucket (Cloudflare R2, Backblaze B2, AWS S3).

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

## Deploying the API + database

The server (`server/`) is a standard Node/Express app — deploy it to Render (or any Node host) as a web service, with a managed Postgres database attached. Set every env var from `.env.example` in the host's dashboard. Build command: `npm run server:build`. Start command: `npm run server:start`.

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
