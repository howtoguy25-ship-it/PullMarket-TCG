import React, { createContext, useContext, useState } from "react";
import { PALETTES, type Palette, type ThemeId } from "../theme/palettes";

interface ThemeState {
  themeId: ThemeId;
  palette: Palette;
  setThemeId: (id: ThemeId) => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeId, setThemeId] = useState<ThemeId>("galaxy_violet");
  const palette = PALETTES[themeId];
  return <ThemeContext.Provider value={{ themeId, palette, setThemeId }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
