// Real, standalone HTML pages for Privacy Policy and Support — served
// directly by Express (mounted before the SPA catch-all in index.ts) so
// they're plain, reliably-reachable URLs independent of the RN web bundle.
// Required for App Store Connect's Privacy Policy URL / Support URL fields.

const SUPPORT_EMAIL = "Sales@pullmarkettcg.com";
const EFFECTIVE_DATE = "August 13, 2026";

function page(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} — PullMarket TCG</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 0; background: #120b26; color: #f2eefc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; }
  .wrap { max-width: 680px; margin: 0 auto; padding: 48px 24px 80px; }
  h1 { font-size: 28px; margin-bottom: 4px; }
  .meta { color: #b8aee0; font-size: 14px; margin-bottom: 32px; }
  h2 { font-size: 19px; margin-top: 36px; color: #ffd166; }
  p, li { color: #ded8f0; font-size: 15px; }
  a { color: #8ab4ff; }
  ul { padding-left: 20px; }
  .brand { font-weight: 800; letter-spacing: 0.3px; }
</style>
</head>
<body>
<div class="wrap">
  <div class="brand">PullMarket TCG</div>
  ${bodyHtml}
</div>
</body>
</html>`;
}

export function privacyPolicyHtml(): string {
  return page(
    "Privacy Policy",
    `
    <h1>Privacy Policy</h1>
    <div class="meta">Effective ${EFFECTIVE_DATE}</div>

    <p>PullMarket TCG ("we", "us") operates the PullMarket TCG marketplace app for buying and selling Pokémon and One Piece trading cards. This page explains what we collect, why, and how to control it.</p>

    <h2>Information we collect</h2>
    <ul>
      <li><strong>Account info:</strong> phone number or email (for sign-in and one-time codes), or your Google/Apple account identifier if you sign in that way; username, display name, and profile photo you choose to set.</li>
      <li><strong>Marketplace activity:</strong> listings you create (photos, descriptions, prices), orders, favorites, cart contents, and shipping addresses you provide at checkout.</li>
      <li><strong>Payments:</strong> handled by Stripe — we never see or store your full card number. Sellers set up payouts through Stripe Connect, which collects the identity/banking details Stripe requires directly.</li>
      <li><strong>Identity verification:</strong> sellers may be asked to verify their identity via Stripe Identity before listings go live; that verification is processed by Stripe, not stored by us beyond a verified/unverified status.</li>
      <li><strong>Messages:</strong> chat messages, photos, and videos you send other users through the app, so the conversation can be delivered and displayed.</li>
      <li><strong>Device & usage:</strong> basic technical data (device type, app version, crash/error logs) needed to keep the app working.</li>
      <li><strong>Advertising identifiers:</strong> if you haven't purchased Remove Ads, Google AdMob may collect device advertising identifiers to serve ads, subject to Google's own privacy policy and your device's ad-tracking settings.</li>
    </ul>

    <h2>How we use it</h2>
    <ul>
      <li>To operate the marketplace: listings, search, checkout, shipping, and order tracking.</li>
      <li>To deliver chat messages, calls, and notifications between users.</li>
      <li>To process payments, subscriptions (PullMarket Pro), and one-time purchases (Remove Ads) via Stripe or Apple In-App Purchase.</li>
      <li>To review reports of scams, harassment, or inappropriate content — including automated screening of chat messages for likely scam or abuse patterns, which may flag a message for human review by our team.</li>
      <li>To send account, order, and message notifications you'd expect from an active marketplace app.</li>
    </ul>

    <h2>Who we share it with</h2>
    <p>We don't sell your personal data. We share the minimum needed with the services that make the app work: Stripe (payments, payouts, identity verification), Google/Apple (sign-in, and Apple In-App Purchases), our SMS/email providers (one-time sign-in codes), Google Cloud Storage (photo/video hosting), and Google AdMob (ads, only if you haven't purchased Remove Ads). Other users see what you'd expect on a marketplace: your username, listings, profile, and messages you send them directly.</p>

    <h2>Your choices</h2>
    <ul>
      <li>Edit your profile and listings any time from the app.</li>
      <li>Block another user, or report a listing/order/message/user, from the relevant screen.</li>
      <li>Turn off read receipts in Profile → Privacy.</li>
      <li>Delete your account from Profile → Delete account. This starts a 30-day grace period (in case it was a mistake or someone else's action), after which your account and associated data are permanently deleted, other than records we're legally required to keep (e.g. transaction records).</li>
    </ul>

    <h2>Children</h2>
    <p>PullMarket TCG is not directed at children under 13, and we don't knowingly collect data from them.</p>

    <h2>Changes</h2>
    <p>We'll update the effective date above if this policy changes materially.</p>

    <h2>Contact</h2>
    <p>Questions about this policy or your data: <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>
  `,
  );
}

export function supportHtml(): string {
  return page(
    "Support",
    `
    <h1>Support</h1>
    <div class="meta">We usually reply within 1–2 business days</div>

    <p>Need help with an order, a listing, your account, or something in the app isn't working? Reach us at <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>

    <h2>Before you email us</h2>
    <ul>
      <li><strong>In the app:</strong> the fastest way to get help is the AI Help Assistant — open Profile → Support → AI Help Assistant. It can answer most "how do I…" questions instantly.</li>
      <li><strong>A specific order, listing, message, or user:</strong> use the Report button on that item (listing, order, conversation, message, or profile) so our team gets the right context automatically.</li>
      <li><strong>Billing (PullMarket Pro / Remove Ads):</strong> manage or cancel from Profile → PullMarket Pro, or the App Store's Subscriptions page if you subscribed via Apple.</li>
    </ul>

    <h2>Email us directly for</h2>
    <ul>
      <li>Account access issues (can't sign in, lost access to your phone/email)</li>
      <li>Account deletion requests or questions</li>
      <li>Anything the in-app options above don't cover</li>
    </ul>

    <p>See also our <a href="/privacy">Privacy Policy</a>.</p>
  `,
  );
}

export function deleteAccountHtml(): string {
  return page(
    "Delete Your Account",
    `
    <h1>Delete Your Account</h1>
    <div class="meta">PullMarket TCG</div>

    <p>You can permanently delete your PullMarket TCG account and its associated data at any time, directly from the app.</p>

    <h2>Steps to delete your account</h2>
    <ul>
      <li>Open the PullMarket TCG app and sign in.</li>
      <li>Go to <strong>Profile</strong>.</li>
      <li>Scroll to the bottom and tap <strong>Delete account</strong>.</li>
      <li>Confirm the deletion when prompted.</li>
    </ul>

    <p>This starts a 30-day grace period (in case it was a mistake, or someone else's action), after which your account and associated data are permanently deleted — other than records we're legally required to keep, such as transaction records.</p>

    <h2>Data deleted</h2>
    <p>This removes your profile, listings, favorites, cart, messages, and account preferences. Order and transaction history tied to completed purchases may be retained as required by law.</p>

    <h2>Can't sign in to delete your account?</h2>
    <p>If you've lost access to your phone number or email and can't sign in, email us at <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> from an address we can use to verify you, and we'll process the deletion request manually.</p>

    <p>See also our <a href="/privacy">Privacy Policy</a>.</p>
  `,
  );
}
