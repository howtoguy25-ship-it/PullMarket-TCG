import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { APP_THEMES, AppThemeOption, DEFAULT_APP_THEME_ID, getAppThemeById } from "@/lib/appThemes";

const STORAGE_KEY = "pullmarket_app_theme_pref";

interface AppThemeContextValue {
  selectedId: string;
  theme: AppThemeOption;
  selectTheme: (id: string) => void;
}

const AppThemeContext = createContext<AppThemeContextValue | null>(null);

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const [selectedId, setSelectedId] = useState(DEFAULT_APP_THEME_ID);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw && APP_THEMES.some((t) => t.id === raw)) setSelectedId(raw);
      })
      .catch(() => {});
  }, []);

  const selectTheme = useCallback((id: string) => {
    setSelectedId(id);
    AsyncStorage.setItem(STORAGE_KEY, id).catch(() => {});
  }, []);

  return <AppThemeContext.Provider value={{ selectedId, theme: getAppThemeById(selectedId), selectTheme }}>{children}</AppThemeContext.Provider>;
}

export function useAppTheme() {
  const ctx = useContext(AppThemeContext);
  if (!ctx) throw new Error("useAppTheme must be used within AppThemeProvider");
  return ctx;
}
