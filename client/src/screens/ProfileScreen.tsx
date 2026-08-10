import React from "react";
import { View, StyleSheet, Text, ScrollView, Pressable, Platform, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { useMutation } from "@tanstack/react-query";
import { Colors, Spacing, Typography, BorderRadius } from "@/constants/theme";
import { Button } from "@/components/ui";
import { MascotAvatar } from "@/components/MascotAvatar";
import { RootStackParamList } from "@/navigation/types";
import { useAuth } from "@/contexts/AuthContext";
import { apiJson } from "@/lib/api";

type Nav = NativeStackNavigationProp<RootStackParamList>;

function confirmAsync(title: string, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (Platform.OS === "web") {
      resolve(window.confirm(`${title}\n${message}`));
    } else {
      Alert.alert(title, message, [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: "Delete", style: "destructive", onPress: () => resolve(true) },
      ]);
    }
  });
}

function MenuRow({ icon, label, subtitle, onPress, danger }: { icon: keyof typeof Feather.glyphMap; label: string; subtitle?: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={[styles.rowIcon, danger && { backgroundColor: "#FCE4E4" }]}>
        <Feather name={icon} size={16} color={danger ? Colors.danger : Colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, danger && { color: Colors.danger }]}>{label}</Text>
        {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      <Feather name="chevron-right" size={18} color={Colors.textMuted} />
    </Pressable>
  );
}

export default function ProfileScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { user, signOut, refreshUser } = useAuth();

  const deleteMutation = useMutation({
    mutationFn: () => apiJson("POST", "/api/auth/account/delete"),
    onSuccess: () => signOut(),
  });

  const handleDeleteAccount = async () => {
    const ok = await confirmAsync("Delete your account?", "This permanently removes your profile and can't be undone.");
    if (ok) deleteMutation.mutate();
  };

  if (!user) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top + Spacing.xxl }]}>
        <Text style={styles.notSignedIn}>You're not signed in.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingTop: insets.top + Spacing.lg, paddingBottom: insets.bottom + Spacing.xl, paddingHorizontal: Spacing.lg }}>
      <View style={styles.header}>
        <MascotAvatar seed={user.username} size={56} />
        <View>
          <Text style={styles.username}>@{user.username}</Text>
          <Text style={styles.contact}>{user.email ?? user.phoneNumber}</Text>
        </View>
      </View>

      <Text style={styles.sectionHeader}>Selling</Text>
      <View style={styles.section}>
        <MenuRow icon="credit-card" label="Payout setup" subtitle={user.stripeConnectPayoutsEnabled ? "Connected — ready to receive payouts" : "Set up Stripe to get paid"} onPress={() => navigation.navigate("SellerPayoutSetup")} />
        <MenuRow icon="shield" label="Identity verification" subtitle={user.identityVerificationStatus === "verified" ? "Verified" : "Required before selling"} onPress={() => navigation.navigate("IdentityVerification")} />
        <MenuRow icon="bell" label="New card alerts" subtitle="Choose which franchises to get notified about" onPress={() => navigation.navigate("NotificationFilters")} />
      </View>

      <Text style={styles.sectionHeader}>Shopping</Text>
      <View style={styles.section}>
        <MenuRow icon="package" label="My orders" onPress={() => navigation.navigate("Orders", {})} />
        <MenuRow icon="shopping-cart" label="Cart" onPress={() => navigation.navigate("Cart")} />
        <MenuRow icon="bell" label="Notifications" onPress={() => navigation.navigate("Notifications")} />
      </View>

      {user.isOwner ? (
        <>
          <Text style={styles.sectionHeader}>Owner</Text>
          <View style={styles.section}>
            <MenuRow icon="alert-octagon" label="Owner panel" subtitle="Review incident reports & users" onPress={() => navigation.navigate("OwnerPanel")} />
          </View>
        </>
      ) : null}

      <Text style={styles.sectionHeader}>Account</Text>
      <View style={styles.section}>
        <MenuRow icon="log-out" label="Sign out" onPress={() => signOut()} />
        <MenuRow icon="trash-2" label="Delete account" onPress={handleDeleteAccount} danger />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: "center", justifyContent: "center" },
  notSignedIn: { ...Typography.body, color: Colors.textSecondary },
  header: { flexDirection: "row", alignItems: "center", gap: Spacing.md, marginBottom: Spacing.lg },
  username: { ...Typography.h3, color: Colors.text },
  contact: { ...Typography.small, color: Colors.textSecondary },
  sectionHeader: { ...Typography.small, color: Colors.textSecondary, fontWeight: "700", marginTop: Spacing.lg, marginBottom: Spacing.xs, letterSpacing: 0.5 },
  section: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, padding: Spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  rowIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: "#FCE9E4", alignItems: "center", justifyContent: "center" },
  rowLabel: { ...Typography.bodyBold, color: Colors.text, fontSize: 14 },
  rowSubtitle: { ...Typography.small, color: Colors.textSecondary },
});
