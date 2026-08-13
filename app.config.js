// Google's iOS OAuth client IDs look like "12345-abc.apps.googleusercontent.com" —
// the URL scheme @react-native-google-signin needs iOS configured with is that
// same string with the two labels swapped: "com.googleusercontent.apps.12345-abc".
function iosClientIdToUrlScheme(iosClientId) {
  const suffix = ".apps.googleusercontent.com";
  if (!iosClientId.endsWith(suffix)) return null;
  return `com.googleusercontent.apps.${iosClientId.slice(0, -suffix.length)}`;
}

// Google's own official public test App IDs — used as the default so the
// app builds and shows real (test) ads out of the box before real AdMob
// App IDs are configured, instead of crashing the native Ads SDK init on
// an empty/invalid App ID. See developers.google.com/admob/ios/test-ads
// and developers.google.com/admob/android/test-ads.
const ADMOB_TEST_IOS_APP_ID = "ca-app-pub-3940256099942544~1458002511";
const ADMOB_TEST_ANDROID_APP_ID = "ca-app-pub-3940256099942544~3347511713";

module.exports = () => {
  const googleIosClientId = process.env.GOOGLE_IOS_CLIENT_ID || "";
  const googleIosUrlScheme = googleIosClientId ? iosClientIdToUrlScheme(googleIosClientId) : null;
  const admobIosAppId = process.env.EXPO_PUBLIC_ADMOB_IOS_APP_ID || ADMOB_TEST_IOS_APP_ID;
  const admobAndroidAppId = process.env.EXPO_PUBLIC_ADMOB_ANDROID_APP_ID || ADMOB_TEST_ANDROID_APP_ID;

  return {
    expo: {
      name: "PullMarket TCG",
      slug: "pullmarket-tcg",
      owner: "adhams",
      version: "1.0.0",
      orientation: "portrait",
      icon: "./client/assets/icon.png",
      scheme: "pullmarket",
      userInterfaceStyle: "automatic",
      newArchEnabled: true,
      backgroundColor: "#0B0716",
      splash: {
        image: "./client/assets/splash-icon.png",
        resizeMode: "contain",
        backgroundColor: "#0B0716",
      },
      ios: {
        supportsTablet: true,
        bundleIdentifier: "com.pullmarket.tcg",
        icon: "./client/assets/icon.png",
        infoPlist: {
          NSCameraUsageDescription: "PullMarket needs camera access to scan and photograph cards you're listing for sale.",
          NSPhotoLibraryUsageDescription: "PullMarket needs photo library access so you can upload card photos from your library.",
          NSMotionUsageDescription: "PullMarket checks that your phone is steady so it can automatically capture card photos while scanning.",
          ITSAppUsesNonExemptEncryption: false,
        },
      },
      android: {
        package: "com.pullmarket.tcg",
        edgeToEdgeEnabled: true,
        adaptiveIcon: {
          foregroundImage: "./client/assets/adaptive-icon-foreground.png",
          backgroundColor: "#0B0716",
        },
        permissions: ["android.permission.CAMERA", "android.permission.READ_EXTERNAL_STORAGE"],
      },
      web: {
        output: "single",
        favicon: "./client/assets/favicon.png",
      },
      // EAS Update (OTA): lets JS/asset-only changes reach an
      // already-installed build without a new App Store review. Native
      // changes (new native modules, permissions, icons) still need a
      // full rebuild — OTA can't update those.
      updates: {
        url: "https://u.expo.dev/05a0dc7c-a7bb-472f-8260-671880a5b3e7",
      },
      runtimeVersion: {
        policy: "appVersion",
      },
      plugins: [
        [
          "expo-camera",
          {
            cameraPermission: "PullMarket needs camera access to scan and photograph cards you're listing for sale, and for video calls in chat.",
          },
        ],
        [
          "expo-image-picker",
          {
            photosPermission: "PullMarket needs photo library access so you can upload card photos.",
          },
        ],
        [
          "expo-notifications",
          {
            icon: "./client/assets/icon.png",
            color: "#2B6CB0",
          },
        ],
        "expo-web-browser",
        // Adds the required com.apple.developer.applesignin entitlement.
        "expo-apple-authentication",
        // Reads the device's region setting so the phone sign-in screen can
        // default its country-code picker to wherever the user actually is.
        "expo-localization",
        [
          "expo-splash-screen",
          {
            image: "./client/assets/splash-icon.png",
            imageWidth: 220,
            resizeMode: "contain",
            backgroundColor: "#0B0716",
          },
        ],
        // Only registers the native iOS URL scheme once GOOGLE_IOS_CLIENT_ID is
        // set — harmless to include the plugin either way, but the scheme is
        // required for Google's sign-in redirect to return to the app on iOS.
        ...(googleIosUrlScheme ? [["@react-native-google-signin/google-signin", { iosUrlScheme: googleIosUrlScheme }]] : []),
        // In-app audio and video calling (see contexts/CallContext.tsx).
        // Pinned to the Expo SDK 54-compatible release of this config plugin.
        [
          "@config-plugins/react-native-webrtc",
          {
            microphonePermission: "PullMarket needs microphone access so you can make audio and video calls to other users in chat.",
          },
        ],
        // Custom-built in-app checkout (CardField + confirmPayment — see
        // screens/CheckoutScreen.tsx) instead of Stripe's hosted checkout
        // page. No merchantIdentifier/enableGooglePay since this flow is
        // card-only, not Apple Pay/Google Pay — but the plugin must still
        // get an explicit (even empty) options object: passed as a bare
        // string, its internal `props` is undefined rather than `{}`, and
        // it crashes destructuring `undefined.merchantIdentifier` with no
        // error output at all (confirmed directly against @expo/config's
        // getConfig — this is a real bug in the plugin, not a config
        // mistake here).
        ["@stripe/stripe-react-native", {}],
        // Real App Tracking Transparency prompt (iOS 14.5+) — required
        // before requesting the IDFA that personalized AdMob ads use.
        // Declining just means AdMob falls back to non-personalized ads;
        // the app works identically either way.
        "expo-tracking-transparency",
        // Real AdMob ads (App Open + Banner — see lib/ads.ts). App IDs
        // default to Google's own public test IDs (above) until real ones
        // are configured, so the app always builds and shows working
        // (test) ads rather than crashing on an invalid App ID.
        [
          "react-native-google-mobile-ads",
          {
            iosAppId: admobIosAppId,
            androidAppId: admobAndroidAppId,
            userTrackingUsageDescription: "PullMarket uses this to show you more relevant ads. You can decline and still use the app normally.",
            skAdNetworkItems: ["cstr6suwn9.skadnetwork"],
          },
        ],
      ],
      extra: {
        API_URL: process.env.EXPO_PUBLIC_API_URL || "http://localhost:5050",
        STRIPE_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || "",
        // Real address-search autocomplete in checkout (see AddressSheet in
        // screens/CheckoutForm.native.tsx). iOS gets this for free from
        // Apple's own on-device address completer — no key needed. Android
        // needs a Google Places API key (Google Cloud Console → enable
        // "Places API" → create a key); without it Android checkout still
        // works, just without autocomplete suggestions while typing.
        GOOGLE_PLACES_API_KEY: process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY || "",
        GOOGLE_WEB_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || "",
        GOOGLE_IOS_CLIENT_ID: googleIosClientId,
        GOOGLE_ANDROID_CLIENT_ID: process.env.GOOGLE_ANDROID_CLIENT_ID || "",
        APPLE_SERVICES_ID: process.env.EXPO_PUBLIC_APPLE_SERVICES_ID || "",
        // Pro membership via real Apple In-App Purchase (see
        // lib/applePurchase.ts) — set once the subscription product exists
        // in App Store Connect. Empty until then, which just keeps the
        // purchase button from ever appearing rather than trying to buy a
        // product that doesn't exist.
        APPLE_IAP_PRODUCT_ID: process.env.EXPO_PUBLIC_APPLE_IAP_PRODUCT_ID || "",
        // Remove Ads — a separate one-time (non-consumable) IAP product.
        APPLE_IAP_REMOVE_ADS_PRODUCT_ID: process.env.EXPO_PUBLIC_APPLE_IAP_REMOVE_ADS_PRODUCT_ID || "",
        // Real AdMob ad unit IDs (see lib/ads.ts) — each falls back to
        // Google's own public test unit ID for that ad format/platform
        // (TestIds from react-native-google-mobile-ads) when unset, so
        // ads work for real in every build before real units are wired up.
        ADMOB_APP_OPEN_UNIT_ID_IOS: process.env.EXPO_PUBLIC_ADMOB_APP_OPEN_UNIT_ID_IOS || "",
        ADMOB_APP_OPEN_UNIT_ID_ANDROID: process.env.EXPO_PUBLIC_ADMOB_APP_OPEN_UNIT_ID_ANDROID || "",
        ADMOB_BANNER_UNIT_ID_IOS: process.env.EXPO_PUBLIC_ADMOB_BANNER_UNIT_ID_IOS || "",
        ADMOB_BANNER_UNIT_ID_ANDROID: process.env.EXPO_PUBLIC_ADMOB_BANNER_UNIT_ID_ANDROID || "",
        OWNER_PHONE_NUMBER: process.env.OWNER_PHONE_NUMBER || "+61474011265",
        eas: {
          projectId: "05a0dc7c-a7bb-472f-8260-671880a5b3e7",
        },
      },
    },
  };
};
