// Google's iOS OAuth client IDs look like "12345-abc.apps.googleusercontent.com" —
// the URL scheme @react-native-google-signin needs iOS configured with is that
// same string with the two labels swapped: "com.googleusercontent.apps.12345-abc".
function iosClientIdToUrlScheme(iosClientId) {
  const suffix = ".apps.googleusercontent.com";
  if (!iosClientId.endsWith(suffix)) return null;
  return `com.googleusercontent.apps.${iosClientId.slice(0, -suffix.length)}`;
}

module.exports = () => {
  const googleIosClientId = process.env.GOOGLE_IOS_CLIENT_ID || "";
  const googleIosUrlScheme = googleIosClientId ? iosClientIdToUrlScheme(googleIosClientId) : null;

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
      ],
      extra: {
        API_URL: process.env.EXPO_PUBLIC_API_URL || "http://localhost:5050",
        STRIPE_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || "",
        GOOGLE_WEB_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || "",
        GOOGLE_IOS_CLIENT_ID: googleIosClientId,
        GOOGLE_ANDROID_CLIENT_ID: process.env.GOOGLE_ANDROID_CLIENT_ID || "",
        APPLE_SERVICES_ID: process.env.EXPO_PUBLIC_APPLE_SERVICES_ID || "",
        OWNER_PHONE_NUMBER: process.env.OWNER_PHONE_NUMBER || "+61474011265",
        eas: {
          projectId: "05a0dc7c-a7bb-472f-8260-671880a5b3e7",
        },
      },
    },
  };
};
