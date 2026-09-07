import { Linking, Platform } from "react-native";

export type MapsApp = "apple" | "google" | "trackline";

export interface DestinationInfo {
  label: string;
  address?: string;
  lat?: number;
  lng?: number;
}

// TrackLine is the user's own separately-built maps app. This module can
// only deep-link into it once its real URL scheme and App Store listing
// exist — set both here once you have them (see nexaai/.env.example /
// README "TrackLine integration").
export const TRACKLINE_URL_SCHEME = process.env.EXPO_PUBLIC_TRACKLINE_URL_SCHEME || "trackline://";
export const TRACKLINE_APP_STORE_URL = process.env.EXPO_PUBLIC_TRACKLINE_APP_STORE_URL || "";

function query(dest: DestinationInfo): string {
  if (dest.lat != null && dest.lng != null) return `${dest.lat},${dest.lng}`;
  return dest.address ?? dest.label;
}

export function buildMapsUrl(app: MapsApp, dest: DestinationInfo): string {
  const q = encodeURIComponent(query(dest));
  switch (app) {
    case "apple":
      return `https://maps.apple.com/?daddr=${q}&q=${encodeURIComponent(dest.label)}`;
    case "google":
      return `https://www.google.com/maps/dir/?api=1&destination=${q}`;
    case "trackline":
      // Real deep-link shape once TrackLine's own scheme is filled in above;
      // falls back to its App Store page if the app isn't installed.
      return `${TRACKLINE_URL_SCHEME}navigate?lat=${dest.lat ?? ""}&lng=${dest.lng ?? ""}&label=${encodeURIComponent(dest.label)}`;
  }
}

export async function openDirections(app: MapsApp, dest: DestinationInfo): Promise<void> {
  const url = buildMapsUrl(app, dest);
  const canOpen = await Linking.canOpenURL(url);
  if (canOpen) {
    await Linking.openURL(url);
    return;
  }
  if (app === "trackline" && TRACKLINE_APP_STORE_URL) {
    await Linking.openURL(TRACKLINE_APP_STORE_URL);
    return;
  }
  if (app === "trackline") {
    throw new Error("TrackLine isn't installed and no App Store link is configured yet (EXPO_PUBLIC_TRACKLINE_APP_STORE_URL).");
  }
  // Last-resort fallback: Apple Maps on iOS, Google Maps elsewhere.
  await Linking.openURL(buildMapsUrl(Platform.OS === "ios" ? "apple" : "google", dest));
}
