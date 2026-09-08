module.exports = {
  expo: {
    name: "NexaAi",
    slug: "nexaai",
    scheme: "nexaai",
    version: "0.1.0",
    orientation: "portrait",
    userInterfaceStyle: "dark",
    backgroundColor: "#05040F",
    icon: "./assets/icon.png",
    ios: {
      bundleIdentifier: "com.nexaai.app",
      supportsTablet: false,
      icon: "./assets/icon.png",
      infoPlist: {
        NSCameraUsageDescription: "NexaAi uses your camera so you can snap a photo and ask the AI about it, and for the optional face-based check-in feature.",
        NSMicrophoneUsageDescription: "NexaAi uses your microphone for real-time voice conversations with the AI.",
        NSPhotoLibraryUsageDescription: "NexaAi lets you attach photos from your library to ask the AI about them.",
        NSLocationWhenInUseUsageDescription: "NexaAi uses your location to find the closest business when you ask for real-world assistance.",
        NSCalendarsUsageDescription: "NexaAi can read your calendar so it can factor your schedule into its answers.",
        NSRemindersUsageDescription: "NexaAi can read your reminders so it can factor your to-dos into its answers.",
      },
    },
    android: {
      package: "com.nexaai.app",
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
    },
  },
};
