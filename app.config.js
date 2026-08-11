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
      plugins: [
        [
          "expo-camera",
          {
            cameraPermission: "PullMarket needs camera access to scan and photograph cards you're listing for sale.",
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
      ],
      extra: {
        API_URL: process.env.EXPO_PUBLIC_API_URL || "http://localhost:5050",
        STRIPE_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || "",
        GOOGLE_WEB_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || "",
        GOOGLE_IOS_CLIENT_ID: googleIosClientId,
        GOOGLE_ANDROID_CLIENT_ID: process.env.GOOGLE_ANDROID_CLIENT_ID || "",
        OWNER_PHONE_NUMBER: process.env.OWNER_PHONE_NUMBER || "+61474011265",
        eas: {
          projectId: "05a0dc7c-a7bb-472f-8260-671880a5b3e7",
        },
      },
    },
  };
};
