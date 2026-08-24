import React from "react";
import { View, StyleSheet, Text, FlatList, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRoute, RouteProp } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { LinearGradient } from "expo-linear-gradient";
import { Colors, Spacing, Typography, BorderRadius, Shadow } from "@/constants/theme";
import { EmptyState } from "@/components/ui";
import { RootStackParamList } from "@/navigation/types";

type Rt = RouteProp<RootStackParamList, "HuntUserStats">;

interface HuntWin {
  gameId: string;
  targetIndex: number;
  wonAt: string;
}
interface HuntUserStatsResponse {
  username: string;
  points: number;
  wins: HuntWin[];
}

export default function HuntUserStatsScreen() {
  const route = useRoute<Rt>();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { userId, username } = route.params;

  const { data, isLoading } = useQuery<HuntUserStatsResponse>({ queryKey: [`/api/hunt/users/${userId}/stats`] });

  if (isLoading) {
    return (
      <View style={[styles.center, { paddingTop: headerHeight }]}>
        <ActivityIndicator color={Colors.gold} size="large" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: headerHeight }]}>
      <LinearGradient colors={["#1A0F35", "#3B1F6B"]} style={styles.hero}>
        <Feather name="user" size={28} color={Colors.gold} />
        <Text style={styles.username}>@{username}</Text>
        <View style={styles.pointsBox}>
          <Feather name="zap" size={18} color={Colors.gold} />
          <Text style={styles.pointsValue}>{data?.points ?? 0}</Text>
          <Text style={styles.pointsLabel}>points</Text>
        </View>
      </LinearGradient>

      <FlatList
        data={data?.wins ?? []}
        keyExtractor={(item) => `${item.gameId}-${item.targetIndex}`}
        contentContainerStyle={{ padding: Spacing.lg, paddingBottom: insets.bottom + Spacing.xl, gap: Spacing.sm }}
        ListHeaderComponent={<Text style={styles.sectionTitle}>🏆 Card Hunt wins</Text>}
        renderItem={({ item }) => (
          <View style={[styles.winRow, Shadow.card]}>
            <View style={styles.winIcon}>
              <Feather name="award" size={16} color="#3A2A00" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.winTitle}>Card {item.targetIndex + 1}</Text>
              <Text style={styles.winDate}>{new Date(item.wonAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</Text>
            </View>
          </View>
        )}
        ListEmptyComponent={!isLoading ? <EmptyState icon={<Feather name="compass" size={36} color={Colors.textMuted} />} title="No wins yet" subtitle="Every Card Hunt find shows up here." /> : null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: Colors.background },
  hero: { alignItems: "center", gap: Spacing.sm, paddingVertical: Spacing.xl, paddingHorizontal: Spacing.lg },
  username: { fontSize: 20, fontWeight: "800", color: Colors.white },
  pointsBox: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.1)", borderRadius: BorderRadius.pill, paddingVertical: 8, paddingHorizontal: Spacing.lg, borderWidth: 1, borderColor: "rgba(255,203,5,0.4)" },
  pointsValue: { fontSize: 20, fontWeight: "800", color: Colors.gold },
  pointsLabel: { ...Typography.small, color: "rgba(255,255,255,0.7)" },
  sectionTitle: { ...Typography.h3, color: Colors.text, marginBottom: Spacing.sm },
  winRow: { flexDirection: "row", alignItems: "center", gap: Spacing.md, backgroundColor: Colors.surface, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md },
  winIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.gold, alignItems: "center", justifyContent: "center" },
  winTitle: { ...Typography.bodyBold, color: Colors.text },
  winDate: { ...Typography.small, color: Colors.textMuted },
});
