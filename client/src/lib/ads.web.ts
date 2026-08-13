// Metro's web build of client/src/lib/ads.ts.
//
// react-native-google-mobile-ads' BannerAd uses React Native's Fabric
// codegen (`codegenNativeComponent`) for its native view component, which
// hard-fails to resolve on web at bundle time — not just "no functionality
// at runtime", an actual `expo export --platform web` build error — so this
// file must never import that package, not even dynamically (a dynamic
// `import()` still has to be resolved and transformed to emit a bundle/
// chunk, so it doesn't dodge the error). AdMob is native-only anyway (see
// AppOpenAdManager.tsx / BannerAdBar.tsx, both gated on
// `Platform.OS !== "web"` before calling anything exported here), so every
// export below is a harmless no-op standing in for the real (native)
// implementation in ads.ts.
export async function loadAds(): Promise<never> {
  throw new Error("Ads are not available on web.");
}

export async function initAds(): Promise<void> {}

export async function canShowToday(_storageKey: string, _maxPerDay: number): Promise<boolean> {
  return false;
}

export async function recordShownToday(_storageKey: string): Promise<void> {}

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

export async function getAppOpenUnitId(): Promise<string> {
  return "";
}
export async function getBannerUnitId(): Promise<string> {
  return "";
}
