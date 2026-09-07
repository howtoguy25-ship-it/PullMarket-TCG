import { useEffect } from "react";
import { useAuth } from "./AuthContext";
import { useFont } from "./FontContext";
import { useTheme } from "./ThemeContext";

/** Applies the logged-in user's saved font/theme choice into the (local-state) contexts whenever it changes or on login. */
export function AppearanceSync() {
  const { user } = useAuth();
  const { setFontChoice } = useFont();
  const { setThemeId } = useTheme();

  useEffect(() => {
    if (!user) return;
    setFontChoice(user.fontChoice);
    setThemeId(user.themeId);
  }, [user?.fontChoice, user?.themeId]);

  return null;
}
