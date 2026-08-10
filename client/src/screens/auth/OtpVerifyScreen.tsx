import React, { useState, useRef } from "react";
import { View, StyleSheet, Text, TextInput, Platform, Alert, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Colors, Spacing, Typography, BorderRadius } from "@/constants/theme";
import { Button } from "@/components/ui";
import { AuthStackParamList } from "@/navigation/types";
import { apiJson, ApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

type Nav = NativeStackNavigationProp<AuthStackParamList, "OtpVerify">;
type Rt = RouteProp<AuthStackParamList, "OtpVerify">;

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

export default function OtpVerifyScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const { destination, channel } = route.params;
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { signIn } = useAuth();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  const handleVerify = async (value: string) => {
    if (value.length !== 6) return;
    setLoading(true);
    try {
      const result = await apiJson<{ status: string; token?: string; user?: any }>("POST", "/api/auth/otp/verify", { destination, channel, code: value });
      if (result.status === "signed_in" && result.token && result.user) {
        await signIn(result.token, result.user);
      } else {
        navigation.navigate("UsernameSetup", { destination, channel });
      }
    } catch (err) {
      showAlert("Incorrect code", err instanceof ApiError ? err.message : "Please try again.");
      setCode("");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    try {
      await apiJson("POST", "/api/auth/otp/request", { destination, channel });
      showAlert("Code resent", `A new code was sent to ${destination}.`);
    } catch (err) {
      showAlert("Couldn't resend", err instanceof ApiError ? err.message : "Please try again.");
    } finally {
      setResending(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: headerHeight + Spacing.xl, paddingBottom: insets.bottom + Spacing.xl }]}>
      <Text style={styles.title}>Enter your code</Text>
      <Text style={styles.subtitle}>We sent a 6-digit code to {destination}</Text>

      <TextInput
        style={styles.codeInput}
        placeholder="000000"
        placeholderTextColor={Colors.textMuted}
        keyboardType="number-pad"
        value={code}
        maxLength={6}
        onChangeText={(v) => {
          const digits = v.replace(/\D/g, "");
          setCode(digits);
          if (digits.length === 6) handleVerify(digits);
        }}
        autoFocus
      />

      <Button title="Verify" onPress={() => handleVerify(code)} loading={loading} disabled={code.length !== 6} style={{ marginTop: Spacing.xl }} />

      <Pressable onPress={handleResend} disabled={resending} style={{ marginTop: Spacing.lg, alignSelf: "center" }}>
        <Text style={styles.resend}>{resending ? "Resending…" : "Didn't get a code? Resend"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, paddingHorizontal: Spacing.xl },
  title: { ...Typography.h2, color: Colors.text },
  subtitle: { ...Typography.body, color: Colors.textSecondary, marginTop: Spacing.xs, marginBottom: Spacing.xl },
  codeInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 16,
    backgroundColor: Colors.surface,
    fontSize: 28,
    letterSpacing: 12,
    textAlign: "center",
    color: Colors.text,
  },
  resend: { ...Typography.bodyBold, color: Colors.primary },
});
