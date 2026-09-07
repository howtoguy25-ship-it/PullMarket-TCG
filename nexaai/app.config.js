module.exports = {
  expo: {
    name: "NexaAi",
    slug: "nexaai",
    scheme: "nexaai",
    version: "0.1.0",
    orientation: "portrait",
    userInterfaceStyle: "dark",
    backgroundColor: "#05040F",
    ios: {
      bundleIdentifier: "com.nexaai.app",
      supportsTablet: false,
      infoPlist: {
        NSCameraUsageDescription: "NexaAi uses your camera so you can snap a photo and ask the AI about it, and for the optional face-based check-in feature.",
        NSMicrophoneUsageDescription: "NexaAi uses your microphone for real-time voice conversations with the AI.",
        NSPhotoLibraryUsageDescription: "NexaAi lets you attach photos from your library to ask the AI about them.",
      },
    },
    android: {
      package: "com.nexaai.app",
      permissions: ["CAMERA", "RECORD_AUDIO"],
    },
    web: {
      bundler: "metro",
      output: "single",
    },
    plugins: ["expo-camera", "expo-secure-store"],
    extra: {
      apiUrl: process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:5060",
    },
  },
};
