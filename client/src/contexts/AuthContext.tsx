import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { Platform, Alert } from "react-native";
import { getToken, setToken as persistToken, apiJson, ApiError, setUnauthorizedHandler } from "@/lib/api";
import { registerPushToken, clearPushToken } from "@/lib/pushNotifications";

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

export interface AuthUser {
  id: string;
  username: string;
  phoneNumber: string | null;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  isOwner: boolean;
  isSuspended: boolean;
  stripeConnectAccountId: string | null;
  stripeConnectPayoutsEnabled: boolean;
  identityVerificationStatus: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  signIn: (token: string, user: AuthUser) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const userRef = useRef<AuthUser | null>(null);
  userRef.current = user;

  const refreshUser = useCallback(async () => {
    const token = await getToken();
    if (!token) {
      setUser(null);
      return;
    }
    try {
      const me = await apiJson<AuthUser>("GET", "/api/auth/me");
      setUser(me);
      void registerPushToken();
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 410)) {
        await persistToken(null);
        setUser(null);
      }
    }
  }, []);

  useEffect(() => {
    (async () => {
      await refreshUser();
      setIsLoading(false);
    })();
  }, [refreshUser]);

  useEffect(() => {
    setUnauthorizedHandler((message, context) => {
      const wasSignedIn = !!userRef.current;
      void persistToken(null);
      setUser(null);
      // Only surface this if it actually interrupted a live session — a 401
      // from some pre-sign-in call would be normal, not worth alarming
      // anyone about. Silently bouncing someone straight back to the
      // welcome screen with zero explanation is its own bug: at minimum,
      // whoever hits this should be able to tell us what it said — the
      // context string (which request, whether a token was even attached)
      // makes the alert a complete diagnostic on its own, no server log
      // access needed to know exactly what failed.
      console.error("[auth] Global sign-out triggered:", context, message);
      if (wasSignedIn) showAlert("Signed out", `${message || "Your session ended unexpectedly."}\n\n${context}`);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const signIn = useCallback(async (token: string, nextUser: AuthUser) => {
    await persistToken(token);
    setUser(nextUser);
    void registerPushToken();
  }, []);

  const signOut = useCallback(async () => {
    await clearPushToken();
    await persistToken(null);
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, isLoading, signIn, signOut, refreshUser }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
