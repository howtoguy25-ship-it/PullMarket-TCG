import React from "react";
import { View, StyleSheet, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { Colors, Spacing, Typography } from "@/constants/theme";
import { Button } from "@/components/ui";
import { RootStackParamList } from "@/navigation/types";

type Nav = NativeStackNavigationProp<RootStackParamList, "HuntEntryReturn">;
type Rt = RouteProp<RootStackParamList, "HuntEntryReturn">;

export default function HuntEntryReturnScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const success = route.params?.status === "success";

  if (success) {
    void queryClient.invalidateQueries({ queryKey: ["/api/hunt/current"] });
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + Spacing.xxl, paddingBottom: insets.bottom + Spacing.xl }]}>
      <View style={[styles.iconCircle, { backgroundColor: success ? Colors.success : Colors.textMuted }]}>
        <Feather name={success ? "map" : "x"} size={40} color={Colors.white} />
      </View>
      <Text style={styles.title}>{success ? "You're in the hunt!" : "Checkout cancelled"}</Text>
      <Text style={styles.subtitle}>{success ? "Photos and the map drop the moment it's revealed." : "No payment was made."}</Text>
      <Button title="Back to Card Hunt" onPress={() => navigation.replace("Hunt")} style={{ marginTop: Spacing.xl }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, alignItems: "center", paddingHorizontal: Spacing.xl },
  iconCircle: { width: 84, height: 84, borderRadius: 42, alignItems: "center", justifyContent: "center", marginBottom: Spacing.lg },
  title: { ...Typography.h2, color: Colors.text, textAlign: "center" },
  subtitle: { ...Typography.body, color: Colors.textSecondary, textAlign: "center", marginTop: Spacing.sm },
});
