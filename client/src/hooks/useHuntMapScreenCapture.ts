import { useCallback } from "react";
import { Platform, Alert } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import * as ScreenCapture from "expo-screen-capture";
import { apiRequest } from "@/lib/api";

// Stops entrants from sharing the hidden card's real location with anyone
// who hasn't paid to enter. Android gets a real OS-level block —
// preventScreenCaptureAsync sets FLAG_SECURE, so a screenshot attempt just
// produces a black image. iOS has no equivalent API — Apple gives
// third-party apps no way to block screenshots outright — so on iOS this
// instead detects the screenshot after the fact via the OS's
// screenshot-taken notification and reports it, which is the most that's
// actually possible there (same pattern as useShippingInfoScreenCapture).
export function useHuntMapScreenCapture(gameId: string | undefined, active: boolean) {
  useFocusEffect(
    useCallback(() => {
      if (!active || !gameId || Platform.OS === "web") return;

      if (Platform.OS === "android") {
        void ScreenCapture.preventScreenCaptureAsync("hunt-map");
        return () => {
          void ScreenCapture.allowScreenCaptureAsync("hunt-map");
        };
      }

      const subscription = ScreenCapture.addScreenshotListener(() => {
        Alert.alert("Screenshot detected", "Screenshotting the hunt map to share the location isn't permitted — this has been logged and reported to the owner.");
        void apiRequest("POST", `/api/hunt/${gameId}/screenshot-detected`).catch(() => {});
      });
      return () => subscription.remove();
    }, [active, gameId]),
  );
}
