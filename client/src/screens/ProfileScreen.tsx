import React, { useState } from "react";
import { View, StyleSheet, Text, ScrollView, Pressable, Platform, Alert, Switch, ActivityIndicator } from "react-native";
import Slider from "@react-native-community/slider";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useMutation } from "@tanstack/react-query";
import { Colors, Spacing, Typography, BorderRadius } from "@/constants/theme";
import { Button } from "@/components/ui";
import { Avatar } from "@/components/Avatar";
import { GalaxyHeader } from "@/components/GalaxyHeader";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { RootStackParamList } from "@/navigation/types";
import { useAuth } from "@/contexts/AuthContext";
import { useAmbientSound } from "@/contexts/AmbientSoundContext";
import { AMBIENT_SOUNDS } from "@/lib/ambientSounds";
import { apiJson, apiRequest, ApiError } from "@/lib/api";
import { appendImageField } from "@/lib/formDataImage";
import { isActivePro } from "@shared/validation";

type Nav = NativeStackNavigationProp<RootStackParamList>;

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

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

function MenuRow({ icon, label, subtitle, onPress }: { icon: keyof typeof Feather.glyphMap; label: string; subtitle?: string; onPress: () => void }) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={styles.rowIcon}>
        <Feather name={icon} size={16} color={Colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      <Feather name="chevron-right" size={18} color={Colors.textMuted} />
    </Pressable>
  );
}

function SoundRow({ id, label, description, active, previewing, onSelect, onPreview }: { id: string; label: string; description: string; active: boolean; previewing: boolean; onSelect: () => void; onPreview: () => void }) {
  return (
    <Pressable style={[styles.soundRow, active && styles.soundRowActive]} onPress={onSelect}>
      <View style={[styles.soundRadio, active && styles.soundRadioActive]}>{active ? <View style={styles.soundRadioDot} /> : null}</View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.soundLabel, active && styles.soundLabelActive]}>{label}</Text>
        <Text style={styles.soundDescription}>{description}</Text>
      </View>
      <Pressable style={[styles.previewButton, previewing && styles.previewButtonActive]} onPress={onPreview} hitSlop={8}>
        <Feather name={previewing ? "square" : "play"} size={previewing ? 13 : 15} color={previewing ? Colors.white : Colors.primary} />
      </Pressable>
    </Pressable>
  );
}

export default function ProfileScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { user, signOut, refreshUser } = useAuth();
  const { enabled, selectedId, volume, previewingId, setEnabled, selectSound, setVolume, preview } = useAmbientSound();
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const changeAvatar = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showAlert("Photo access needed", "Allow photo library access to set a profile picture.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (result.canceled || !result.assets[0]) return;

    setUploadingAvatar(true);
    try {
      const formData = new FormData();
      await appendImageField(formData, "avatar", result.assets[0].uri, "avatar.jpg");
      await apiRequest("POST", "/api/users/me/avatar", formData, true);
      await refreshUser();
    } catch (err) {
      showAlert("Couldn't update photo", err instanceof ApiError ? err.message : "Please try again.");
    } finally {
      setUploadingAvatar(false);
    }
  };

  const deleteMutation = useMutation({
    mutationFn: () => apiJson("POST", "/api/auth/account/delete"),
    onSuccess: async () => {
      await signOut();
      showAlert("Account deleted", "Your PullMarket account and profile have been permanently removed.");
    },
    onError: () => showAlert("Couldn't delete account", "Please try again."),
  });

  const handleDeleteAccount = async () => {
    const ok = await confirmAsync("Delete your account?", "This permanently removes your profile and can't be undone.", "Delete");
    if (ok) deleteMutation.mutate();
  };

  const handleSignOut = async () => {
    const ok = await confirmAsync("Sign out?", "You'll need to sign back in to use PullMarket again.", "Sign out");
    if (ok) await signOut();
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
      <GalaxyHeader variant="card" style={styles.header} starCount={16}>
        <Pressable onPress={changeAvatar} disabled={uploadingAvatar} style={styles.avatarWrap}>
          <Avatar avatarUrl={user.avatarUrl} seed={user.username} size={56} />
          <View style={styles.avatarBadge}>{uploadingAvatar ? <ActivityIndicator size="small" color={Colors.white} /> : <Feather name="camera" size={13} color={Colors.white} />}</View>
        </Pressable>
        <View>
          <View style={styles.usernameRow}>
            <Text style={styles.username}>@{user.username}</Text>
            {isActivePro(user) ? <VerifiedBadge size={15} /> : null}
          </View>
          <Text style={styles.contact}>{user.email ?? user.phoneNumber}</Text>
          <Text style={styles.changePhoto}>Tap photo to change</Text>
        </View>
      </GalaxyHeader>

      <Pressable style={styles.proBanner} onPress={() => navigation.navigate("Subscription")}>
        <View style={styles.proBannerIcon}>
          <Feather name="star" size={18} color={Colors.white} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.proBannerTitle}>{isActivePro(user) ? "PullMarket Pro" : "Go Pro"}</Text>
          <Text style={styles.proBannerSubtitle}>{isActivePro(user) ? "Followers, verified tick, listing boost & search recognition" : "Followers, verified tick, listing boost & search recognition — $19.99/mo"}</Text>
        </View>
        <Feather name="chevron-right" size={18} color={Colors.textMuted} />
      </Pressable>

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

      <Text style={styles.sectionHeader}>Privacy</Text>
      <View style={styles.section}>
        <MenuRow icon="eye-off" label="Read receipts" subtitle="Control who sees when you've read their messages" onPress={() => navigation.navigate("ReadReceiptSettings")} />
        <MenuRow icon="user-x" label="Blocked users" subtitle="People you've blocked from messaging or friend-requesting you" onPress={() => navigation.navigate("BlockedUsers")} />
      </View>

      {user.isOwner ? (
        <>
          <Text style={styles.sectionHeader}>Owner</Text>
          <View style={styles.section}>
            <MenuRow icon="alert-octagon" label="Owner panel" subtitle="Review incident reports & users" onPress={() => navigation.navigate("OwnerPanel")} />
          </View>
        </>
      ) : null}

      <Text style={styles.sectionHeader}>Ambient Sound</Text>
      <View style={styles.section}>
        <View style={styles.soundToggleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>Play while browsing</Text>
            <Text style={styles.rowSubtitle}>Original instrumental music, looped softly while you browse</Text>
          </View>
          <Switch value={enabled} onValueChange={setEnabled} trackColor={{ false: Colors.border, true: Colors.primary }} thumbColor={Colors.white} />
        </View>

        <View style={styles.soundList}>
          {AMBIENT_SOUNDS.map((s) => (
            <SoundRow
              key={s.id}
              id={s.id}
              label={s.label}
              description={s.description}
              active={selectedId === s.id}
              previewing={previewingId === s.id}
              onSelect={() => selectSound(s.id)}
              onPreview={() => preview(s.id)}
            />
          ))}
        </View>

        <View style={styles.volumeRow}>
          <Feather name="volume-1" size={16} color={Colors.textSecondary} />
          <Slider
            style={{ flex: 1 }}
            minimumValue={0}
            maximumValue={1}
            value={volume}
            onValueChange={setVolume}
            minimumTrackTintColor={Colors.primary}
            maximumTrackTintColor={Colors.border}
            thumbTintColor={Colors.primary}
          />
          <Feather name="volume-2" size={16} color={Colors.textSecondary} />
        </View>
      </View>

      <Text style={styles.sectionHeader}>Account</Text>
      <View style={styles.accountActions}>
        <Button title="Sign out" variant="outline" icon={<Feather name="log-out" size={17} color={Colors.primary} />} onPress={handleSignOut} style={styles.accountButton} />
        <Button title="Delete account" variant="danger" icon={<Feather name="trash-2" size={17} color={Colors.white} />} onPress={handleDeleteAccount} loading={deleteMutation.isPending} style={styles.accountButton} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: "center", justifyContent: "center" },
  notSignedIn: { ...Typography.body, color: Colors.textSecondary },
  header: { flexDirection: "row", alignItems: "center", gap: Spacing.md, marginBottom: Spacing.lg, padding: Spacing.lg },
  avatarWrap: { position: "relative" },
  avatarBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#1C1040",
  },
  usernameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  username: { ...Typography.h3, color: Colors.white },
  contact: { ...Typography.small, color: "rgba(255,255,255,0.7)" },
  changePhoto: { ...Typography.small, color: Colors.gold, marginTop: 2, fontSize: 11 },
  proBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.gold + "55",
    padding: Spacing.md,
    marginTop: Spacing.md,
  },
  proBannerIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.gold, alignItems: "center", justifyContent: "center" },
  proBannerTitle: { ...Typography.bodyBold, color: Colors.text },
  proBannerSubtitle: { ...Typography.small, color: Colors.textSecondary, marginTop: 1 },
  sectionHeader: { ...Typography.small, color: Colors.textSecondary, fontWeight: "700", marginTop: Spacing.lg, marginBottom: Spacing.xs, letterSpacing: 0.5 },
  section: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, padding: Spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  rowIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: "#FCE9E4", alignItems: "center", justifyContent: "center" },
  rowLabel: { ...Typography.bodyBold, color: Colors.text, fontSize: 14 },
  rowSubtitle: { ...Typography.small, color: Colors.textSecondary },
  soundToggleRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, padding: Spacing.md },
  soundList: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  soundRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, padding: Spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  soundRowActive: { backgroundColor: Colors.surfaceAlt },
  soundRadio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: Colors.border, alignItems: "center", justifyContent: "center" },
  soundRadioActive: { borderColor: Colors.primary },
  soundRadioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.primary },
  soundLabel: { ...Typography.bodyBold, color: Colors.text, fontSize: 14 },
  soundLabelActive: { color: Colors.primary },
  soundDescription: { ...Typography.small, color: Colors.textSecondary },
  previewButton: { width: 32, height: 32, borderRadius: 16, backgroundColor: "#FCE9E4", alignItems: "center", justifyContent: "center" },
  previewButtonActive: { backgroundColor: Colors.primary },
  volumeRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, padding: Spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  accountActions: { gap: Spacing.sm },
  accountButton: { width: "100%" },
});
