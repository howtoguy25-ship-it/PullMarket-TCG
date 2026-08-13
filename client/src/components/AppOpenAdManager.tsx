import { useCallback, useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { AD_LIMITS, appOpenStorageKey, canShowToday, getAppOpenUnitId, initAds, loadAds, recordShownToday } from "@/lib/ads";

interface AdsStatus {
  adsRemoved: boolean;
}

// Mounted once at the app root (see App.tsx, alongside CallOverlay) —
// tries to show a real AdMob App Open ad on cold start and every time the
// app returns to the foreground, capped to AD_LIMITS.APP_OPEN_PER_DAY
// actual *displays* per day (attempts beyond the cap are silently skipped,
// not queued for later). Renders nothing itself — the ad is a native
// full-screen overlay the SDK manages.
export function AppOpenAdManager() {
  const { user } = useAuth();
  const { data: adsStatus } = useQuery<AdsStatus>({ queryKey: ["/api/ads/status"], enabled: !!user && Platform.OS !== "web" });
  const inFlightRef = useRef(false);

  const tryShow = useCallback(async () => {
    if (Platform.OS === "web" || !user || adsStatus?.adsRemoved || inFlightRef.current) return;
    if (!(await canShowToday(appOpenStorageKey(), AD_LIMITS.APP_OPEN_PER_DAY))) return;

    inFlightRef.current = true;
    try {
      await initAds();
      const { AppOpenAd, AdEventType } = await loadAds();
      const unitId = await getAppOpenUnitId();
      const ad = AppOpenAd.createForAdRequest(unitId);

      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          unsubLoaded();
          unsubError();
          unsubClosed();
          resolve();
        };
        const unsubLoaded = ad.addAdEventListener(AdEventType.LOADED, () => {
          // Counted the moment it's actually shown, not just requested —
          // a failed/no-fill load must not burn a slot out of the daily cap.
          void recordShownToday(appOpenStorageKey());
          ad.show().catch(finish);
        });
        const unsubClosed = ad.addAdEventListener(AdEventType.CLOSED, finish);
        const unsubError = ad.addAdEventListener(AdEventType.ERROR, finish);
        ad.load();
      });
    } catch (err) {
      console.error("App Open ad failed:", err);
    } finally {
      inFlightRef.current = false;
    }
  }, [user, adsStatus?.adsRemoved]);

  // Cold start.
  useEffect(() => {
    void tryShow();
  }, [tryShow]);

  // Returning from background — AppState (core React Native, works
  // identically on web with no-op behavior) rather than the ads SDK's own
  // useForeground hook, since that hook lives in a native-only module and
  // hooks can't be conditionally imported.
  useEffect(() => {
    if (Platform.OS === "web") return;
    let previous = AppState.currentState;
    const sub = AppState.addEventListener("change", (next) => {
      if (previous.match(/inactive|background/) && next === "active") void tryShow();
      previous = next;
    });
    return () => sub.remove();
  }, [tryShow]);

  return null;
}
