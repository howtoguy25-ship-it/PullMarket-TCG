import { useCallback } from "react";
import { Platform, Alert } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import * as ScreenCapture from "expo-screen-capture";
import { apiRequest } from "@/lib/api";

// Protects a buyer's real name/address/phone from being captured by the
// seller viewing their order. Android gets a real OS-level block —
// preventScreenCaptureAsync sets FLAG_SECURE, so a screenshot attempt just
// produces a black image, standard Android behavior for secure screens.
// iOS has no equivalent API — Apple gives third-party apps no way to block
// screenshots outright — so on iOS this instead detects the screenshot
// after the fact via the OS's screenshot-taken notification and reports
// it, which is the most that's actually possible there.
export function useShippingInfoScreenCapture(orderId: string | undefined, active: boolean) {
  useFocusEffect(
    useCallback(() => {
      if (!active || Platform.OS === "web") return;

      if (Platform.OS === "android") {
        void ScreenCapture.preventScreenCaptureAsync("shipping-info");
        return () => {
          void ScreenCapture.allowScreenCaptureAsync("shipping-info");
        };
      }

      const subscription = ScreenCapture.addScreenshotListener(() => {
        Alert.alert("Screenshot detected", "Screenshotting a buyer's delivery details isn't permitted — this has been logged and reported.");
        if (orderId) void apiRequest("POST", `/api/orders/${orderId}/screenshot-detected`).catch(() => {});
      });
      return () => subscription.remove();
    }, [active, orderId]),
  );
}
