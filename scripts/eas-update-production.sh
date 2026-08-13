#!/bin/bash
# Publishes an EAS Update to the "production" branch.
#
# `eas update` runs a local `expo export`, which reads EXPO_PUBLIC_* vars
# from the shell environment / .env — it does NOT read eas.json's
# build-profile "env" blocks (those only apply to `eas build`) and does NOT
# pick up EAS's server-side "environments" unless --environment is passed.
# Local .env intentionally points EXPO_PUBLIC_API_URL at localhost for dev,
# so running a bare `eas update` from this repo silently bakes localhost
# into the production bundle — every API call (including every sign-in
# method) then fails on real devices with no useful error beyond "network
# error", because there's nothing at that address to reach.
#
# This happened for real (multiple production updates shipped broken
# before this script existed) and is exactly why it exists now: the
# correct values are hardcoded here, matching eas.json's "production"
# build profile exactly, so a plain `npm run update:production` can never
# regress this again regardless of what .env happens to contain locally.
set -euo pipefail
cd "$(dirname "$0")/.."

export EXPO_PUBLIC_API_URL="https://www.pullmarkettcg.com"
export EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID="878738587499-f1m1h9scgone6mb3md478ikqj4qlbed2.apps.googleusercontent.com"
export GOOGLE_IOS_CLIENT_ID="878738587499-tpejf58kvvkjik0bjc9b8o64fqgkb0hd.apps.googleusercontent.com"
export EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_live_51U2mdu2f6K1SHrtxXbmx0a9z0zqDJk6MUprjIIQllIInTI55O4sraHPlGP5xjn7h0aq2pOgj9ojNSYWhwPGkenG900fvImHCoJ"
export EXPO_PUBLIC_ADMOB_IOS_APP_ID="ca-app-pub-6423632749110820~9022361895"
export EXPO_PUBLIC_ADMOB_BANNER_UNIT_ID_IOS="ca-app-pub-6423632749110820/1487290684"
export EXPO_PUBLIC_ADMOB_APP_OPEN_UNIT_ID_IOS="ca-app-pub-6423632749110820/2756336446"

MESSAGE="${1:-Production update}"
npx eas-cli update --branch production --message "$MESSAGE" --non-interactive
