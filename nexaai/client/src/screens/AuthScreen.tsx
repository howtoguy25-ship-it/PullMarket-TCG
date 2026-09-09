import React, { useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { GalaxyBackground } from "../components/GalaxyBackground";
import { BotAvatar } from "../components/BotAvatar";
import { radii, spacing, typography } from "../theme/colors";
import { useTheme } from "../lib/ThemeContext";
import type { Palette } from "../theme/palettes";
import { useAuth } from "../lib/AuthContext";
import { ApiError } from "../lib/api";

export function AuthScreen() {
  const { login, signup } = useAuth();
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
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
      <View style={styles.container}>
        <BotAvatar size={96} mood="happy" />
        <Text style={styles.title}>NexaAi</Text>
        <Text style={styles.subtitle}>Ask for anything. Get it done.</Text>

        {mode === "signup" && (
          <TextInput
            style={styles.input}
            placeholder="Your name"
            placeholderTextColor={palette.textMuted}
            value={displayName}
            onChangeText={setDisplayName}
          />
        )}
        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={palette.textMuted}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={palette.textMuted}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        {error && <Text style={styles.error}>{error}</Text>}

        <TouchableOpacity style={[styles.button, { backgroundColor: palette.accent }]} onPress={submit} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{mode === "signup" ? "Start my 2-day free trial" : "Log in"}</Text>}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => setMode(mode === "signup" ? "login" : "signup")}>
          <Text style={[styles.switchText, { color: palette.accentBright }]}>{mode === "signup" ? "Already have an account? Log in" : "New here? Create an account"}</Text>
        </TouchableOpacity>
      </View>
    </GalaxyBackground>
  );
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  title: { ...typography.h1, color: palette.textPrimary, marginTop: spacing.md },
  subtitle: { ...typography.body, color: palette.textSecondary, marginBottom: spacing.lg },
  input: {
    width: "100%",
    backgroundColor: palette.bgCard,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.md,
    color: palette.textPrimary,
  },
  button: { width: "100%", borderRadius: radii.md, padding: spacing.md, alignItems: "center", marginTop: spacing.sm },
  buttonText: { color: "#fff", fontWeight: "700" },
  switchText: { marginTop: spacing.sm },
  error: { color: palette.danger, textAlign: "center" },
  });
}
