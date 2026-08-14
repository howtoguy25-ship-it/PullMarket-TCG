import React, { useEffect, useState } from "react";
import { View, StyleSheet, Text, ScrollView, TextInput, Pressable, Platform, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Colors, Spacing, Typography, BorderRadius } from "@/constants/theme";
import { Button } from "@/components/ui";
import { RootStackParamList } from "@/navigation/types";
import { apiJson, describeApiError } from "@/lib/api";
import { CONDITION_LABELS, titleMentionsFranchise, LISTING_REVISION_LIMIT } from "@shared/validation";

type Nav = NativeStackNavigationProp<RootStackParamList, "EditListing">;
type Rt = RouteProp<RootStackParamList, "EditListing">;
const CONDITIONS = Object.entries(CONDITION_LABELS);

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

interface EditableListing {
  id: string;
  title: string;
  description: string;
  priceCents: number;
  condition: string;
  quantityTotal: number;
  revisionCount: number;
}

export default function EditListingScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const { listingId } = route.params;
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const { data: listing, isLoading } = useQuery<EditableListing>({ queryKey: [`/api/listings/${listingId}`] });

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [condition, setCondition] = useState("brand_new");
  const [quantity, setQuantity] = useState(1);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (listing && !hydrated) {
      setTitle(listing.title);
      setDescription(listing.description);
      setPrice((listing.priceCents / 100).toFixed(2));
      setCondition(listing.condition);
      setQuantity(listing.quantityTotal);
      setHydrated(true);
    }
  }, [listing, hydrated]);

  const franchiseOk = titleMentionsFranchise(title);
  const revisionsLeft = listing ? Math.max(0, LISTING_REVISION_LIMIT - listing.revisionCount) : 0;

  const saveMutation = useMutation({
    mutationFn: () =>
      apiJson("PATCH", `/api/listings/${listingId}`, {
        title: title.trim(),
        description: description.trim(),
        priceCents: Math.round(parseFloat(price || "0") * 100),
        condition,
        quantityTotal: quantity,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [`/api/listings/${listingId}`] }),
        queryClient.invalidateQueries({ queryKey: ["/api/listings/mine"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/listings"] }),
      ]);
      showAlert("Saved", "Your listing has been updated.");
      navigation.goBack();
    },
    onError: (err) => showAlert("Couldn't save changes", describeApiError(err)),
  });

  const canSubmit = title.trim().length >= 3 && franchiseOk && parseFloat(price || "0") >= 0.5 && revisionsLeft > 0;

  if (isLoading || !listing) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: Spacing.lg, paddingBottom: insets.bottom + Spacing.xxl }}>
      <View style={styles.limitBanner}>
        <Feather name="info" size={15} color={Colors.textSecondary} />
        <Text style={styles.limitBannerText}>
          {revisionsLeft > 0
            ? `${revisionsLeft} of ${LISTING_REVISION_LIMIT} edits/unlists remaining for this listing.`
            : "You've used all your edits/unlists for this listing — create a new listing for further changes."}
        </Text>
      </View>

      <Text style={styles.label}>Title</Text>
      <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Card title" placeholderTextColor={Colors.textMuted} />
      {title.length > 0 && !franchiseOk ? <Text style={styles.errorText}>Title must mention "Pokémon" or "One Piece" so buyers can find it.</Text> : null}

      <Text style={styles.label}>Description</Text>
      <TextInput
        style={[styles.input, styles.textArea]}
        value={description}
        onChangeText={setDescription}
        multiline
        numberOfLines={4}
        placeholder="Set, rarity, any flaws…"
        placeholderTextColor={Colors.textMuted}
      />

      <Text style={styles.label}>Price</Text>
      <View style={styles.priceRow}>
        <Text style={styles.dollarSign}>$</Text>
        <TextInput style={styles.priceInput} value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={Colors.textMuted} />
      </View>

      <Text style={styles.label}>Condition</Text>
      <View style={styles.conditionRow}>
        {CONDITIONS.map(([key, label]) => (
          <Pressable key={key} onPress={() => setCondition(key)} style={[styles.conditionChip, condition === key && styles.conditionChipActive]}>
            <Text style={[styles.conditionChipText, condition === key && styles.conditionChipTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Quantity</Text>
      <View style={styles.stepper}>
        <Pressable onPress={() => setQuantity((q) => Math.max(1, q - 1))} style={styles.stepperButton}>
          <Feather name="minus" size={18} color={Colors.text} />
        </Pressable>
        <Text style={styles.stepperValue}>{quantity}</Text>
        <Pressable onPress={() => setQuantity((q) => Math.min(999, q + 1))} style={styles.stepperButton}>
          <Feather name="plus" size={18} color={Colors.text} />
        </Pressable>
      </View>

      <Button title="Save changes" onPress={() => saveMutation.mutate()} loading={saveMutation.isPending} disabled={!canSubmit} style={{ marginTop: Spacing.xl }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: "center", justifyContent: "center" },
  loadingText: { color: Colors.textSecondary, ...Typography.body },
  limitBanner: { flexDirection: "row", gap: Spacing.sm, alignItems: "flex-start", backgroundColor: Colors.surfaceAlt, padding: Spacing.md, borderRadius: BorderRadius.md, marginBottom: Spacing.lg },
  limitBannerText: { flex: 1, ...Typography.small, color: Colors.textSecondary, lineHeight: 18 },
  label: { ...Typography.bodyBold, color: Colors.text, marginBottom: Spacing.xs, marginTop: Spacing.md },
  input: { borderWidth: 1.5, borderColor: Colors.border, borderRadius: BorderRadius.lg, paddingHorizontal: Spacing.md, paddingVertical: 12, backgroundColor: Colors.surface, fontSize: 15, color: Colors.text },
  textArea: { minHeight: 90, textAlignVertical: "top" },
  errorText: { ...Typography.small, color: Colors.danger, marginTop: 6 },
  priceRow: { flexDirection: "row", alignItems: "center", borderWidth: 1.5, borderColor: Colors.border, borderRadius: BorderRadius.lg, backgroundColor: Colors.surface, paddingHorizontal: Spacing.md },
  dollarSign: { ...Typography.h3, color: Colors.textSecondary },
  priceInput: { flex: 1, paddingVertical: 12, paddingHorizontal: Spacing.xs, fontSize: 18, color: Colors.text, borderWidth: 0 },
  conditionRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  conditionChip: { paddingHorizontal: Spacing.md, paddingVertical: 9, borderRadius: BorderRadius.pill, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.surface },
  conditionChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  conditionChipText: { ...Typography.small, color: Colors.text, fontWeight: "700" },
  conditionChipTextActive: { color: Colors.white },
  stepper: { flexDirection: "row", alignItems: "center", gap: Spacing.lg, alignSelf: "flex-start" },
  stepperButton: { width: 38, height: 38, borderRadius: 19, backgroundColor: Colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
  stepperValue: { ...Typography.h3, color: Colors.text, minWidth: 30, textAlign: "center" },
});
