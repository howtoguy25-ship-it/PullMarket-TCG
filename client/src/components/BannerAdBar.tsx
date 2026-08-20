import { useEffect, useRef, useState } from "react";
import { Platform, View, Pressable, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { Colors } from "@/constants/theme";
import { AD_LIMITS, bannerStorageKey, canShowToday, getBannerUnitId, initAds, isAdsAvailable, loadAds, recordShownToday } from "@/lib/ads";

interface AdsStatus {
  adsRemoved: boolean;
}

// Mounted once above the tab navigator (see MainTabs.tsx) so it sits at the
// very top of Home/Search/Sell/etc without overlaying any of their content.
// Shows a real AdMob banner at most once per app open, capped to
// AD_LIMITS.BANNER_PER_DAY actual displays per day — its own X button (not
// part of the ad creative, so this is the publisher's own placement being
// hidden, not the ad being force-closed) only becomes tappable after
// AD_LIMITS.BANNER_DISMISS_DELAY_MS.
export function BannerAdBar() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const { data: adsStatus } = useQuery<AdsStatus>({ queryKey: ["/api/ads/status"], enabled: !!user && Platform.OS !== "web" });

  // Same dynamic-import-on-native-only pattern used for RTCView in
  // CallOverlay.tsx — a native module's component can't be imported
  // statically since this file is also evaluated on web.
  const [BannerAd, setBannerAd] = useState<typeof import("react-native-google-mobile-ads").BannerAd | null>(null);
  const [BannerAdSize, setBannerAdSize] = useState<typeof import("react-native-google-mobile-ads").BannerAdSize | null>(null);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [eligible, setEligible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [canDismiss, setCanDismiss] = useState(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (Platform.OS === "web" || !user || adsStatus?.adsRemoved || !isAdsAvailable()) return;
    let cancelled = false;
    (async () => {
      try {
        if (!(await canShowToday(bannerStorageKey(), AD_LIMITS.BANNER_PER_DAY))) return;
        await initAds();
        const mod = await loadAds();
        const id = await getBannerUnitId();
        if (cancelled) return;
        setBannerAd(() => mod.BannerAd);
        setBannerAdSize(() => mod.BannerAdSize);
        setUnitId(id);
        setEligible(true);
      } catch (err) {
        console.error("Banner ad setup failed:", err);
      }
    })();
    return () => {
      cancelled = true;
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, [user, adsStatus?.adsRemoved]);

  const handleLoaded = () => {
    // Counted the moment it actually renders, not on request — a failed
    // load must not burn a slot out of the daily cap (matches AppOpenAdManager).
    void recordShownToday(bannerStorageKey());
    dismissTimerRef.current = setTimeout(() => setCanDismiss(true), AD_LIMITS.BANNER_DISMISS_DELAY_MS);
  };

  if (Platform.OS === "web" || !eligible || dismissed || !BannerAd || !BannerAdSize || !unitId) return null;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Fixed 320x50 — the classic compact banner strip. The adaptive
          anchored sizes (especially LARGE_ANCHORED_ADAPTIVE_BANNER) scale
          their height up with device width and can render noticeably
          taller than a typical top bar on wider phones. */}
      <BannerAd unitId={unitId} size={BannerAdSize.BANNER} onAdLoaded={handleLoaded} onAdFailedToLoad={() => setDismissed(true)} />
      {canDismiss && (
        <Pressable onPress={() => setDismissed(true)} style={styles.closeButton} hitSlop={10} accessibilityLabel="Close ad" accessibilityRole="button">
          <Feather name="x" size={14} color={Colors.text} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: "100%", alignItems: "center", backgroundColor: Colors.background },
  closeButton: {
    position: "absolute",
    top: 2,
    right: 2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.gold,
    alignItems: "center",
    justifyContent: "center",
  },
});
