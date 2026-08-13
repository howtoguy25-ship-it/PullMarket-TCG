import { Platform } from "react-native";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";

// react-native-google-mobile-ads is a native module with no web build —
// same dynamic-import-on-native-only pattern used elsewhere in this app
// (react-native-webrtc, react-native-iap, etc.), so importing this file
// never touches the web bundle.
let adsModule: typeof import("react-native-google-mobile-ads") | null = null;
export async function loadAds() {
  if (!adsModule) adsModule = await import("react-native-google-mobile-ads");
  return adsModule;
}

let initialized = false;
// Real App Tracking Transparency prompt + Ads SDK init — call once, near
// app startup. Declining the ATT prompt isn't an error; AdMob just serves
// non-personalized ads instead, which the SDK handles on its own.
export async function initAds(): Promise<void> {
  if (Platform.OS === "web" || initialized) return;
  initialized = true;
  try {
    if (Platform.OS === "ios") {
      const ATT = await import("expo-tracking-transparency");
      const { status } = await ATT.getTrackingPermissionsAsync();
      if (status === "undetermined") await ATT.requestTrackingPermissionsAsync();
    }
    const { MobileAds } = await loadAds();
    await MobileAds().initialize();
  } catch (err) {
    console.error("Ad SDK init failed:", err);
  }
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD, local device clock
}

// Real per-day frequency capping, persisted across app restarts —
// {date, count} under one AsyncStorage key per ad slot, reset the moment
// the stored date no longer matches today.
async function getDailyCount(storageKey: string): Promise<number> {
  const raw = await AsyncStorage.getItem(storageKey);
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw) as { date: string; count: number };
    return parsed.date === todayKey() ? parsed.count : 0;
  } catch {
    return 0;
  }
}

async function incrementDailyCount(storageKey: string): Promise<void> {
  const count = (await getDailyCount(storageKey)) + 1;
  await AsyncStorage.setItem(storageKey, JSON.stringify({ date: todayKey(), count }));
}

export async function canShowToday(storageKey: string, maxPerDay: number): Promise<boolean> {
  return (await getDailyCount(storageKey)) < maxPerDay;
}

export async function recordShownToday(storageKey: string): Promise<void> {
  await incrementDailyCount(storageKey);
}

export const AD_LIMITS = {
  APP_OPEN_PER_DAY: 2,
  BANNER_PER_DAY: 5,
  BANNER_DISMISS_DELAY_MS: 7_000,
};

const APP_OPEN_STORAGE_KEY = "pullmarket_ads_app_open_count";
const BANNER_STORAGE_KEY = "pullmarket_ads_banner_count";

export function appOpenStorageKey(): string {
  return APP_OPEN_STORAGE_KEY;
}
export function bannerStorageKey(): string {
  return BANNER_STORAGE_KEY;
}

// Real ad unit IDs, falling back to Google's own public TestIds (which
// resolve correctly per-platform on their own) whenever a real one hasn't
// been configured yet — see app.config.js for where these env vars come
// from and why the same fallback pattern is used there for the App ID.
export async function getAppOpenUnitId(): Promise<string> {
  const { TestIds } = await loadAds();
  const extra = Constants.expoConfig?.extra ?? {};
  const configured = Platform.OS === "ios" ? (extra.ADMOB_APP_OPEN_UNIT_ID_IOS as string) : (extra.ADMOB_APP_OPEN_UNIT_ID_ANDROID as string);
  return configured || TestIds.APP_OPEN;
}

export async function getBannerUnitId(): Promise<string> {
  const { TestIds } = await loadAds();
  const extra = Constants.expoConfig?.extra ?? {};
  const configured = Platform.OS === "ios" ? (extra.ADMOB_BANNER_UNIT_ID_IOS as string) : (extra.ADMOB_BANNER_UNIT_ID_ANDROID as string);
  return configured || TestIds.BANNER;
}
