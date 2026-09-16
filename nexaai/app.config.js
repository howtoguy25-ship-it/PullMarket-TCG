module.exports = {
  expo: {
    name: "NexaAi",
    slug: "nexaai",
    owner: "adhams",
    scheme: "nexaai",
    version: "0.1.0",
    orientation: "portrait",
    userInterfaceStyle: "dark",
    backgroundColor: "#05040F",
    icon: "./assets/icon.png",
    // Real EAS Update wiring — OTA JS-bundle updates land straight on
    // installed builds without an App Store review cycle, as long as the
    // change is JS/asset-only (no new native module, no Info.plist change).
    // "appVersion" runtime policy means any update published while this
    // app.config.js's top-level `version` is unchanged is eligible for
    // every install on that version — bump `version` for a native change.
    updates: {
      url: "https://u.expo.dev/1aa03477-d453-4853-a2ee-bac238531185",
    },
    runtimeVersion: {
      policy: "appVersion",
    },
    ios: {
      bundleIdentifier: "com.nexaai.chat",
      // No hardcoded buildNumber here — eas.json's "appVersionSource":
      // "remote" means EAS itself tracks and auto-bumps the real
      // CFBundleVersion on its servers (required for every App Store /
      // TestFlight submission); a local value here would just be ignored.
      supportsTablet: false,
      icon: "./assets/icon.png",
      infoPlist: {
        // The app only uses standard HTTPS/TLS (exempt) — no custom or
        // proprietary encryption — so this is a real "no" answer, not a
        // placeholder, and skips App Store Connect's manual export
        // compliance question on every submission.
        ITSAppUsesNonExemptEncryption: false,
        NSCameraUsageDescription: "NexaAi uses your camera so you can snap a photo and ask the AI about it, and for the optional face-based check-in feature.",
        NSMicrophoneUsageDescription: "NexaAi uses your microphone for real-time voice conversations with the AI.",
        NSPhotoLibraryUsageDescription: "NexaAi lets you attach photos from your library to ask the AI about them.",
        NSLocationWhenInUseUsageDescription: "NexaAi uses your location to find the closest business when you ask for real-world assistance.",
        NSCalendarsUsageDescription: "NexaAi can read your calendar so it can factor your schedule into its answers.",
        NSRemindersUsageDescription: "NexaAi can read your reminders so it can factor your to-dos into its answers.",
      },
    },
    android: {
      package: "com.nexaai.chat",
      versionCode: 1,
      permissions: ["CAMERA", "RECORD_AUDIO", "ACCESS_COARSE_LOCATION", "ACCESS_FINE_LOCATION", "READ_CALENDAR", "WRITE_CALENDAR"],
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#FFFFFF",
      },
    },
    web: {
      bundler: "metro",
      output: "single",
      favicon: "./assets/favicon.png",
    },
    plugins: [
      "expo-camera",
      "expo-secure-store",
      "expo-location",
      "expo-calendar",
      "expo-font",
      // Sets the real com.apple.developer.applesignin entitlement on the
      // built binary — the "Sign In with Apple" capability was already
      // enabled on the bundle ID itself via the Developer API.
      "expo-apple-authentication",
      [
        "expo-splash-screen",
        {
          // Uses the official logo's own white background as-is (matching
          // backgroundColor here) rather than keying it transparent — an
          // automated colorkey pass tried that and silently faded out the
          // "AI" wordmark's thin strokes, which is not acceptable for the
          // official app icon/logo asset.
          image: "./assets/splash-icon.png",
          imageWidth: 320,
          resizeMode: "contain",
          backgroundColor: "#FFFFFF",
        },
      ],
    ],
    extra: {
      apiUrl: process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:5080",
      eas: {
        projectId: "1aa03477-d453-4853-a2ee-bac238531185",
      },
    },
  },
};
