import React from "react";
import { View, StyleSheet, Text, FlatList, Platform, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Colors, Spacing, Typography, BorderRadius } from "@/constants/theme";
import { Button, Badge } from "@/components/ui";
import { Avatar } from "@/components/Avatar";
import { ListingCard, ListingSummary } from "@/components/ListingCard";
import { RootStackParamList } from "@/navigation/types";
import { apiJson, apiRequest, ApiError } from "@/lib/api";

type Nav = NativeStackNavigationProp<RootStackParamList>;
type ProfileRoute = RouteProp<RootStackParamList, "UserProfile">;

function confirmAsync(title: string, message: string, confirmLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (Platform.OS === "web") {
      resolve(window.confirm(`${title}\n${message}`));
    } else {
      Alert.alert(title, message, [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: confirmLabel, style: "destructive", onPress: () => resolve(true) },
      ]);
    }
  });
}

interface UserProfile {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  identityVerificationStatus: string;
  friendStatus: "none" | "friends" | "pending_sent" | "pending_received";
  friendRequestId: string | null;
  conversation: { id: string; status: string } | null;
  listings: ListingSummary[];
}

export default function UserProfileScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<ProfileRoute>();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const queryClient = useQueryClient();
  const { userId } = route.params;

  const { data: profile, isLoading } = useQuery<UserProfile>({ queryKey: [`/api/users/${userId}/profile`] });

  // Friend status can change from other screens too (accepting from
  // FriendRequestsScreen, an auto-accept from the other person requesting
  // back) — invalidate every friend-related cache on any successful
  // mutation here, not just this screen's own profile query, so nothing
  // shows a stale "Add friend" / "Incoming request" after the fact.
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/users/${userId}/profile`] });
    queryClient.invalidateQueries({ queryKey: [`/api/friends/status/${userId}`] });
    queryClient.invalidateQueries({ queryKey: ["/api/friends/requests"] });
  };

  const requestMutation = useMutation({ mutationFn: () => apiJson("POST", `/api/friends/request/${userId}`), onSuccess: invalidate });
  const acceptMutation = useMutation({
    mutationFn: () => apiJson("POST", `/api/friends/${profile?.friendRequestId}/accept`),
    onSuccess: invalidate,
  });
  const unfriendMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/friends/${userId}`),
    onSuccess: invalidate,
  });

  const handleUnfriend = async () => {
    const ok = await confirmAsync("Remove friend", `Remove @${profile?.username} from your friends?`, "Remove");
    if (ok) unfriendMutation.mutate();
  };

  const startChatMutation = useMutation({
    mutationFn: () => apiJson<{ id: string }>("POST", `/api/chat/conversations/with/${userId}`),
    onSuccess: (convo) => navigation.navigate("ChatThread", { conversationId: convo.id, otherUserId: userId }),
    onError: (err) => console.warn(err instanceof ApiError ? err.message : "Couldn't start chat"),
  });

  if (isLoading || !profile) {
    return <View style={[styles.container, { paddingTop: headerHeight + Spacing.xl }]} />;
  }

  const friendButtonProps =
    profile.friendStatus === "friends"
      ? { title: "Friends", variant: "outline" as const, icon: <Feather name="user-check" size={16} color={Colors.primary} />, onPress: () => void handleUnfriend(), disabled: false }
      : profile.friendStatus === "pending_sent"
        ? { title: "Request sent", variant: "outline" as const, icon: <Feather name="clock" size={16} color={Colors.primary} />, onPress: undefined, disabled: true }
        : profile.friendStatus === "pending_received"
          ? { title: "Accept request", variant: "primary" as const, icon: <Feather name="user-plus" size={16} color={Colors.white} />, onPress: () => acceptMutation.mutate(), disabled: false }
          : { title: "Add friend", variant: "outline" as const, icon: <Feather name="user-plus" size={16} color={Colors.primary} />, onPress: () => requestMutation.mutate(), disabled: false };

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={{ paddingTop: headerHeight + Spacing.lg, paddingBottom: insets.bottom + Spacing.xl, paddingHorizontal: Spacing.lg }}
      data={profile.listings}
      keyExtractor={(item) => item.id}
      numColumns={2}
      ListHeaderComponent={
        <View>
          <View style={styles.header}>
            <Avatar avatarUrl={profile.avatarUrl} seed={profile.username} size={72} />
            <Text style={styles.username}>@{profile.username}</Text>
            {profile.displayName ? <Text style={styles.displayName}>{profile.displayName}</Text> : null}
            {profile.identityVerificationStatus === "verified" ? <Badge label="Verified seller" color={Colors.success} style={{ marginTop: Spacing.xs }} /> : null}
          </View>

          <View style={styles.buttonRow}>
            <Button
              title={friendButtonProps.title}
              variant={friendButtonProps.variant}
              icon={friendButtonProps.icon}
              onPress={friendButtonProps.onPress}
              disabled={friendButtonProps.disabled}
              loading={requestMutation.isPending || acceptMutation.isPending || unfriendMutation.isPending}
              style={styles.halfButton}
            />
            <Button
              title="Message"
              icon={<Feather name="message-circle" size={16} color={Colors.white} />}
              onPress={() => startChatMutation.mutate()}
              loading={startChatMutation.isPending}
              style={styles.halfButton}
            />
          </View>

          {profile.listings.length > 0 ? <Text style={styles.sectionTitle}>Listings</Text> : null}
        </View>
      }
      renderItem={({ item }) => <ListingCard listing={item} onPress={() => navigation.navigate("ListingDetail", { listingId: item.id })} />}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { alignItems: "center", gap: 4 },
  username: { ...Typography.h3, color: Colors.text, marginTop: Spacing.sm },
  displayName: { ...Typography.body, color: Colors.textSecondary },
  buttonRow: { flexDirection: "row", gap: Spacing.sm, marginTop: Spacing.lg },
  halfButton: { flex: 1 },
  sectionTitle: { ...Typography.small, color: Colors.textSecondary, fontWeight: "700", marginTop: Spacing.xl, marginBottom: Spacing.xs, letterSpacing: 0.3 },
});
