import React, { useMemo } from "react";
import { View, StyleSheet, FlatList, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Colors, Spacing, Typography } from "@/constants/theme";
import { ListingCard, ListingSummary } from "@/components/ListingCard";
import { EmptyState } from "@/components/ui";
import { RootStackParamList } from "@/navigation/types";
import { useAuth } from "@/contexts/AuthContext";

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function FavoritesScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { user } = useAuth();

  const { data: favorites, isLoading } = useQuery<ListingSummary[]>({ queryKey: ["/api/favorites"], enabled: !!user });
  const items = useMemo(() => (favorites ?? []).map((f) => ({ ...f, isFavorited: true })), [favorites]);

  if (!user) {
    return (
      <View style={[styles.container, { paddingTop: headerHeight }]}>
        <EmptyState icon={<Feather name="star" size={40} color={Colors.textMuted} />} title="Sign in to save favorites" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: headerHeight }]}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        numColumns={2}
        contentContainerStyle={{ padding: Spacing.sm, paddingBottom: insets.bottom + Spacing.xl }}
        renderItem={({ item }) => <ListingCard listing={item} onPress={() => navigation.navigate("ListingDetail", { listingId: item.id })} />}
        ListEmptyComponent={
          !isLoading ? <EmptyState icon={<Feather name="star" size={40} color={Colors.textMuted} />} title="No favorites yet" subtitle="Tap the star on any card to save it here" /> : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
});
