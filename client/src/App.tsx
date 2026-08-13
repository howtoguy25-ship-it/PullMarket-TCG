import React, { useCallback, useEffect, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { QueryClientProvider } from "@tanstack/react-query";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";
import { queryClient } from "@/lib/queryClient";

// Requiring the specific weight files directly (instead of importing the
// @expo-google-fonts barrel packages) keeps every unused weight/italic
// variant out of the bundle — the barrels re-export all ~13 files per
// family unconditionally, which Metro can't tree-shake away.
const Baloo2_700Bold = require("@expo-google-fonts/baloo-2/700Bold/Baloo2_700Bold.ttf");
const Baloo2_800ExtraBold = require("@expo-google-fonts/baloo-2/800ExtraBold/Baloo2_800ExtraBold.ttf");
const Nunito_400Regular = require("@expo-google-fonts/nunito/400Regular/Nunito_400Regular.ttf");
const Nunito_600SemiBold = require("@expo-google-fonts/nunito/600SemiBold/Nunito_600SemiBold.ttf");
const Nunito_700Bold = require("@expo-google-fonts/nunito/700Bold/Nunito_700Bold.ttf");
import { AuthProvider } from "@/contexts/AuthContext";
import { AmbientSoundProvider } from "@/contexts/AmbientSoundContext";
import { CallProvider } from "@/contexts/CallContext";
import { CallOverlay } from "@/components/CallOverlay";
import { AppOpenAdManager } from "@/components/AppOpenAdManager";
import { RootNavigator } from "@/navigation/RootNavigator";
import { applyPendingUpdate, watchForUpdatesOnForeground } from "@/lib/autoUpdate";

// Best-effort — if this fails for some reason the app must still start, so
// every call site here is fire-and-forget with its own catch.
SplashScreen.preventAutoHideAsync().catch(() => {});

// Font files are bundled locally (required at build time, not fetched at
// runtime), so useFonts below has nothing to time out on in practice. This
// timeout exists purely as a last line of defense: it guarantees the splash
// screen releases and the app renders (falling back to the system font)
// even if font registration itself somehow never resolves, rather than
// leaving the launch screen up forever with no way out.
const FONT_LOAD_TIMEOUT_MS = 4000;

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    Baloo2_700Bold,
    Baloo2_800ExtraBold,
    Nunito_400Regular,
    Nunito_600SemiBold,
    Nunito_700Bold,
  });
  const [timedOut, setTimedOut] = useState(false);
  const appIsReady = fontsLoaded || !!fontError || timedOut;

  useEffect(() => {
    void applyPendingUpdate();
    return watchForUpdatesOnForeground();
  }, []);

  useEffect(() => {
    if (fontsLoaded || fontError) return;
    const timer = setTimeout(() => setTimedOut(true), FONT_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    if (fontError) console.warn("[app] Custom fonts failed to load, falling back to system font", fontError);
    if (timedOut && !fontsLoaded) console.warn("[app] Font loading timed out, proceeding without custom fonts");
  }, [fontError, timedOut, fontsLoaded]);

  const onLayout = useCallback(() => {
    if (appIsReady) SplashScreen.hideAsync().catch(() => {});
  }, [appIsReady]);

  if (!appIsReady) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }} onLayout={onLayout}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <AmbientSoundProvider>
              <CallProvider>
                <StatusBar style="dark" />
                <RootNavigator />
                <CallOverlay />
                <AppOpenAdManager />
              </CallProvider>
            </AmbientSoundProvider>
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
