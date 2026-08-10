import React, { useState } from "react";
import { View, StyleSheet, Text, Image, Platform, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { Colors, Spacing, Typography, BorderRadius } from "@/constants/theme";
import { Button } from "@/components/ui";
import { GalaxyBackground } from "@/components/GalaxyBackground";
import { RotatingHoloCard } from "@/components/RotatingHoloCard";
import { AuthStackParamList } from "@/navigation/types";
import { apiJson, ApiError } from "@/lib/api";

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
    <GalaxyBackground>
      <View style={[styles.container, { paddingTop: insets.top + Spacing.lg, paddingBottom: insets.bottom + Spacing.xl }]}>
        <View style={styles.brandRow}>
          <Image source={require("@/assets/icon-mark-only.png")} style={styles.logoMark} resizeMode="contain" />
          <View>
            <Text style={styles.title}>PullMarket</Text>
            <Text style={styles.titleAccent}>TCG</Text>
          </View>
        </View>

        <View style={styles.hero}>
          <RotatingHoloCard />
          <Text style={styles.subtitle}>Buy and sell Pokémon &amp; One Piece cards</Text>
        </View>

        <View style={styles.panel}>
          <View style={styles.actions}>
            <Button title="Continue with phone number" variant="gold" icon={<Feather name="phone" size={17} color="#3A2A00" />} onPress={() => navigation.navigate("PhoneSignIn")} style={styles.actionButton} />
            <Button title="Continue with email" variant="white" icon={<Feather name="mail" size={17} color="#3A2A00" />} onPress={() => navigation.navigate("EmailSignIn")} style={styles.actionButton} />
            <Button title="Continue with Google" variant="outlineOnDark" loading={googleLoading} icon={<Feather name="chrome" size={17} color={Colors.white} />} onPress={handleGoogleSignIn} style={styles.actionButton} />
          </View>
          <Text style={styles.terms}>By continuing you agree this is a demo build — see the README for what's needed to go fully live.</Text>
        </View>
      </View>
    </GalaxyBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: Spacing.xl, justifyContent: "space-between" },
  brandRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, alignSelf: "center" },
  logoMark: { width: 44, height: 44 },
  title: { ...Typography.h2, color: Colors.white, lineHeight: 24 },
  titleAccent: { ...Typography.h3, color: Colors.gold, letterSpacing: 3, lineHeight: 18 },
  hero: { alignItems: "center", justifyContent: "center", flex: 1, gap: Spacing.lg },
  subtitle: { ...Typography.body, color: "rgba(255,255,255,0.85)", textAlign: "center" },
  panel: {
    backgroundColor: "rgba(20, 12, 40, 0.55)",
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  actions: { alignItems: "center", gap: Spacing.md },
  actionButton: { paddingHorizontal: Spacing.xxl, minWidth: 260 },
  terms: { ...Typography.small, color: "rgba(255,255,255,0.55)", textAlign: "center" },
});
