import React, { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { GalaxyBackground } from "../components/GalaxyBackground";
import { BotAvatar } from "../components/BotAvatar";
import { colors, radii, spacing, typography } from "../theme/colors";
import { useAuth } from "../lib/AuthContext";
import { ApiError } from "../lib/api";

export function AuthScreen() {
  const { login, signup } = useAuth();
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
            placeholderTextColor={colors.textMuted}
            value={displayName}
            onChangeText={setDisplayName}
          />
        )}
        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        {error && <Text style={styles.error}>{error}</Text>}

        <TouchableOpacity style={styles.button} onPress={submit} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{mode === "signup" ? "Start my 2-day free trial" : "Log in"}</Text>}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => setMode(mode === "signup" ? "login" : "signup")}>
          <Text style={styles.switchText}>{mode === "signup" ? "Already have an account? Log in" : "New here? Create an account"}</Text>
        </TouchableOpacity>
      </View>
    </GalaxyBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  title: { ...typography.h1, color: colors.textPrimary, marginTop: spacing.md },
  subtitle: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.lg },
  input: {
    width: "100%",
    backgroundColor: colors.bgCard,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    color: colors.textPrimary,
  },
  button: { width: "100%", backgroundColor: colors.accent, borderRadius: radii.md, padding: spacing.md, alignItems: "center", marginTop: spacing.sm },
  buttonText: { color: "#fff", fontWeight: "700" },
  switchText: { color: colors.accentBright, marginTop: spacing.sm },
  error: { color: colors.danger, textAlign: "center" },
});
