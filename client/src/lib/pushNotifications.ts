import { Platform } from "react-native";
import Constants from "expo-constants";
import { apiJson } from "@/lib/api";

/**
 * Requests notification permission (if needed), grabs this device's Expo
 * push token, and registers it with the server so real push notifications
 * can be sent — not just in-app ones. Native only; web push isn't wired up.
 */
export async function registerPushToken(): Promise<void> {
  if (Platform.OS === "web") return;

  try {
    const Notifications = await import("expo-notifications");

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== "granted") return;

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const { data: pushToken } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    if (!pushToken) return;

    await apiJson("POST", "/api/notifications/push-token", { pushToken });
  } catch (err) {
    // Push tokens are a nice-to-have — a simulator, denied permission, or a
    // transient failure here should never block sign-in or app usage.
    console.warn("Push token registration skipped:", err);
  }
}

export async function clearPushToken(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await apiJson("POST", "/api/notifications/push-token", { pushToken: null });
  } catch {
    // best-effort on sign-out
  }
}
