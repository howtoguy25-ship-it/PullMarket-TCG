import React, { useEffect, useRef, useState } from "react";
import { View, StyleSheet, Text, TextInput, Platform, Alert, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  withRepeat,
  interpolateColor,
  Easing,
} from "react-native-reanimated";
import { Colors, Spacing, Typography, BorderRadius } from "@/constants/theme";
import { Button } from "@/components/ui";
import { AuthStackParamList } from "@/navigation/types";
import { apiJson, ApiError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

type Nav = NativeStackNavigationProp<AuthStackParamList, "OtpVerify">;
type Rt = RouteProp<AuthStackParamList, "OtpVerify">;

const CODE_LENGTH = 6;
const ACCENT: [string, string] = [Colors.primary, Colors.goldDark];

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

function DigitBox({ digit, index, active, status }: { digit: string; index: number; active: boolean; status: "idle" | "error" | "success" }) {
  const pop = useSharedValue(1);
  const pulse = useSharedValue(0);
  const flash = useSharedValue(0);

  useEffect(() => {
    pop.value = withSequence(withTiming(digit ? 1.12 : 1, { duration: 90 }), withTiming(1, { duration: 110 }));
  }, [digit]);

  useEffect(() => {
    if (active) {
      pulse.value = withRepeat(withSequence(withTiming(1, { duration: 550, easing: Easing.inOut(Easing.ease) }), withTiming(0, { duration: 550, easing: Easing.inOut(Easing.ease) })), -1, false);
    } else {
      pulse.value = withTiming(0, { duration: 150 });
    }
  }, [active]);

  useEffect(() => {
    flash.value = status === "idle" ? withTiming(0, { duration: 150 }) : withTiming(1, { duration: 120 });
  }, [status]);

  const animatedStyle = useAnimatedStyle(() => {
    const filledBorder = interpolateColor(pulse.value, [0, 1], [Colors.primary, Colors.gold]);
    const borderColor =
      status === "success" ? interpolateColor(flash.value, [0, 1], [Colors.border, Colors.success]) : status === "error" ? interpolateColor(flash.value, [0, 1], [Colors.border, Colors.danger]) : digit ? filledBorder : active ? interpolateColor(pulse.value, [0, 1], [Colors.border, Colors.primary]) : Colors.border;

    const backgroundColor = status === "success" ? interpolateColor(flash.value, [0, 1], [Colors.surface, "#E8F8EF"]) : status === "error" ? interpolateColor(flash.value, [0, 1], [Colors.surface, "#FDEBEB"]) : Colors.surface;

    return {
      borderColor,
      backgroundColor,
      transform: [{ scale: pop.value }],
    };
  });

  return (
    <Animated.View style={[styles.digitBox, animatedStyle]}>
      <Text style={styles.digitText}>{digit}</Text>
    </Animated.View>
  );
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
  const [status, setStatus] = useState<"idle" | "error" | "success">("idle");
  const inputRef = useRef<TextInput>(null);
  // A ref, not the `loading` state: iOS's SMS-code autofill is known to
  // fire the hidden input's onChangeText more than once for the same code
  // in the same tick, before React has re-rendered — two calls to
  // handleVerify made that way would both read the OLD `loading` value from
  // their own stale closure and both slip past a state-based guard,
  // double-submitting the same code. A ref update is synchronous and
  // visible to the very next call immediately, closing that gap.
  const verifyingRef = useRef(false);

  const entrance = useSharedValue(0);
  const shakeX = useSharedValue(0);

  useEffect(() => {
    entrance.value = withTiming(1, { duration: 480, easing: Easing.out(Easing.cubic) });
  }, []);

  const entranceStyle = useAnimatedStyle(() => ({
    opacity: entrance.value,
    transform: [{ translateY: (1 - entrance.value) * 18 }],
  }));

  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shakeX.value }] }));

  const triggerHaptic = async (kind: "success" | "error") => {
    if (Platform.OS === "web") return;
    const Haptics = await import("expo-haptics");
    if (kind === "success") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    else Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
  };

  const handleVerify = async (value: string) => {
    if (value.length !== CODE_LENGTH || verifyingRef.current) return;
    verifyingRef.current = true;
    setLoading(true);
    try {
      const result = await apiJson<{ status: string; token?: string; user?: any }>("POST", "/api/auth/otp/verify", { destination, channel, code: value });
      setStatus("success");
      void triggerHaptic("success");
      setTimeout(async () => {
        if (result.status === "signed_in" && result.token && result.user) {
          await signIn(result.token, result.user);
        } else {
          navigation.navigate("UsernameSetup", { destination, channel });
        }
      }, 420);
    } catch (err) {
      verifyingRef.current = false;
      setStatus("error");
      void triggerHaptic("error");
      shakeX.value = withSequence(
        withTiming(-10, { duration: 45 }),
        withTiming(10, { duration: 45 }),
        withTiming(-8, { duration: 45 }),
        withTiming(8, { duration: 45 }),
        withTiming(0, { duration: 45 }),
      );
      showAlert("Incorrect code", err instanceof ApiError ? err.message : "Please try again.");
      setTimeout(() => {
        setCode("");
        setStatus("idle");
      }, 350);
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
      <Animated.View style={entranceStyle}>
        <LinearGradient colors={ACCENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.iconCircle}>
          <Feather name={channel === "sms" ? "message-circle" : "mail"} size={28} color={Colors.white} />
        </LinearGradient>

        <Text style={styles.title}>Enter your code</Text>
        <Text style={styles.subtitle}>We sent a 6-digit code to {destination}</Text>

        <Pressable onPress={() => inputRef.current?.focus()}>
          <Animated.View style={[styles.boxRow, shakeStyle]}>
            {Array.from({ length: CODE_LENGTH }).map((_, i) => (
              <DigitBox key={i} digit={code[i] ?? ""} index={i} active={i === code.length && status === "idle"} status={status} />
            ))}
          </Animated.View>
        </Pressable>

        <TextInput
          ref={inputRef}
          style={styles.hiddenInput}
          keyboardType="number-pad"
          value={code}
          maxLength={CODE_LENGTH}
          onChangeText={(v) => {
            const digits = v.replace(/\D/g, "");
            setCode(digits);
            if (digits.length === CODE_LENGTH) handleVerify(digits);
          }}
          autoFocus
          caretHidden
        />

        <Button title="Verify" onPress={() => handleVerify(code)} loading={loading} disabled={code.length !== CODE_LENGTH} style={{ marginTop: Spacing.xl }} />

        <Pressable onPress={handleResend} disabled={resending} style={{ marginTop: Spacing.lg, alignSelf: "center" }}>
          <Text style={styles.resend}>{resending ? "Resending…" : "Didn't get a code? Resend"}</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, paddingHorizontal: Spacing.xl },
  iconCircle: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", marginBottom: Spacing.lg },
  title: { ...Typography.h2, color: Colors.text },
  subtitle: { ...Typography.body, color: Colors.textSecondary, marginTop: Spacing.xs, marginBottom: Spacing.xl },
  boxRow: { flexDirection: "row", justifyContent: "space-between" },
  digitBox: {
    width: 48,
    height: 58,
    borderRadius: BorderRadius.md,
    borderWidth: 2,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  digitText: { fontSize: 24, fontWeight: "800", color: Colors.text },
  hiddenInput: { position: "absolute", opacity: 0, height: 1, width: 1 },
  resend: { ...Typography.bodyBold, color: Colors.primary },
});
