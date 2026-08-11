import React, { useState } from "react";
import { View, StyleSheet, Text, TextInput, Platform, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useRoute, RouteProp } from "@react-navigation/native";
import { Colors, Spacing, Typography, BorderRadius } from "@/constants/theme";
import { Button } from "@/components/ui";
import { AuthStackParamList } from "@/navigation/types";
import { apiJson, ApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

type Rt = RouteProp<AuthStackParamList, "UsernameSetup">;

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

const USERNAME_RE = /^[a-zA-Z0-9_]{3,24}$/;

export default function UsernameSetupScreen() {
  const route = useRoute<Rt>();
  const { destination, channel, googleId, appleId, email, displayName } = route.params;
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { signIn } = useAuth();
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!USERNAME_RE.test(username)) {
      showAlert("Invalid username", "3-24 characters: letters, numbers, and underscores only.");
      return;
    }
    setLoading(true);
    try {
      const result = googleId
        ? await apiJson<{ token: string; user: any }>("POST", "/api/auth/google/signup/complete", { googleId, email, displayName, username })
        : appleId
          ? await apiJson<{ token: string; user: any }>("POST", "/api/auth/apple/signup/complete", { appleId, email, displayName, username })
          : await apiJson<{ token: string; user: any }>("POST", "/api/auth/signup/complete", { destination, channel, username });
      await signIn(result.token, result.user);
    } catch (err) {
      showAlert("Couldn't create account", err instanceof ApiError ? err.message : "Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: headerHeight + Spacing.xl, paddingBottom: insets.bottom + Spacing.xl }]}>
      <Text style={styles.title}>Choose a username</Text>
      <Text style={styles.subtitle}>This is how buyers and sellers will see you. You can't change it later without contacting support.</Text>
      <View style={styles.inputRow}>
        <Text style={styles.at}>@</Text>
        <TextInput
          style={styles.input}
          placeholder="card_collector"
          placeholderTextColor={Colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          value={username}
          onChangeText={setUsername}
          autoFocus
        />
      </View>
      <Button title="Create account" onPress={handleCreate} loading={loading} disabled={username.length < 3} style={{ marginTop: Spacing.xl }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, paddingHorizontal: Spacing.xl },
  title: { ...Typography.h2, color: Colors.text },
  subtitle: { ...Typography.body, color: Colors.textSecondary, marginTop: Spacing.xs, marginBottom: Spacing.xl },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.md,
  },
  at: { ...Typography.h3, color: Colors.textMuted },
  input: { flex: 1, paddingVertical: 14, paddingHorizontal: Spacing.xs, fontSize: 16, color: Colors.text },
});
