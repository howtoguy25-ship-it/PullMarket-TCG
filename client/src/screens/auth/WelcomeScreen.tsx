import React, { useState } from "react";
import { View, StyleSheet, Text, Image, Platform, Alert } from "react-native";
import Constants from "expo-constants";
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
import { useAuth } from "@/contexts/AuthContext";
import { signInWithGoogleWeb } from "@/lib/googleAuth";

type Nav = NativeStackNavigationProp<AuthStackParamList, "Welcome">;

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

type GoogleAuthResult =
  | { status: "signed_in"; token: string; user: any }
  | { status: "needs_username"; googleId: string; email: string; displayName?: string; avatarUrl?: string };

export default function WelcomeScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();
  const [googleLoading, setGoogleLoading] = useState(false);

  const handleGoogleSignIn = async () => {
    const clientId = Constants.expoConfig?.extra?.GOOGLE_WEB_CLIENT_ID as string | undefined;

    if (Platform.OS !== "web") {
      // Native Google Sign-In needs GOOGLE_IOS_CLIENT_ID / GOOGLE_ANDROID_CLIENT_ID
      // and the @react-native-google-signin/google-signin native module, which
      // only works in an EAS-built app (not Expo Go). Wire it here once those
      // credentials exist and a dev/production build is available.
      showAlert("Not available in this preview", "Google Sign-In on iOS/Android needs a native app build (via EAS) — it's already working on the web version.");
      return;
    }

    if (!clientId) {
      showAlert("Google Sign-In not set up yet", "Missing EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID.");
      return;
    }

    setGoogleLoading(true);
    try {
      const code = await signInWithGoogleWeb(clientId);
      const result = await apiJson<GoogleAuthResult>("POST", "/api/auth/google/code", { code });
      if (result.status === "signed_in") {
        await signIn(result.token, result.user);
      } else {
        navigation.navigate("UsernameSetup", {
          googleId: result.googleId,
          email: result.email,
          displayName: result.displayName,
          avatarUrl: result.avatarUrl,
        });
      }
    } catch (err) {
      if (err instanceof ApiError) {
        showAlert("Google Sign-In failed", err.message);
      } else if (err instanceof Error && /cancelled/i.test(err.message)) {
        // user closed the popup — no need to show an error
      } else {
        showAlert("Google Sign-In failed", err instanceof Error ? err.message : "Please try again.");
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
        </View>
      </View>
    </GalaxyBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, width: "100%", maxWidth: 480, alignSelf: "center", paddingHorizontal: Spacing.xl, justifyContent: "space-between" },
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
  },
  actions: { alignItems: "stretch", gap: Spacing.md },
  actionButton: { width: "100%", paddingHorizontal: Spacing.lg },
});
