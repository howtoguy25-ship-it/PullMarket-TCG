import React from "react";
import { View, StyleSheet, Text, FlatList, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { Colors, Spacing, Typography } from "@/constants/theme";
import { EmptyState } from "@/components/ui";
import { Avatar } from "@/components/Avatar";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { RootStackParamList } from "@/navigation/types";
import { isActivePro } from "@shared/validation";

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Rt = RouteProp<RootStackParamList, "Followers">;

interface FollowerRow {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  proStatus: string;
  proCurrentPeriodEnd: string | null;
  followedAt: string;
  isFriend: boolean;
}

export default function FollowersScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { userId, username } = route.params;

  const { data: followers, isLoading } = useQuery<FollowerRow[]>({ queryKey: [`/api/follows/${userId}/followers`] });

  return (
    <View style={[styles.container, { paddingTop: headerHeight }]}>
      <FlatList
        data={followers ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingTop: Spacing.md, paddingBottom: insets.bottom + Spacing.xl, flexGrow: 1 }}
        ListHeaderComponent={
          <Text style={styles.subtitle}>
            {isLoading ? " " : `${followers?.length ?? 0} ${(followers?.length ?? 0) === 1 ? "person follows" : "people follow"} @${username}`}
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => navigation.navigate("UserProfile", { userId: item.id })}>
            <Avatar avatarUrl={item.avatarUrl} seed={item.username} size={44} />
            <View style={{ flex: 1 }}>
              <View style={styles.usernameRow}>
                <Text style={styles.username}>@{item.username}</Text>
                {isActivePro(item) ? <VerifiedBadge size={13} /> : null}
                {item.isFriend ? (
                  <View style={styles.friendChip}>
                    <MaterialCommunityIcons name="handshake" size={12} color={Colors.secondary} />
                    <Text style={styles.friendChipText}>Friend</Text>
                  </View>
                ) : null}
              </View>
              {item.displayName ? <Text style={styles.displayName}>{item.displayName}</Text> : null}
            </View>
          </Pressable>
        )}
        ListEmptyComponent={!isLoading ? <EmptyState icon={<Feather name="users" size={36} color={Colors.textMuted} />} title="No followers yet" subtitle={`Nobody is following @${username} yet.`} /> : null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  subtitle: { ...Typography.small, color: Colors.textSecondary, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  usernameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  username: { ...Typography.bodyBold, color: Colors.text, fontSize: 15 },
  displayName: { ...Typography.small, color: Colors.textSecondary, marginTop: 1 },
  friendChip: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: Colors.secondary + "18", borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  friendChipText: { fontSize: 10, fontWeight: "800", color: Colors.secondary },
});
