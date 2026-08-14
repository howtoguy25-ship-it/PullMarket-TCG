import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { HOME_BACKGROUNDS, DEFAULT_HOME_BACKGROUND_ID } from "@/lib/homeBackgrounds";

const STORAGE_KEY = "pullmarket_home_background_pref";

interface HomeBackgroundContextValue {
  backgroundId: string;
  selectBackground: (id: string) => void;
}

const HomeBackgroundContext = createContext<HomeBackgroundContextValue | null>(null);

export function HomeBackgroundProvider({ children }: { children: React.ReactNode }) {
  const [backgroundId, setBackgroundId] = useState(DEFAULT_HOME_BACKGROUND_ID);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw && HOME_BACKGROUNDS.some((b) => b.id === raw)) setBackgroundId(raw);
      })
      .catch(() => {});
  }, []);

  const selectBackground = useCallback((id: string) => {
    setBackgroundId(id);
    AsyncStorage.setItem(STORAGE_KEY, id).catch(() => {});
  }, []);

  return <HomeBackgroundContext.Provider value={{ backgroundId, selectBackground }}>{children}</HomeBackgroundContext.Provider>;
}

export function useHomeBackground() {
  const ctx = useContext(HomeBackgroundContext);
  if (!ctx) throw new Error("useHomeBackground must be used within HomeBackgroundProvider");
  return ctx;
}
