import React, { useState } from "react";
import { View, StyleSheet, Text, TextInput, Platform, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Colors, Spacing, Typography, BorderRadius } from "@/constants/theme";
import { Button } from "@/components/ui";
import { AuthStackParamList } from "@/navigation/types";
import { apiJson, ApiError } from "@/lib/api";

type Nav = NativeStackNavigationProp<AuthStackParamList, "EmailSignIn">;

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function EmailSignInScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  const handleContinue = async () => {
    if (!EMAIL_RE.test(email)) {
      showAlert("Enter a valid email", "Please double-check your email address.");
      return;
    }
    setLoading(true);
    try {
      await apiJson("POST", "/api/auth/otp/request", { destination: email, channel: "email" });
      navigation.navigate("OtpVerify", { destination: email, channel: "email" });
    } catch (err) {
      console.error("[auth] Email OTP request failed", { email, status: err instanceof ApiError ? err.status : undefined, message: err instanceof Error ? err.message : err });
      showAlert("Couldn't send code", err instanceof ApiError ? (err.detail ? `${err.message}\n\n${err.detail}` : err.message) : "Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: headerHeight + Spacing.xl, paddingBottom: insets.bottom + Spacing.xl }]}>
      <Text style={styles.title}>What's your email?</Text>
      <Text style={styles.subtitle}>We'll email you a 6-digit code to verify it's you.</Text>
      <TextInput
        style={styles.input}
        placeholder="you@example.com"
        placeholderTextColor={Colors.textMuted}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        value={email}
        onChangeText={setEmail}
        autoFocus
      />
      <Button title="Send code" onPress={handleContinue} loading={loading} style={{ marginTop: Spacing.xl }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, paddingHorizontal: Spacing.xl },
  title: { ...Typography.h2, color: Colors.text },
  subtitle: { ...Typography.body, color: Colors.textSecondary, marginTop: Spacing.xs, marginBottom: Spacing.xl },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 14,
    backgroundColor: Colors.surface,
    fontSize: 16,
    color: Colors.text,
  },
});
