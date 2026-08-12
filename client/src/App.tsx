import React, { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { AuthProvider } from "@/contexts/AuthContext";
import { AmbientSoundProvider } from "@/contexts/AmbientSoundContext";
import { RootNavigator } from "@/navigation/RootNavigator";
import { applyPendingUpdate } from "@/lib/autoUpdate";

export default function App() {
  useEffect(() => {
    void applyPendingUpdate();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
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
