import React, { useState, useEffect } from "react";
import { View, StyleSheet, Text, Image, Platform, Alert } from "react-native";
import Constants from "expo-constants";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import { Feather, Ionicons } from "@expo/vector-icons";
import { Colors, Spacing, Typography, BorderRadius } from "@/constants/theme";
import { Button } from "@/components/ui";
import { GalaxyBackground } from "@/components/GalaxyBackground";
import { RotatingHoloCard } from "@/components/RotatingHoloCard";
import { AuthStackParamList } from "@/navigation/types";
import { apiJson, ApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { signInWithGoogleWeb } from "@/lib/googleAuth";
import { signInWithAppleWeb } from "@/lib/appleAuthWeb";

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

type AppleAuthResult =
  | { status: "signed_in"; token: string; user: any }
  | { status: "needs_username"; appleId: string; email?: string; displayName?: string };

export default function WelcomeScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);

  const appleServicesId = Constants.expoConfig?.extra?.APPLE_SERVICES_ID as string | undefined;

  useEffect(() => {
    if (Platform.OS === "web") {
      setAppleAvailable(!!appleServicesId);
      return;
    }
    if (Platform.OS !== "ios") return;
    import("expo-apple-authentication").then(({ isAvailableAsync }) => {
      isAvailableAsync().then(setAppleAvailable);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAppleResult = async (result: AppleAuthResult) => {
    if (result.status === "signed_in") {
      await signIn(result.token, result.user);
    } else {
      navigation.navigate("UsernameSetup", { appleId: result.appleId, email: result.email, displayName: result.displayName });
    }
  };

  const handleAppleSignInWeb = async () => {
    if (!appleServicesId) {
      showAlert("Apple Sign-In not set up yet", "Missing EXPO_PUBLIC_APPLE_SERVICES_ID.");
      return;
    }
    const { identityToken, fullName } = await signInWithAppleWeb(appleServicesId);
    const result = await apiJson<AppleAuthResult>("POST", "/api/auth/apple", { identityToken, fullName });
    await handleAppleResult(result);
  };

  const handleAppleSignInNative = async () => {
    const AppleAuthentication = await import("expo-apple-authentication");
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
    });
    if (!credential.identityToken) throw new Error("Apple didn't return an identity token");
    const result = await apiJson<AppleAuthResult>("POST", "/api/auth/apple", {
      identityToken: credential.identityToken,
      fullName: credential.fullName ? { givenName: credential.fullName.givenName ?? undefined, familyName: credential.fullName.familyName ?? undefined } : undefined,
    });
    await handleAppleResult(result);
  };

  const handleAppleSignIn = async () => {
    setAppleLoading(true);
    try {
      if (Platform.OS === "web") {
        await handleAppleSignInWeb();
      } else {
        await handleAppleSignInNative();
      }
    } catch (err: any) {
      if (err?.code === "ERR_REQUEST_CANCELED" || (err instanceof Error && /cancel/i.test(err.message))) {
        // user dismissed the sheet/popup — not an error
      } else if (err instanceof ApiError) {
        showAlert("Apple Sign-In failed", err.message);
      } else {
        showAlert("Apple Sign-In failed", err instanceof Error ? err.message : "Please try again.");
      }
    } finally {
      setAppleLoading(false);
    }
  };

  const handleGoogleResult = async (result: GoogleAuthResult) => {
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
  };

  const handleGoogleSignInWeb = async (clientId: string) => {
    const code = await signInWithGoogleWeb(clientId);
    const result = await apiJson<GoogleAuthResult>("POST", "/api/auth/google/code", { code });
    await handleGoogleResult(result);
  };

  const handleGoogleSignInNative = async (webClientId: string) => {
    const iosClientId = Constants.expoConfig?.extra?.GOOGLE_IOS_CLIENT_ID as string | undefined;
    if (Platform.OS === "ios" && !iosClientId) {
      showAlert("Google Sign-In not set up yet", "Missing GOOGLE_IOS_CLIENT_ID — create an iOS OAuth client at console.cloud.google.com and set it in your environment.");
      return;
    }

    const { GoogleSignin, isSuccessResponse } = await import("@react-native-google-signin/google-signin");
    GoogleSignin.configure({ webClientId, iosClientId });
    if (Platform.OS === "android") await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) return; // user cancelled — not an error
    const idToken = response.data.idToken;
    if (!idToken) throw new Error("Google didn't return an ID token");

    const result = await apiJson<GoogleAuthResult>("POST", "/api/auth/google", { idToken });
    await handleGoogleResult(result);
  };

  const handleGoogleSignIn = async () => {
    const clientId = Constants.expoConfig?.extra?.GOOGLE_WEB_CLIENT_ID as string | undefined;
    if (!clientId) {
      showAlert("Google Sign-In not set up yet", "Missing EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID.");
      return;
    }

    setGoogleLoading(true);
    try {
      if (Platform.OS === "web") {
        await handleGoogleSignInWeb(clientId);
      } else {
        // Only works in a native app built via EAS — the native Google Sign-In
        // module isn't available inside Expo Go or the web preview.
        await handleGoogleSignInNative(clientId);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        showAlert("Google Sign-In failed", err.message);
      } else if (err instanceof Error && /cancelled/i.test(err.message)) {
        // user closed the popup/sheet — no need to show an error
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
            {appleAvailable && (
              <Button title="Continue with Apple" variant="outlineOnDark" loading={appleLoading} icon={<Ionicons name="logo-apple" size={19} color={Colors.white} />} onPress={handleAppleSignIn} style={styles.actionButton} />
            )}
          </View>
        </View>
      </View>
    </GalaxyBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, width: "100%", maxWidth: 480, alignSelf: "center", paddingHorizontal: Spacing.xl, justifyContent: "space-between" },
  brandRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, alignSelf: "center" },
  logoMark: { width: 42, height: 64 },
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
