import React from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./lib/AuthContext";
import { FontProvider } from "./lib/FontContext";
import { ThemeProvider } from "./lib/ThemeContext";
import { AppearanceSync } from "./lib/AppearanceSync";
import { RootNavigator } from "./navigation/RootNavigator";

const queryClient = new QueryClient();

export default function App() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <FontProvider>
          <ThemeProvider>
            <AuthProvider>
              <AppearanceSync />
              <StatusBar style="light" />
              <RootNavigator />
            </AuthProvider>
          </ThemeProvider>
        </FontProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
