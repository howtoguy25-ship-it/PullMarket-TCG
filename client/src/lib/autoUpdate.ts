import { Platform } from "react-native";

/**
 * expo-updates' default behavior only checks for a new OTA update in the
 * background on launch — a newly-downloaded update doesn't actually become
 * the running JS bundle until the NEXT cold start after that. In practice
 * that means "force-quit and reopen" only fetches the update; it takes a
 * second force-quit-and-reopen to actually run it, which is exactly the
 * kind of thing that looks like "the fix didn't work" when it's really
 * just one relaunch short. This checks, fetches, and reloads immediately
 * on this same launch if a newer update is available, so one relaunch is
 * enough. No-op on web (no OTA concept there — web is always fresh from
 * the server) and in local dev (Updates is disabled in that case).
 */
export async function applyPendingUpdate(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const Updates = await import("expo-updates");
    if (!Updates.isEnabled) return;
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) return;
    await Updates.fetchUpdateAsync();
    await Updates.reloadAsync();
  } catch (err) {
    // Never let update-checking block the app from starting — a failed
    // check (offline, etc.) just means it stays on whatever's already
    // running, same as before this existed.
    console.warn("[autoUpdate] Update check failed:", err);
  }
}
