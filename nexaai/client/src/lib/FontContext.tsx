import React, { createContext, useContext, useEffect, useState } from "react";
import { useFonts } from "expo-font";
import { Inter_400Regular, Inter_500Medium, Inter_700Bold } from "@expo-google-fonts/inter";
import { Fraunces_400Regular, Fraunces_500Medium, Fraunces_700Bold } from "@expo-google-fonts/fraunces";
import { SpaceGrotesk_400Regular, SpaceGrotesk_500Medium, SpaceGrotesk_700Bold } from "@expo-google-fonts/space-grotesk";
import { View, ActivityIndicator } from "react-native";
import { applyGlobalFont } from "./globalFont";
import { colors } from "../theme/colors";
import type { FontChoice } from "@shared/schema";

export type { FontChoice };

export interface FontOption {
  id: FontChoice;
  label: string;
  tagline: string;
  regular: string;
  medium: string;
  bold: string;
}

export const FONT_OPTIONS: FontOption[] = [
  { id: "inter", label: "Inter", tagline: "Clean & modern", regular: "Inter_400Regular", medium: "Inter_500Medium", bold: "Inter_700Bold" },
  { id: "fraunces", label: "Fraunces", tagline: "Fancy & editorial", regular: "Fraunces_400Regular", medium: "Fraunces_500Medium", bold: "Fraunces_700Bold" },
  {
    id: "space_grotesk",
    label: "Space Grotesk",
    tagline: "Techy & distinctive",
    regular: "SpaceGrotesk_400Regular",
    medium: "SpaceGrotesk_500Medium",
    bold: "SpaceGrotesk_700Bold",
  },
];

interface FontState {
  fontChoice: FontChoice;
  setFontChoice: (choice: FontChoice) => void;
  activeFont: FontOption;
}

const FontContext = createContext<FontState | null>(null);

export function FontProvider({ children }: { children: React.ReactNode }) {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_700Bold,
    Fraunces_400Regular,
    Fraunces_500Medium,
    Fraunces_700Bold,
    SpaceGrotesk_400Regular,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_700Bold,
  });
  const [fontChoice, setFontChoiceState] = useState<FontChoice>("inter");

  const activeFont = FONT_OPTIONS.find((f) => f.id === fontChoice) ?? FONT_OPTIONS[0];

  useEffect(() => {
    if (fontsLoaded) applyGlobalFont(activeFont.regular);
  }, [fontsLoaded, activeFont.regular]);

  const setFontChoice = (choice: FontChoice) => setFontChoiceState(choice);

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.accentBright} />
      </View>
    );
  }

  return <FontContext.Provider value={{ fontChoice, setFontChoice, activeFont }}>{children}</FontContext.Provider>;
}

export function useFont(): FontState {
  const ctx = useContext(FontContext);
  if (!ctx) throw new Error("useFont must be used within FontProvider");
  return ctx;
}
