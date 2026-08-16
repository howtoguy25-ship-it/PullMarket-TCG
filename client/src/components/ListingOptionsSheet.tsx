import React, { useState } from "react";
import { View, StyleSheet, Text, Modal, Pressable, Platform, Alert, Share } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import { Colors, Spacing, Typography, BorderRadius } from "@/constants/theme";
import { apiJson, describeApiError } from "@/lib/api";
import { invalidateListingsQueries } from "@/lib/queryClient";
import { RootStackParamList } from "@/navigation/types";
import { LISTING_REVISION_LIMIT } from "@shared/validation";

type Nav = NativeStackNavigationProp<RootStackParamList>;

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

function confirmAsync(title: string, message: string, confirmLabel: string): Promise<boolean> {
  if (Platform.OS === "web") return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: confirmLabel, style: "destructive", onPress: () => resolve(true) },
    ]);
  });
}

export interface ManagedListing {
  id: string;
  title: string;
  status: string;
  revisionCount: number;
}

/** A real bottom-sheet options menu for a seller's own listing: re-edit,
 * unlist/relist, delete, and share — each wired to the real listings API,
 * with a working X close button. Re-edit and unlist share one combined
 * revision budget (LISTING_REVISION_LIMIT total) enforced server-side; this
 * sheet just reflects that state so sellers aren't surprised by a 403. */
export function ListingOptionsSheet({ visible, listing, onClose }: { visible: boolean; listing: ManagedListing | null; onClose: () => void }) {
  const navigation = useNavigation<Nav>();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<"unlist" | "relist" | "delete" | null>(null);

  // listing can be null (nothing selected yet) — every hook below must still
  // run on every render regardless, so a fallback id keeps mutationFn/effects
  // stable instead of branching hook calls on listing's presence (that would
  // change the number of hooks called between renders, which React forbids).
  const listingId = listing?.id ?? "";

  const invalidateAll = () => {
    invalidateListingsQueries(queryClient);
  };

  const unlistMutation = useMutation({
    mutationFn: () => apiJson("POST", `/api/listings/${listingId}/unlist`),
    onSuccess: () => {
      invalidateAll();
      onClose();
    },
    onError: (err) => showAlert("Couldn't unlist", describeApiError(err)),
  });

  const relistMutation = useMutation({
    mutationFn: () => apiJson("POST", `/api/listings/${listingId}/relist`),
    onSuccess: () => {
      invalidateAll();
      onClose();
    },
    onError: (err) => showAlert("Couldn't relist", describeApiError(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiJson("DELETE", `/api/listings/${listingId}`),
    onSuccess: () => {
      invalidateAll();
      onClose();
    },
    onError: (err) => showAlert("Couldn't delete", describeApiError(err)),
  });

  if (!listing) return null;

  const revisionsLeft = Math.max(0, LISTING_REVISION_LIMIT - listing.revisionCount);
  const isUnlisted = listing.status === "unlisted";
  const isRemoved = listing.status === "removed";
  const isDeleted = listing.status === "deleted";
  // Removed and deleted listings both stay locked out of edit/boost/unlist —
  // a moderator removal shouldn't be workable-around by re-editing and
  // relisting. Delete is a separate, narrower question: it's a soft flip to
  // status "deleted" (see routes/listings.ts), which doesn't touch the
  // reports table, so a seller clearing a removed listing off their own
  // list can't erase moderation history — only an already-deleted listing
  // has nothing left to delete.
  const isLocked = isRemoved || isDeleted;

  const handleUnlist = async () => {
    const ok = await confirmAsync("Unlist this card?", "It'll come off the marketplace until you relist it. This uses 1 of your remaining edits/unlists.", "Unlist");
    if (ok) {
      setBusy("unlist");
      await unlistMutation.mutateAsync().finally(() => setBusy(null));
    }
  };

  const handleRelist = async () => {
    setBusy("relist");
    await relistMutation.mutateAsync().finally(() => setBusy(null));
  };

  const handleDelete = async () => {
    const ok = await confirmAsync("Delete this listing?", "This can't be undone — it'll be gone for good.", "Delete");
    if (ok) {
      setBusy("delete");
      await deleteMutation.mutateAsync().finally(() => setBusy(null));
    }
  };

  const handleEdit = () => {
    if (revisionsLeft <= 0) {
      showAlert("Edit limit reached", `You've used your ${LISTING_REVISION_LIMIT} edits/unlists for this listing. Create a new listing instead.`);
      return;
    }
    onClose();
    navigation.navigate("EditListing", { listingId: listing.id });
  };

  const handleBoost = () => {
    onClose();
    navigation.navigate("BoostListing", { listingId: listing.id });
  };

  const handleShare = async () => {
    const url = Linking.createURL(`listing/${listing.id}`);
    try {
      await Share.share(Platform.OS === "ios" ? { title: listing.title, url } : { title: listing.title, message: `Check out "${listing.title}" on PullMarket TCG\n${url}` });
    } catch {
      // User cancelled the share sheet — not an error.
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation?.()}>
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>
              {listing.title}
            </Text>
            <Pressable onPress={onClose} hitSlop={10} style={styles.closeButton} testID="options-sheet-close">
              <Feather name="x" size={20} color={Colors.text} />
            </Pressable>
          </View>

          {!isLocked ? (
            <Text style={styles.revisionNote}>
              {revisionsLeft > 0
                ? `${revisionsLeft} of ${LISTING_REVISION_LIMIT} edits/unlists remaining`
                : "No edits/unlists remaining — create a new listing to make changes"}
            </Text>
          ) : (
            <Text style={styles.revisionNote}>{isRemoved ? "This listing was removed by moderation — you can still delete it from your list." : "This listing was deleted."}</Text>
          )}

          {!isLocked ? (
            <>
              <Row testID="options-row-edit" icon="edit-2" label="Re-edit listing" onPress={handleEdit} disabled={revisionsLeft <= 0 || isUnlisted} color={Colors.secondary} />
              {!isUnlisted ? <Row testID="options-row-boost" icon="zap" label="Boost listing" onPress={handleBoost} color={Colors.goldDark} /> : null}
              {isUnlisted ? (
                <Row testID="options-row-relist" icon="upload" label="Relist" onPress={handleRelist} loading={busy === "relist"} color={Colors.success} />
              ) : (
                <Row testID="options-row-unlist" icon="eye-off" label="Unlist" onPress={handleUnlist} disabled={revisionsLeft <= 0} loading={busy === "unlist"} color="#92650B" />
              )}
            </>
          ) : null}
          <Row testID="options-row-share" icon="share-2" label="Share" onPress={handleShare} color={Colors.pokemon} />
          {!isDeleted ? <Row testID="options-row-delete" icon="trash-2" label="Delete" onPress={handleDelete} loading={busy === "delete"} danger /> : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Row({
  icon,
  label,
  onPress,
  disabled,
  loading,
  danger,
  color = Colors.primary,
  testID,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  danger?: boolean;
  color?: string;
  testID?: string;
}) {
  const iconColor = danger ? Colors.danger : color;
  return (
    <Pressable testID={testID} onPress={onPress} disabled={disabled || loading} style={[styles.row, (disabled || loading) && styles.rowDisabled]}>
      <View style={[styles.rowIcon, { backgroundColor: iconColor + "1F" }]}>
        <Feather name={icon} size={16} color={iconColor} />
      </View>
      <Text style={[styles.rowLabel, danger && styles.rowLabelDanger]}>{loading ? "Working…" : label}</Text>
      <Feather name="chevron-right" size={18} color={Colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: Colors.surface, borderTopLeftRadius: BorderRadius.xl, borderTopRightRadius: BorderRadius.xl, paddingBottom: Spacing.xl, paddingTop: Spacing.md },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm },
  title: { ...Typography.bodyBold, color: Colors.text, flex: 1, marginRight: Spacing.md },
  closeButton: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: Colors.surfaceAlt },
  revisionNote: { ...Typography.small, color: Colors.textSecondary, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  rowDisabled: { opacity: 0.4 },
  rowIcon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  rowLabel: { ...Typography.body, color: Colors.text, flex: 1, fontWeight: "600" },
  rowLabelDanger: { color: Colors.danger },
});
