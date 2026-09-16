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
  autoRechargeEnabled: boolean;
  autoRechargeThresholdCents: number;
  autoRechargePackLabel: "$35" | "$80" | "$115" | "$175";
  /** True once a real Stripe payment method is on file — the server can auto-recharge this account with no interaction at all. When false, an Apple-only user's "auto-recharge" is the app auto-prompting the real StoreKit purchase sheet instead (see server/src/lib/autoRecharge.ts's header for why those genuinely differ). */
  hasStripePaymentMethodOnFile: boolean;
  /** Smart Build's two in-chat banners (ChatScreen.tsx) — server-persisted so they survive a reinstall, same pattern as onboardingCompletedAt above. */
  smartBuildIntroDismissedAt: string | null;
  smartBuildFirstRunAt: string | null;
  smartBuildFollowUpDismissedAt: string | null;
}

interface AuthState {
  user: NexaUser | null;
  loading: boolean;
  signup: (email: string, password: string, displayName: string, timezone: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  /** Real social sign-in completion — the server already verified the provider and issued a real app JWT; this just adopts it (Apple's native flow, or the token handed back through Google/GitHub's browser-redirect callback). */
  loginWithToken: (token: string) => Promise<void>;
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

  const loginWithToken: AuthState["loginWithToken"] = async (token) => {
    await setToken(token);
    await refreshUser();
  };

  const logout = async () => {
    await clearToken();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signup, login, loginWithToken, logout, refreshUser }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
