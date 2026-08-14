import React, { useEffect, useState } from "react";
import { View, StyleSheet, Text, ScrollView, Pressable, Platform, Alert, Switch, ActivityIndicator } from "react-native";
import Slider from "@react-native-community/slider";
import * as Linking from "expo-linking";
import Constants from "expo-constants";
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
import { AppThemeBackground } from "@/components/AppThemeBackground";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { RootStackParamList } from "@/navigation/types";
import { useAuth } from "@/contexts/AuthContext";
import { useAmbientSound } from "@/contexts/AmbientSoundContext";
import { useRingtone } from "@/contexts/RingtoneContext";
import { useAppTheme } from "@/contexts/AppThemeContext";
import { AMBIENT_SOUNDS } from "@/lib/ambientSounds";
import { RINGTONES } from "@/lib/ringtones";
import { APP_THEMES } from "@/lib/appThemes";
import { LinearGradient } from "expo-linear-gradient";
import { apiJson, apiRequest, ApiError, getApiUrl } from "@/lib/api";
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

// Every section gets its own color from the app's real brand palette —
// rows within a section share it (icon tint + a left-edge "barrier" stripe
// on the section card), so the whole screen reads as clearly grouped color
// zones instead of one long list of identical pink icons.
const SECTION_COLORS = {
  selling: Colors.goldDark,
  shopping: Colors.primary,
  privacy: Colors.secondary,
  support: Colors.success,
  owner: Colors.danger,
  appBackground: "#7C3AED",
  ambientSound: Colors.pokemon,
  ringtone: Colors.onePiece,
} as const;

function SectionHeader({ label, color }: { label: string; color: string }) {
  return (
    <View style={styles.sectionHeaderRow}>
      <View style={[styles.sectionDot, { backgroundColor: color }]} />
      <Text style={styles.sectionHeader}>{label}</Text>
    </View>
  );
}

function MenuRow({ icon, label, subtitle, onPress, color = Colors.primary }: { icon: keyof typeof Feather.glyphMap; label: string; subtitle?: string; onPress: () => void; color?: string }) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={[styles.rowIcon, { backgroundColor: color + "1F" }]}>
        <Feather name={icon} size={16} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      <Feather name="chevron-right" size={18} color={Colors.textMuted} />
    </Pressable>
  );
}

function ThemeSwatchRow({ label, description, colors, active, onSelect }: { label: string; description: string; colors: [string, string]; active: boolean; onSelect: () => void }) {
  return (
    <Pressable style={[styles.soundRow, active && styles.soundRowActive]} onPress={onSelect}>
      <View style={[styles.soundRadio, active && styles.soundRadioActive]}>{active ? <View style={styles.soundRadioDot} /> : null}</View>
      <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={styles.themeSwatch} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.soundLabel, active && styles.soundLabelActive]}>{label}</Text>
        <Text style={styles.soundDescription}>{description}</Text>
      </View>
    </Pressable>
  );
}

function SoundRow({
  id,
  label,
  description,
  active,
  previewing,
  onSelect,
  onPreview,
  color = Colors.primary,
}: {
  id: string;
  label: string;
  description: string;
  active: boolean;
  previewing: boolean;
  onSelect: () => void;
  onPreview: () => void;
  color?: string;
}) {
  return (
    <Pressable style={[styles.soundRow, active && { backgroundColor: color + "14" }]} onPress={onSelect}>
      <View style={[styles.soundRadio, active && { borderColor: color }]}>{active ? <View style={[styles.soundRadioDot, { backgroundColor: color }]} /> : null}</View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.soundLabel, active && { color }]}>{label}</Text>
        <Text style={styles.soundDescription}>{description}</Text>
      </View>
      <Pressable style={[styles.previewButton, { backgroundColor: color + "1F" }, previewing && { backgroundColor: color }]} onPress={onPreview} hitSlop={8}>
        <Feather name={previewing ? "square" : "play"} size={previewing ? 13 : 15} color={previewing ? Colors.white : color} />
      </Pressable>
    </Pressable>
  );
}

export default function ProfileScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { user, signOut, refreshUser } = useAuth();
  const { enabled, selectedId, volume, previewingId, setEnabled, selectSound, setVolume, preview } = useAmbientSound();
  const { selectedId: ringtoneSelectedId, previewingId: ringtonePreviewingId, selectRingtone, preview: previewRingtone } = useRingtone();
  const { selectedId: appThemeId, selectTheme } = useAppTheme();
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<string | null>(null);

  // Surfaces exactly which OTA update this device is actually running —
  // when diagnosing "I published a fix but it's not showing up" reports,
  // this settles in one glance whether the device has picked up the
  // latest JS or is still running something older/embedded, instead of
  // guessing from behavior alone.
  useEffect(() => {
    if (Platform.OS === "web") return;
    void (async () => {
      try {
        const Updates = await import("expo-updates");
        const shortId = Updates.updateId ? Updates.updateId.slice(0, 8) : "embedded";
        const published = Updates.createdAt ? Updates.createdAt.toLocaleString() : "n/a";
        setUpdateInfo(`${shortId} · ${Updates.channel || "none"} · ${published}`);
      } catch {
        setUpdateInfo("unavailable");
      }
    })();
  }, []);

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
    <View style={styles.container}>
      <AppThemeBackground />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + Spacing.lg, paddingBottom: insets.bottom + Spacing.xl, paddingHorizontal: Spacing.lg }}>
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
          <Feather name="star" size={18} color={Colors.goldDark} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.proBannerTitle}>{isActivePro(user) ? "PullMarket Pro" : "Go Pro"}</Text>
          <Text style={styles.proBannerSubtitle}>{isActivePro(user) ? "Followers, verified tick, listing boost & search recognition" : "Followers, verified tick, listing boost & search recognition — $19.99/mo"}</Text>
        </View>
        <Feather name="chevron-right" size={18} color={Colors.textMuted} />
      </Pressable>

      <SectionHeader label="Selling" color={SECTION_COLORS.selling} />
      <View style={[styles.section, styles.sectionBarrier, { borderLeftColor: SECTION_COLORS.selling }]}>
        <MenuRow icon="credit-card" color={SECTION_COLORS.selling} label="Payout setup" subtitle={user.stripeConnectPayoutsEnabled ? "Connected — ready to receive payouts" : "Set up Stripe to get paid"} onPress={() => navigation.navigate("SellerPayoutSetup")} />
        <MenuRow icon="shield" color={SECTION_COLORS.selling} label="Identity verification" subtitle={user.identityVerificationStatus === "verified" ? "Verified" : "Required before selling"} onPress={() => navigation.navigate("IdentityVerification")} />
        <MenuRow icon="bell" color={SECTION_COLORS.selling} label="New card alerts" subtitle="Choose which franchises to get notified about" onPress={() => navigation.navigate("NotificationFilters")} />
      </View>

      <SectionHeader label="Shopping" color={SECTION_COLORS.shopping} />
      <View style={[styles.section, styles.sectionBarrier, { borderLeftColor: SECTION_COLORS.shopping }]}>
        <MenuRow icon="package" color={SECTION_COLORS.shopping} label="My orders" onPress={() => navigation.navigate("Orders", {})} />
        <MenuRow icon="shopping-cart" color={SECTION_COLORS.shopping} label="Cart" onPress={() => navigation.navigate("Cart")} />
        <MenuRow icon="bell" color={SECTION_COLORS.shopping} label="Notifications" onPress={() => navigation.navigate("Notifications")} />
        <MenuRow icon="slash" color={SECTION_COLORS.shopping} label="Remove Ads" subtitle="$39.99 one-time — removes all ads" onPress={() => navigation.navigate("RemoveAds")} />
      </View>

      <SectionHeader label="Privacy" color={SECTION_COLORS.privacy} />
      <View style={[styles.section, styles.sectionBarrier, { borderLeftColor: SECTION_COLORS.privacy }]}>
        <MenuRow icon="eye-off" color={SECTION_COLORS.privacy} label="Read receipts" subtitle="Control who sees when you've read their messages" onPress={() => navigation.navigate("ReadReceiptSettings")} />
        <MenuRow icon="user-x" color={SECTION_COLORS.privacy} label="Blocked users" subtitle="People you've blocked from messaging or friend-requesting you" onPress={() => navigation.navigate("BlockedUsers")} />
      </View>

      <SectionHeader label="Support" color={SECTION_COLORS.support} />
      <View style={[styles.section, styles.sectionBarrier, { borderLeftColor: SECTION_COLORS.support }]}>
        <MenuRow icon="message-circle" color={SECTION_COLORS.support} label="AI Help Assistant" subtitle="Ask how to do anything in the app" onPress={() => navigation.navigate("HelpChat")} />
        <MenuRow icon="shield" color={SECTION_COLORS.support} label="Privacy Policy" onPress={() => Linking.openURL(`${getApiUrl()}/privacy`)} />
        <MenuRow icon="life-buoy" color={SECTION_COLORS.support} label="Support" onPress={() => Linking.openURL(`${getApiUrl()}/support`)} />
      </View>

      {user.isOwner ? (
        <>
          <SectionHeader label="Owner" color={SECTION_COLORS.owner} />
          <View style={[styles.section, styles.sectionBarrier, { borderLeftColor: SECTION_COLORS.owner }]}>
            <MenuRow icon="alert-octagon" color={SECTION_COLORS.owner} label="Owner panel" subtitle="Review incident reports & users" onPress={() => navigation.navigate("OwnerPanel")} />
          </View>
        </>
      ) : null}

      <SectionHeader label="App Background" color={SECTION_COLORS.appBackground} />
      <View style={[styles.section, styles.sectionBarrier, { borderLeftColor: SECTION_COLORS.appBackground }]}>
        <Text style={styles.ringtoneHint}>Applies across Search, Chat, Favorites, Profile, and listing pages</Text>
        <View style={styles.soundList}>
          {APP_THEMES.map((t) => (
            <ThemeSwatchRow key={t.id} label={t.label} description={t.description} colors={t.colors} active={appThemeId === t.id} onSelect={() => selectTheme(t.id)} />
          ))}
        </View>
      </View>

      <SectionHeader label="Ambient Sound" color={SECTION_COLORS.ambientSound} />
      <View style={[styles.section, styles.sectionBarrier, { borderLeftColor: SECTION_COLORS.ambientSound }]}>
        <View style={styles.soundToggleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>Play while browsing</Text>
            <Text style={styles.rowSubtitle}>Original instrumental music, looped softly while you browse</Text>
          </View>
          <Switch value={enabled} onValueChange={setEnabled} trackColor={{ false: Colors.border, true: SECTION_COLORS.ambientSound }} thumbColor={Colors.white} />
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
              color={SECTION_COLORS.ambientSound}
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
            minimumTrackTintColor={SECTION_COLORS.ambientSound}
            maximumTrackTintColor={Colors.border}
            thumbTintColor={SECTION_COLORS.ambientSound}
          />
          <Feather name="volume-2" size={16} color={Colors.textSecondary} />
        </View>
      </View>

      <SectionHeader label="Call Ringtone" color={SECTION_COLORS.ringtone} />
      <View style={[styles.section, styles.sectionBarrier, { borderLeftColor: SECTION_COLORS.ringtone }]}>
        <Text style={styles.ringtoneHint}>Plays on your phone when someone calls you</Text>
        <View style={styles.soundList}>
          {RINGTONES.map((r) => (
            <SoundRow
              key={r.id}
              id={r.id}
              label={r.label}
              description={r.description}
              active={ringtoneSelectedId === r.id}
              previewing={ringtonePreviewingId === r.id}
              onSelect={() => selectRingtone(r.id)}
              onPreview={() => previewRingtone(r.id)}
              color={SECTION_COLORS.ringtone}
            />
          ))}
        </View>
      </View>

      <SectionHeader label="Account" color={Colors.textSecondary} />
      <View style={styles.accountActions}>
        <Button title="Sign out" variant="outline" icon={<Feather name="log-out" size={17} color={Colors.primary} />} onPress={handleSignOut} style={styles.accountButton} />
        <Button title="Delete account" variant="danger" icon={<Feather name="trash-2" size={17} color={Colors.white} />} onPress={handleDeleteAccount} loading={deleteMutation.isPending} style={styles.accountButton} />
      </View>

      {updateInfo ? (
        <Text style={styles.versionText}>
          v{Constants.expoConfig?.version ?? "?"} ({Constants.expoConfig?.ios?.buildNumber ?? Constants.expoConfig?.android?.versionCode ?? "?"}) · {updateInfo}
        </Text>
      ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, overflow: "hidden" },
  themeSwatch: { width: 34, height: 34, borderRadius: BorderRadius.sm, borderWidth: 1, borderColor: Colors.border },
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
  proBannerIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.gold + "26", alignItems: "center", justifyContent: "center" },
  proBannerTitle: { ...Typography.bodyBold, color: Colors.text },
  proBannerSubtitle: { ...Typography.small, color: Colors.textSecondary, marginTop: 1 },
  sectionHeaderRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: Spacing.lg, marginBottom: Spacing.xs },
  sectionDot: { width: 7, height: 7, borderRadius: 4 },
  sectionHeader: { ...Typography.small, color: Colors.textSecondary, fontWeight: "700", letterSpacing: 0.5 },
  section: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, overflow: "hidden" },
  sectionBarrier: { borderLeftWidth: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, padding: Spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  rowIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: "#FCE9E4", alignItems: "center", justifyContent: "center" },
  rowLabel: { ...Typography.bodyBold, color: Colors.text, fontSize: 14 },
  rowSubtitle: { ...Typography.small, color: Colors.textSecondary },
  soundToggleRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, padding: Spacing.md },
  soundList: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  ringtoneHint: { ...Typography.small, color: Colors.textSecondary, padding: Spacing.md, paddingBottom: 0 },
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
  versionText: { ...Typography.small, color: Colors.textMuted, textAlign: "center", marginTop: Spacing.lg, fontSize: 11 },
});
