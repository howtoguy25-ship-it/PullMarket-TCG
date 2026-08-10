import React, { useState } from "react";
import { View, StyleSheet, Text, Image, Platform, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { Colors, Spacing, Typography, BorderRadius } from "@/constants/theme";
import { Button } from "@/components/ui";
import { AuthStackParamList } from "@/navigation/types";
import { apiJson, ApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

type Nav = NativeStackNavigationProp<AuthStackParamList, "Welcome">;

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

export default function WelcomeScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();
  const [googleLoading, setGoogleLoading] = useState(false);

  const handleGoogleSignIn = async () => {
    // Real Google Sign-In requires GOOGLE_WEB_CLIENT_ID (+ iOS/Android client
    // IDs for native builds) from https://console.cloud.google.com — once
    // set, wire @react-native-google-signin/google-signin (native) or
    // Google Identity Services (web) here to obtain an idToken and POST it
    // to /api/auth/google. Left as a clear call-to-action until those
    // credentials exist so the button doesn't silently pretend to work.
    setGoogleLoading(true);
    try {
      await apiJson("POST", "/api/auth/google", { idToken: "placeholder" });
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        showAlert("Google Sign-In not set up yet", err.message);
      } else {
        showAlert("Google Sign-In not set up yet", "Add GOOGLE_WEB_CLIENT_ID in your .env, then wire the native Google SDK here — see the code comment in WelcomeScreen.tsx.");
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + Spacing.xxl, paddingBottom: insets.bottom + Spacing.xl }]}>
      <View style={styles.hero}>
        <View style={styles.logoCircle}>
          <Feather name="zap" size={40} color={Colors.white} />
        </View>
        <Text style={styles.title}>PullMarket TCG</Text>
        <Text style={styles.subtitle}>Buy and sell Pokémon &amp; One Piece cards</Text>
      </View>

      <View style={styles.actions}>
        <Button title="Continue with phone number" variant="gold" icon={<Feather name="phone" size={18} color="#3A2A00" />} onPress={() => navigation.navigate("PhoneSignIn")} />
        <Button title="Continue with email" variant="white" icon={<Feather name="mail" size={18} color="#3A2A00" />} onPress={() => navigation.navigate("EmailSignIn")} />
        <Button title="Continue with Google" variant="outlineOnDark" loading={googleLoading} icon={<Feather name="chrome" size={18} color={Colors.white} />} onPress={handleGoogleSignIn} />
      </View>

      <Text style={styles.terms}>By continuing you agree this is a demo build — see the README for what's needed to go fully live.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.primary, paddingHorizontal: Spacing.xl, justifyContent: "space-between" },
  hero: { alignItems: "center", gap: Spacing.sm, marginTop: Spacing.xxl },
  logoCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: Colors.goldDark,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.md,
    borderWidth: 4,
    borderColor: Colors.white,
  },
  title: { ...Typography.h1, color: Colors.white },
  subtitle: { ...Typography.body, color: "rgba(255,255,255,0.85)" },
  actions: { gap: Spacing.md },
  terms: { ...Typography.small, color: "rgba(255,255,255,0.7)", textAlign: "center" },
});
