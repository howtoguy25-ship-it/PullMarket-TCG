import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { getToken, setToken as persistToken, apiJson, ApiError, setUnauthorizedHandler } from "@/lib/api";
import { registerPushToken, clearPushToken } from "@/lib/pushNotifications";

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
    setUnauthorizedHandler(() => {
      void persistToken(null);
      setUser(null);
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
