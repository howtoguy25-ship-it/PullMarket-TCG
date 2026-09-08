import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { NexaCapabilities, FontChoice, ThemeId, FocusMode } from "@shared/schema";
import { api, setToken, clearToken, getToken } from "./api";

export type { NexaCapabilities, FontChoice, ThemeId, FocusMode };

export interface NexaUser {
  id: string;
  email: string;
  displayName: string;
  planTier: "beginner" | "pro" | "max";
  answerMode: "strong" | "extra" | "normal";
  preferredMapsApp: "apple" | "google" | "trackline";
  voiceCharacterId: string;
  proactiveCheckInEnabled: boolean;
  trialEndsAt: string;
  timezone: string;
  capabilities: NexaCapabilities;
  memoryEnabled: boolean;
  referenceChatsEnabled: boolean;
  includeSensitiveInMemory: boolean;
  onboardingCompletedAt: string | null;
  fontChoice: FontChoice;
  themeId: ThemeId;
  defaultFocusMode: FocusMode;
  /** True only for the allowlisted owner account (server/src/middleware/owner.ts) — gates the Owner panel web link. */
  isOwner: boolean;
}

interface AuthState {
  user: NexaUser | null;
  loading: boolean;
  signup: (email: string, password: string, displayName: string, timezone: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<NexaUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    const token = await getToken();
    if (!token) {
      setUser(null);
      return;
    }
    try {
      const { user: fetched } = await api<{ user: NexaUser }>("/api/auth/me");
      setUser(fetched);
    } catch {
      await clearToken();
      setUser(null);
    }
  }, []);

  useEffect(() => {
    refreshUser().finally(() => setLoading(false));
  }, [refreshUser]);

  const signup: AuthState["signup"] = async (email, password, displayName, timezone) => {
    const { token, user: created } = await api<{ token: string; user: NexaUser }>("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email, password, displayName, timezone }),
    });
    await setToken(token);
    setUser(created);
  };

  const login: AuthState["login"] = async (email, password) => {
    const { token, user: found } = await api<{ token: string; user: NexaUser }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    await setToken(token);
    setUser(found);
  };

  const logout = async () => {
    await clearToken();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signup, login, logout, refreshUser }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
