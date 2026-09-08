// Bridges the mobile app to the account website (nexaai/website, served by
// the same Express server at /account) for the real capabilities that live
// there and only there — same pattern Claude's own iOS app uses for some
// settings/billing surfaces: mobile links out to web instead of rebuilding
// the whole thing natively.
import { Linking } from "react-native";
import { API_URL, getToken } from "./api";

export const WEB_BASE_URL = `${API_URL}/account`;

export function webUrl(path: string): string {
  return `${WEB_BASE_URL}/${path}`;
}

/**
 * Opens an account-website page with the current session handed off via a
 * one-time `?token=` query param — website/api.js reads it into localStorage
 * on load and strips it from the URL, so the user lands already signed in
 * instead of hitting the website's own login wall.
 */
export async function openOnWeb(path: string): Promise<void> {
  const token = await getToken();
  const url = `${webUrl(path)}${token ? `?token=${encodeURIComponent(token)}` : ""}`;
  await Linking.openURL(url);
}
