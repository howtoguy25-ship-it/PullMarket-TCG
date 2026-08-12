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
import { RootNavigator } from "@/navigation/RootNavigator";
import { applyPendingUpdate } from "@/lib/autoUpdate";

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function App() {
  const [fontsLoaded] = useFonts({
    Baloo2_700Bold,
    Baloo2_800ExtraBold,
    Nunito_400Regular,
    Nunito_600SemiBold,
    Nunito_700Bold,
  });
  const [appIsReady, setAppIsReady] = useState(false);

  useEffect(() => {
    void applyPendingUpdate();
  }, []);

  useEffect(() => {
    if (fontsLoaded) setAppIsReady(true);
  }, [fontsLoaded]);

  const onLayout = useCallback(() => {
    if (appIsReady) void SplashScreen.hideAsync();
  }, [appIsReady]);

  if (!appIsReady) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }} onLayout={onLayout}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <AmbientSoundProvider>
              <StatusBar style="dark" />
              <RootNavigator />
            </AmbientSoundProvider>
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
