import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, KeyboardAvoidingView, Linking, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import { GalaxyBackground } from "../components/GalaxyBackground";
import { WelcomeAvatar } from "../components/WelcomeAvatar";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";
import { CountryCodeSelect } from "../components/CountryCodeSelect";
import { radii, spacing, typography } from "../theme/colors";
import { useTheme } from "../lib/ThemeContext";
import type { Palette } from "../theme/palettes";
import { useAuth } from "../lib/AuthContext";
import { api, ApiError } from "../lib/api";
import { webUrl } from "../lib/webLinks";
import { COUNTRIES, detectDefaultCountry, type Country } from "../lib/countries";
import { consumeWebAuthCallback } from "../lib/oauthWebCallback";

/** Pulls query params out of the deep-link URL the server redirects the in-app browser to (nexaai://auth-callback?token=... or ?error=...) — a plain split+URLSearchParams rather than the global URL constructor, since custom-scheme URL parsing isn't consistently supported across RN's JS engines. */
function parseCallbackParams(url: string): Record<string, string> {
  const query = url.split("?")[1] ?? "";
  return Object.fromEntries(new URLSearchParams(query));
}

const RESEND_COOLDOWN_SECONDS = 30;

type AuthMethod = "email" | "phone";

export function AuthScreen() {
  const { login, signup, loginWithToken } = useAuth();
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const insets = useSafeAreaInsets();

  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [method, setMethod] = useState<AuthMethod>("email");
  const [error, setError] = useState<string | null>(null);

  // Email/password fields
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);

  // Phone sign-in — real Twilio Verify SMS code, same account either way
  // (no separate login/signup split needed: the server finds-or-creates).
  // The user only types their national number; the real country dial code
  // (lib/countries.ts) is prepended to build the actual E.164 number sent
  // to the server, rather than asking them to type "+61" themselves.
  const [country, setCountry] = useState<Country>(() => detectDefaultCountry());
  const [phone, setPhone] = useState("");
  const [phoneStep, setPhoneStep] = useState<"enter" | "code">("enter");
  const [phoneCode, setPhoneCode] = useState("");
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const fullPhoneNumber = `${country.dialCode}${phone.replace(/\D/g, "")}`;

  // Forgot password — inline panel, no separate screen/navigation needed.
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  const [socialBusy, setSocialBusy] = useState<"google" | "github" | null>(null);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => setResendCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  // Real IP-based country detection (server/src/routes/auth.ts's /geo,
  // backed by Cloudflare's CF-IPCountry header) overrides the locale-based
  // guess the moment it resolves — more accurate than the device's language
  // setting, but only available once this app is actually deployed behind
  // Cloudflare (dev/local origins simply get countryCode: null back and
  // keep the locale-based default).
  useEffect(() => {
    let cancelled = false;
    api<{ countryCode: string | null }>("/api/auth/geo")
      .then((r) => {
        if (cancelled || !r.countryCode) return;
        const match = COUNTRIES.find((c) => c.code === r.countryCode);
        if (match) setCountry(match);
      })
      .catch(() => {}); // best-effort — the locale-based default already covers this
    return () => {
      cancelled = true;
    };
  }, []);

  const switchMethod = (next: AuthMethod) => {
    setMethod(next);
    setError(null);
    setPhoneStep("enter");
    setPhoneCode("");
    setForgotOpen(false);
  };

  const continueWithBrowserProvider = async (provider: "google" | "github") => {
    setSocialBusy(provider);
    setError(null);
    try {
      const platform = Platform.OS === "web" ? "web" : "native";
      const startResult = await api<{ authUrl: string } | null>(`/api/auth/${provider}/start?platform=${platform}`);
      if (!startResult?.authUrl) throw new Error(`Couldn't start ${provider === "google" ? "Google" : "GitHub"} sign-in. Try again.`);
      if (Platform.OS === "web") {
        // A browser has no way to follow the native nexaai://auth-callback
        // redirect at all — WebBrowser.openAuthSessionAsync's popup+polling
        // approach only works for a scheme the OS can intercept. The web
        // build instead does a real full-page redirect; the server's
        // callback (platform=web, above) lands back on this same origin
        // with ?authToken=, consumed by this screen's own mount effect
        // (consumeWebAuthCallback) once the browser navigates back here.
        window.location.href = startResult.authUrl;
        return;
      }
      const result = await WebBrowser.openAuthSessionAsync(startResult.authUrl, "nexaai://auth-callback");
      if (result.type !== "success" || !result.url) return;
      const { token, error: callbackError } = parseCallbackParams(result.url);
      if (callbackError) throw new Error(`Couldn't sign in with ${provider === "google" ? "Google" : "GitHub"}. Try again.`);
      if (token) await loginWithToken(token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setSocialBusy(null);
    }
  };

  // Completes the web build's OAuth redirect (see continueWithBrowserProvider
  // above) — runs once on mount, picks up ?authToken=/?authError= if the
  // server's callback just landed us back here, and strips them from the URL.
  useEffect(() => {
    const callback = consumeWebAuthCallback();
    if (!callback) return;
    if (callback.token) {
      loginWithToken(callback.token).catch(() => setError("Couldn't complete sign-in. Try again."));
    } else if (callback.error) {
      setError(callback.error === "cancelled" ? "Sign-in was cancelled." : "Couldn't sign in. Try again.");
    }
  }, []);

  const sendPhoneCode = async () => {
    if (!phone.trim() || phoneBusy) return;
    setPhoneBusy(true);
    setError(null);
    try {
      await api("/api/auth/phone/start", { method: "POST", body: JSON.stringify({ phone: fullPhoneNumber }) });
      setPhoneStep("code");
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't send a code. Try again.");
    } finally {
      setPhoneBusy(false);
    }
  };

  const verifyPhoneCode = async () => {
    if (!phoneCode.trim() || phoneBusy) return;
    setPhoneBusy(true);
    setError(null);
    try {
      const { token } = await api<{ token: string }>("/api/auth/phone/verify", {
        method: "POST",
        body: JSON.stringify({ phone: fullPhoneNumber, code: phoneCode.trim() }),
      });
      await loginWithToken(token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't verify that code. Try again.");
    } finally {
      setPhoneBusy(false);
    }
  };

  const requestPasswordReset = async () => {
    if (!forgotEmail.trim() || forgotBusy) return;
    setForgotBusy(true);
    setError(null);
    try {
      await api("/api/auth/forgot-password", { method: "POST", body: JSON.stringify({ email: forgotEmail.trim() }) });
      setForgotSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setForgotBusy(false);
    }
  };

  // A gentler, independent breathing loop for the small wordmark logo —
  // the mascot's own glow now lives inside WelcomeHandAvatar instead.
  // same idea as glowPulse above but a touch slower so the two animations
  // don't read as mechanically identical next to each other.
  const logoPulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(logoPulse, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(logoPulse, { toValue: 0, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [logoPulse]);
  const logoScale = logoPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });
  const logoRotate = logoPulse.interpolate({ inputRange: [0, 1], outputRange: ["-3deg", "3deg"] });

  const canSubmitEmail = email.trim().length > 0 && password.length > 0 && (mode === "login" || displayName.trim().length > 0);

  const submitEmail = async () => {
    if (!canSubmitEmail || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "signup") {
        await signup(email, password, displayName, Intl.DateTimeFormat().resolvedOptions().timeZone);
      } else {
        await login(email, password);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <GalaxyBackground>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={[styles.container, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.hero}>
            <WelcomeAvatar size={100} welcomeText="Welcome" />
            <View style={styles.titleRow}>
              <Animated.Image
                source={require("../../../assets/icon-transparent.png")}
                style={[styles.titleLogo, { transform: [{ scale: logoScale }, { rotate: logoRotate }] }]}
                resizeMode="contain"
              />
              <Text style={styles.title}>NexaAi</Text>
            </View>
            <Text style={styles.subtitle}>Ask for anything. Get it done.</Text>
          </View>

          <View style={[styles.card, { backgroundColor: palette.bgCard, borderColor: palette.border }]}>
            <View style={[styles.segmented, { backgroundColor: palette.bgCardAlt, borderColor: palette.border }]}>
              <SegmentButton label="Email" active={method === "email"} onPress={() => switchMethod("email")} palette={palette} testID="auth-method-email" />
              <SegmentButton label="Phone" active={method === "phone"} onPress={() => switchMethod("phone")} palette={palette} testID="auth-method-phone" />
            </View>

            {method === "email" && !forgotOpen && (
              <>
                {mode === "signup" && (
                  <TextField label="Your name" icon="person-outline" value={displayName} onChangeText={setDisplayName} placeholder="Jamie Rivera" testID="auth-name-input" />
                )}

                <TextField
                  label="Email"
                  icon="mail-outline"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  keyboardType="email-address"
                  testID="auth-email-input"
                />

                <TextField
                  label="Password"
                  icon="lock-closed-outline"
                  value={password}
                  onChangeText={setPassword}
                  placeholder="At least 8 characters"
                  secureTextEntry
                  testID="auth-password-input"
                />

                {mode === "login" && (
                  <TouchableOpacity
                    onPress={() => {
                      setForgotOpen(true);
                      setForgotEmail(email);
                      setForgotSent(false);
                      setError(null);
                    }}
                    style={styles.forgotLink}
                    testID="auth-forgot-password-link"
                  >
                    <Text style={[styles.linkText, { color: palette.link }]}>Forgot password?</Text>
                  </TouchableOpacity>
                )}

                {error && <ErrorBanner message={error} palette={palette} />}

                <Button
                  testID="auth-submit-button"
                  title={mode === "signup" ? "Continue" : "Log in"}
                  icon={!busy ? <Ionicons name="arrow-forward" size={17} color="#fff" /> : undefined}
                  onPress={submitEmail}
                  disabled={!canSubmitEmail}
                  loading={busy}
                  style={styles.fullWidth}
                />

                {mode === "signup" && (
                  <>
                    <Text style={styles.trialNote}>This starts your 2-day free trial.</Text>
                    <Text style={styles.legalNote}>
                      By continuing, you agree to our{" "}
                      <Text testID="auth-terms-link" style={styles.legalLink} onPress={() => Linking.openURL(webUrl("terms.html"))}>
                        Terms
                      </Text>{" "}
                      and{" "}
                      <Text testID="auth-privacy-link" style={styles.legalLink} onPress={() => Linking.openURL(webUrl("privacy.html"))}>
                        Privacy Policy
                      </Text>
                      .
                    </Text>
                  </>
                )}
              </>
            )}

            {method === "email" && forgotOpen && (
              <View>
                {forgotSent ? (
                  <>
                    <Text style={[styles.forgotHeading, { color: palette.textPrimary }]}>Check your email</Text>
                    <Text style={[styles.forgotBody, { color: palette.textSecondary }]}>
                      If <Text style={styles.forgotBodyStrong}>{forgotEmail.trim()}</Text> has a NexaAi account, a reset link is on its way — it works for 30 minutes.
                    </Text>
                  </>
                ) : (
                  <>
                    <Text style={[styles.forgotHeading, { color: palette.textPrimary }]}>Reset your password</Text>
                    <Text style={[styles.forgotBody, { color: palette.textSecondary }]}>We'll email a real reset link to the address on your account.</Text>
                    <TextField label="Email" icon="mail-outline" value={forgotEmail} onChangeText={setForgotEmail} placeholder="you@example.com" keyboardType="email-address" testID="auth-forgot-email-input" />
                    {error && <ErrorBanner message={error} palette={palette} />}
                    <Button
                      testID="auth-forgot-submit-button"
                      title="Send reset link"
                      onPress={requestPasswordReset}
                      disabled={!forgotEmail.trim()}
                      loading={forgotBusy}
                      style={styles.fullWidth}
                    />
                  </>
                )}
                <TouchableOpacity
                  onPress={() => {
                    setForgotOpen(false);
                    setForgotSent(false);
                    setError(null);
                  }}
                  style={styles.forgotBackLink}
                >
                  <Text style={[styles.linkText, { color: palette.link }]}>Back to log in</Text>
                </TouchableOpacity>
              </View>
            )}

            {method === "phone" && phoneStep === "enter" && (
              <>
                <Text style={styles.phoneRowLabel}>Phone number</Text>
                <View style={styles.phoneRow}>
                  <CountryCodeSelect value={country} onChange={setCountry} testID="auth-country-select" />
                  <View style={styles.phoneNumberField}>
                    <TextField
                      label=""
                      icon="call-outline"
                      value={phone}
                      onChangeText={(text) => setPhone(text.replace(/[^\d\s-]/g, ""))}
                      placeholder="4155552671"
                      keyboardType="phone-pad"
                      testID="auth-phone-input"
                    />
                  </View>
                </View>
                <Text style={[styles.helperNote, { color: palette.textMuted }]}>We'll text a one-time code to {fullPhoneNumber}.</Text>

                {error && <ErrorBanner message={error} palette={palette} />}

                <Button
                  testID="auth-phone-send-button"
                  title="Send code"
                  icon={!phoneBusy ? <Ionicons name="arrow-forward" size={17} color="#fff" /> : undefined}
                  onPress={sendPhoneCode}
                  disabled={!phone.trim()}
                  loading={phoneBusy}
                  style={styles.fullWidth}
                />
              </>
            )}

            {method === "phone" && phoneStep === "code" && (
              <>
                <Text style={[styles.forgotBody, { color: palette.textSecondary }]}>
                  Enter the code we sent to <Text style={styles.forgotBodyStrong}>{fullPhoneNumber}</Text>.
                </Text>
                <TextField label="Verification code" icon="key-outline" value={phoneCode} onChangeText={setPhoneCode} placeholder="123456" keyboardType="number-pad" testID="auth-phone-code-input" />

                {error && <ErrorBanner message={error} palette={palette} />}

                <Button
                  testID="auth-phone-verify-button"
                  title="Verify & continue"
                  icon={!phoneBusy ? <Ionicons name="arrow-forward" size={17} color="#fff" /> : undefined}
                  onPress={verifyPhoneCode}
                  disabled={!phoneCode.trim()}
                  loading={phoneBusy}
                  style={styles.fullWidth}
                />

                <View style={styles.phoneStepFooter}>
                  <TouchableOpacity
                    onPress={() => {
                      setPhoneStep("enter");
                      setPhoneCode("");
                      setError(null);
                    }}
                  >
                    <Text style={[styles.linkText, { color: palette.link }]}>Change number</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={sendPhoneCode} disabled={resendCooldown > 0}>
                    <Text style={[styles.linkText, { color: resendCooldown > 0 ? palette.textMuted : palette.link }]}>
                      {resendCooldown > 0 ? `Resend code (${resendCooldown}s)` : "Resend code"}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

            <View style={styles.dividerRow}>
              <View style={[styles.dividerLine, { backgroundColor: palette.border }]} />
              <Text style={styles.dividerText}>or continue with</Text>
              <View style={[styles.dividerLine, { backgroundColor: palette.border }]} />
            </View>

            <View style={styles.socialRow}>
              <View style={styles.socialButtonWrap}>
                <Button
                  testID="auth-apple-button"
                  variant="secondary"
                  icon={<Ionicons name="logo-apple" size={20} color={palette.textMuted} />}
                  onPress={() => {}}
                  disabled
                  style={styles.socialButton}
                />
                <View style={[styles.comingSoonPill, { backgroundColor: palette.bgCardAlt, borderColor: palette.border }]}>
                  <Text style={[styles.comingSoonText, { color: palette.textMuted }]}>Soon</Text>
                </View>
              </View>
              <Button
                testID="auth-google-button"
                variant="secondary"
                icon={socialBusy === "google" ? <ActivityIndicator color={palette.textPrimary} /> : <Ionicons name="logo-google" size={20} color={palette.textPrimary} />}
                onPress={() => continueWithBrowserProvider("google")}
                disabled={socialBusy !== null}
                style={styles.socialButton}
              />
              <Button
                testID="auth-github-button"
                variant="secondary"
                icon={socialBusy === "github" ? <ActivityIndicator color={palette.textPrimary} /> : <Ionicons name="logo-github" size={20} color={palette.textPrimary} />}
                onPress={() => continueWithBrowserProvider("github")}
                disabled={socialBusy !== null}
                style={styles.socialButton}
              />
            </View>

            <Button
              testID="auth-switch-mode-button"
              variant="secondary"
              title={mode === "signup" ? "Already have an account? Log in" : "New here? Create an account"}
              onPress={() => {
                setMode(mode === "signup" ? "login" : "signup");
                setForgotOpen(false);
                setError(null);
              }}
              style={styles.fullWidth}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </GalaxyBackground>
  );
}

function SegmentButton({ label, active, onPress, palette, testID }: { label: string; active: boolean; onPress: () => void; palette: Palette; testID?: string }) {
  return (
    <TouchableOpacity
      testID={testID}
      onPress={onPress}
      style={[
        segmentStyles.button,
        active && { backgroundColor: palette.bgCard, shadowColor: "#000", shadowOpacity: 0.16, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
      ]}
    >
      <Text style={[segmentStyles.label, { color: active ? palette.textPrimary : palette.textMuted }, active && segmentStyles.labelActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function ErrorBanner({ message, palette }: { message: string; palette: Palette }) {
  return (
    <View style={[bannerStyles.errorBanner, { backgroundColor: `${palette.danger}1A`, borderColor: palette.danger }]}>
      <Ionicons name="alert-circle-outline" size={16} color={palette.danger} />
      <Text style={[bannerStyles.errorText, { color: palette.danger }]}>{message}</Text>
    </View>
  );
}

const segmentStyles = StyleSheet.create({
  button: { flex: 1, paddingVertical: 10, borderRadius: radii.md, alignItems: "center" },
  label: { ...typography.description },
  labelActive: { fontFamily: typography.bodyBold.fontFamily },
});

const bannerStyles = StyleSheet.create({
  errorBanner: { flexDirection: "row", alignItems: "flex-start", gap: spacing.xs, borderWidth: 1, borderRadius: radii.md, padding: spacing.sm },
  errorText: { ...typography.caption, flex: 1, flexShrink: 1, minWidth: 0 },
});

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    flex: { flex: 1 },
    container: { flexGrow: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.lg, gap: spacing.xl },
    hero: { alignItems: "center", gap: spacing.sm },
    titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
    titleLogo: { width: 44, height: 44 },
    title: { ...typography.h1, color: palette.textPrimary },
    subtitle: { ...typography.body, color: palette.textSecondary },
    card: {
      width: "100%",
      maxWidth: 420,
      borderRadius: radii.lg,
      borderWidth: 1,
      padding: spacing.lg,
      gap: spacing.lg,
      shadowColor: "#000",
      shadowOpacity: 0.2,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 8 },
      elevation: 6,
    },
    segmented: { flexDirection: "row", borderRadius: radii.md, borderWidth: 1, padding: 3, gap: 3 },
    fullWidth: { width: "100%" },
    trialNote: { ...typography.caption, color: palette.textMuted, textAlign: "center", marginTop: -spacing.sm },
    legalNote: { ...typography.caption, color: palette.textMuted, textAlign: "center", marginTop: -spacing.sm },
    legalLink: { color: palette.link, textDecorationLine: "underline" },
    linkText: { ...typography.caption, fontFamily: typography.bodyBold.fontFamily },
    forgotLink: { alignSelf: "flex-end", marginTop: -spacing.sm },
    forgotBackLink: { alignSelf: "center", marginTop: spacing.sm },
    forgotHeading: { ...typography.h2 },
    forgotBody: { ...typography.description, lineHeight: 21, marginBottom: spacing.xs },
    forgotBodyStrong: { fontFamily: typography.bodyBold.fontFamily, color: palette.textPrimary },
    helperNote: { ...typography.caption, marginTop: -spacing.sm },
    phoneRowLabel: { ...typography.sectionLabel, color: palette.textMuted, textTransform: "uppercase", marginBottom: spacing.xs },
    phoneRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
    phoneNumberField: { flex: 1 },
    phoneStepFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    dividerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    dividerLine: { flex: 1, height: 1 },
    dividerText: { ...typography.caption, color: palette.textMuted },
    socialRow: { flexDirection: "row", gap: spacing.md },
    socialButtonWrap: { flex: 1, position: "relative" },
    socialButton: { flex: 1 },
    comingSoonPill: {
      position: "absolute",
      top: -8,
      right: -6,
      borderWidth: 1,
      borderRadius: radii.pill,
      paddingHorizontal: 6,
      paddingVertical: 1,
    },
    comingSoonText: { fontSize: 9.5, fontFamily: typography.sectionLabel.fontFamily, letterSpacing: 0.3 },
  });
}
