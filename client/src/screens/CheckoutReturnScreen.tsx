import React from "react";
import { View, StyleSheet, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { Colors, Spacing, Typography } from "@/constants/theme";
import { Button } from "@/components/ui";
import { RootStackParamList } from "@/navigation/types";

type Nav = NativeStackNavigationProp<RootStackParamList, "CheckoutReturn">;
type Rt = RouteProp<RootStackParamList, "CheckoutReturn">;

export default function CheckoutReturnScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const insets = useSafeAreaInsets();
  const { status, order } = route.params ?? {};
  const success = status === "success";

  return (
    <View style={[styles.container, { paddingTop: insets.top + Spacing.xxl, paddingBottom: insets.bottom + Spacing.xl }]}>
      <View style={[styles.iconCircle, { backgroundColor: success ? Colors.success : Colors.textMuted }]}>
        <Feather name={success ? "check" : "x"} size={40} color={Colors.white} />
      </View>
      <Text style={styles.title}>{success ? "Payment successful!" : "Checkout cancelled"}</Text>
      <Text style={styles.subtitle}>
        {success
          ? "Your order is confirmed. The seller has been notified and will ship it with a tracked courier."
          : "No payment was made — your cart items are still there if you want to try again."}
      </Text>

      {success && order ? (
        <Button title="View order" onPress={() => navigation.replace("OrderDetail", { orderId: order })} style={{ marginTop: Spacing.xl }} />
      ) : null}
      <Button title="Back to marketplace" variant="outline" onPress={() => navigation.navigate("MainTabs")} style={{ marginTop: Spacing.md }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, alignItems: "center", paddingHorizontal: Spacing.xl },
  iconCircle: { width: 84, height: 84, borderRadius: 42, alignItems: "center", justifyContent: "center", marginBottom: Spacing.lg },
  title: { ...Typography.h2, color: Colors.text, textAlign: "center" },
  subtitle: { ...Typography.body, color: Colors.textSecondary, textAlign: "center", marginTop: Spacing.sm },
});
