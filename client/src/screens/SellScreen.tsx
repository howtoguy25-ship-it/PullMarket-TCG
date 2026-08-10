import React, { useEffect, useState } from "react";
import { View, StyleSheet, Text, ScrollView, TextInput, Pressable, Image, Platform, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as ImagePicker from "expo-image-picker";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from "react-native-reanimated";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Colors, Spacing, Typography, BorderRadius, Shadow } from "@/constants/theme";
import { Button } from "@/components/ui";
import { CardScannerModal } from "@/components/CardScannerModal";
import { RootStackParamList } from "@/navigation/types";
import { apiRequest, ApiError } from "@/lib/api";
import { appendImageToFormData } from "@/lib/formDataImage";
import { CONDITION_LABELS, titleMentionsFranchise, SHIPPING_DEADLINE_BUSINESS_DAYS } from "@shared/validation";
import { useAuth } from "@/contexts/AuthContext";

type Nav = NativeStackNavigationProp<RootStackParamList>;
type FeatherIcon = React.ComponentProps<typeof Feather>["name"];
const MAX_IMAGES = 6;
const CONDITIONS = Object.entries(CONDITION_LABELS);
const FRANCHISE_OPTIONS: { key: "pokemon" | "one_piece"; label: string; color: string }[] = [
  { key: "pokemon", label: "Pokémon", color: Colors.pokemon },
  { key: "one_piece", label: "One Piece", color: Colors.onePiece },
];

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

function FranchiseOptionCard({ label, color, icon, active, onPress }: { label: string; color: string; icon: FeatherIcon; active: boolean; onPress: () => void }) {
  const tilt = useSharedValue(0);

  useEffect(() => {
    // A quick tilt-and-settle "pop" every time this option becomes selected —
    // not just a color swap — so picking a franchise feels like a real choice.
    tilt.value = active ? withSpring(1, { damping: 6, stiffness: 180 }) : withSpring(0, { damping: 10, stiffness: 200 });
  }, [active]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: 1 + tilt.value * 0.06 },
      { rotate: `${tilt.value * -3}deg` },
    ],
  }));

  return (
    <Animated.View style={[styles.franchiseCard, { borderColor: color }, active && { backgroundColor: color }, animatedStyle, active && Shadow.card]}>
      <Pressable onPress={onPress} style={styles.franchiseCardPressable} hitSlop={4}>
        <Feather name={icon} size={22} color={active ? Colors.white : color} />
        <Text style={[styles.franchiseCardText, { color: active ? Colors.white : color }]}>{label}</Text>
        {active ? (
          <View style={styles.franchiseCheck}>
            <Feather name="check-circle" size={14} color={Colors.white} />
          </View>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

function Section({ icon, title, helper, children }: { icon: FeatherIcon; title: string; helper?: string; children: React.ReactNode }) {
  return (
    <View style={[styles.section, Shadow.card]}>
      <View style={styles.sectionHeaderRow}>
        <View style={styles.sectionIconBadge}>
          <Feather name={icon} size={14} color={Colors.primary} />
        </View>
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {helper ? <Text style={styles.helper}>{helper}</Text> : null}
      <View style={{ marginTop: Spacing.sm }}>{children}</View>
    </View>
  );
}

export default function SellScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [images, setImages] = useState<string[]>([]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [franchise, setFranchise] = useState<"pokemon" | "one_piece" | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [condition, setCondition] = useState<string>("brand_new");
  const [quantity, setQuantity] = useState(1);

  const franchiseOk = titleMentionsFranchise(title);

  const submitMutation = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      formData.append("title", title.trim());
      formData.append("description", description.trim());
      formData.append("priceCents", String(Math.round(parseFloat(price || "0") * 100)));
      formData.append("condition", condition);
      formData.append("quantityTotal", String(quantity));
      for (let i = 0; i < images.length; i++) {
        await appendImageToFormData(formData, images[i], i);
      }
      return apiRequest("POST", "/api/listings", formData, true);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/listings"] });
      showAlert("Listed!", "Your card is now live on the marketplace.");
      setImages([]);
      setFranchise(null);
      setTitle("");
      setDescription("");
      setPrice("");
      setCondition("brand_new");
      setQuantity(1);
      navigation.navigate("MainTabs");
    },
    onError: (err) => showAlert("Couldn't list this card", err instanceof ApiError ? err.message : "Please try again."),
  });

  const addFromLibrary = async () => {
    const remaining = MAX_IMAGES - images.length;
    if (remaining <= 0) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showAlert("Photo access needed", "Allow photo library access to upload card images.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 0.85,
    });
    if (!result.canceled) {
      setImages((prev) => [...prev, ...result.assets.map((a) => a.uri)].slice(0, MAX_IMAGES));
    }
  };

  const handleScanCapture = (uri: string) => {
    setImages((prev) => (prev.length < MAX_IMAGES ? [...prev, uri] : prev));
    setScannerOpen(false);
  };

  const removeImage = (index: number) => setImages((prev) => prev.filter((_, i) => i !== index));
  const moveImage = (index: number, direction: -1 | 1) => {
    setImages((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const canSubmit = images.length > 0 && !!franchise && title.trim().length >= 3 && franchiseOk && parseFloat(price || "0") >= 0.5;

  if (!user) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top + Spacing.xxl }]}>
        <Feather name="lock" size={32} color={Colors.textMuted} />
        <Text style={styles.emptyText}>Sign in to list a card for sale.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xxl }}>
      <LinearGradient colors={["#1C1040", "#3B1E6B", "#DB2777"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.header, { paddingTop: insets.top + Spacing.md }]}>
        <Text style={styles.screenTitle}>Sell a Card</Text>
        <Text style={styles.headerSubtitle}>List a Pokémon or One Piece card in minutes</Text>
      </LinearGradient>

      <View style={styles.body}>
        <Section icon="tag" title="What are you selling?" helper="Pick the franchise this card belongs to.">
          <View style={styles.franchiseRow}>
            {FRANCHISE_OPTIONS.map((opt) => (
              <FranchiseOptionCard
                key={opt.key}
                label={opt.label}
                color={opt.color}
                icon={opt.key === "pokemon" ? "zap" : "anchor"}
                active={franchise === opt.key}
                onPress={() => setFranchise(opt.key)}
              />
            ))}
          </View>
        </Section>

        <Section icon="camera" title={`Photos (${images.length}/${MAX_IMAGES})`} helper="Scan with the camera or upload from your library — buyers swipe through them on the listing page.">
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {images.map((uri, i) => (
              <View key={uri + i} style={styles.thumbWrap}>
                <Image source={{ uri }} style={styles.thumb} />
                <Pressable style={styles.removeThumb} onPress={() => removeImage(i)} hitSlop={6}>
                  <Feather name="x" size={12} color={Colors.white} />
                </Pressable>
                <View style={styles.reorderRow}>
                  <Pressable onPress={() => moveImage(i, -1)} hitSlop={6} disabled={i === 0}>
                    <Feather name="arrow-left" size={14} color={i === 0 ? Colors.textMuted : Colors.text} />
                  </Pressable>
                  <Pressable onPress={() => moveImage(i, 1)} hitSlop={6} disabled={i === images.length - 1}>
                    <Feather name="arrow-right" size={14} color={i === images.length - 1 ? Colors.textMuted : Colors.text} />
                  </Pressable>
                </View>
              </View>
            ))}
            {images.length < MAX_IMAGES ? (
              <View style={styles.addButtons}>
                <Pressable style={styles.addTile} onPress={() => setScannerOpen(true)}>
                  <Feather name="camera" size={22} color={Colors.primary} />
                  <Text style={styles.addTileText}>Scan</Text>
                </Pressable>
                <Pressable style={styles.addTile} onPress={addFromLibrary}>
                  <Feather name="upload" size={22} color={Colors.primary} />
                  <Text style={styles.addTileText}>Upload</Text>
                </Pressable>
              </View>
            ) : null}
          </ScrollView>
        </Section>

        <Section icon="type" title="Title">
          <TextInput style={styles.input} placeholder='e.g. "Charizard VMAX Pokémon Rainbow Rare"' placeholderTextColor={Colors.textMuted} value={title} onChangeText={setTitle} />
          {title.length > 0 && !franchiseOk ? <Text style={styles.errorText}>Title must mention "Pokémon" or "One Piece" so buyers can find it.</Text> : null}
        </Section>

        <Section icon="align-left" title="Description">
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Set, rarity, any flaws, why it's special…"
            placeholderTextColor={Colors.textMuted}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={4}
          />
        </Section>

        <Section icon="dollar-sign" title="Price">
          <View style={styles.priceInputRow}>
            <Text style={styles.dollarSign}>$</Text>
            <TextInput style={styles.priceInput} placeholder="0.00" placeholderTextColor={Colors.textMuted} value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
          </View>
        </Section>

        <Section icon="award" title="Condition">
          <View style={styles.conditionRow}>
            {CONDITIONS.map(([key, label]) => (
              <Pressable key={key} onPress={() => setCondition(key)} style={[styles.conditionChip, condition === key && styles.conditionChipActive]}>
                <Text style={[styles.conditionChipText, condition === key && { color: Colors.white }]}>{label}</Text>
              </Pressable>
            ))}
          </View>
        </Section>

        <Section icon="box" title="Quantity">
          <View style={styles.stepper}>
            <Pressable onPress={() => setQuantity((q) => Math.max(1, q - 1))} style={styles.stepperButton}>
              <Feather name="minus" size={18} color={Colors.text} />
            </Pressable>
            <Text style={styles.stepperValue}>{quantity}</Text>
            <Pressable onPress={() => setQuantity((q) => Math.min(999, q + 1))} style={styles.stepperButton}>
              <Feather name="plus" size={18} color={Colors.text} />
            </Pressable>
          </View>
        </Section>

        <View style={styles.warningBox}>
          <Feather name="alert-triangle" size={16} color={Colors.warning} />
          <Text style={styles.warningText}>
            Once this sells, you must ship it with a tracked courier within {SHIPPING_DEADLINE_BUSINESS_DAYS} business days. A valid tracking number is required before you can mark an order as shipped.
          </Text>
        </View>

        <Button title="List this card" onPress={() => submitMutation.mutate()} loading={submitMutation.isPending} disabled={!canSubmit} style={{ marginTop: Spacing.lg }} />
      </View>

      <CardScannerModal visible={scannerOpen} onClose={() => setScannerOpen(false)} onCapture={handleScanCapture} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: "center", justifyContent: "center", gap: Spacing.sm },
  emptyText: { color: Colors.textSecondary, ...Typography.body },
  header: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg },
  screenTitle: { ...Typography.h2, color: Colors.white, marginBottom: Spacing.xs, letterSpacing: 0.2 },
  headerSubtitle: { ...Typography.small, color: "rgba(255,255,255,0.85)" },
  body: { padding: Spacing.lg, gap: Spacing.md },
  section: { backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  sectionHeaderRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  sectionIconBadge: { width: 26, height: 26, borderRadius: 13, backgroundColor: "#FCE9E4", alignItems: "center", justifyContent: "center" },
  sectionTitle: { ...Typography.bodyBold, color: Colors.text, fontSize: 16 },
  helper: { ...Typography.small, color: Colors.textSecondary, marginTop: 4, lineHeight: 18 },
  franchiseRow: { flexDirection: "row", gap: Spacing.md },
  franchiseCard: { flex: 1, borderRadius: BorderRadius.md, borderWidth: 2, backgroundColor: Colors.surface, overflow: "visible" },
  franchiseCardPressable: { alignItems: "center", gap: 6, paddingVertical: Spacing.lg },
  franchiseCardText: { ...Typography.bodyBold, fontSize: 15 },
  franchiseCheck: { position: "absolute", top: -8, right: -8, backgroundColor: "rgba(0,0,0,0.25)", borderRadius: 10 },
  thumbWrap: { marginRight: Spacing.sm, alignItems: "center" },
  thumb: { width: 84, height: 108, borderRadius: BorderRadius.sm, backgroundColor: Colors.surfaceAlt },
  removeThumb: { position: "absolute", top: -6, right: -6, backgroundColor: Colors.danger, borderRadius: 10, padding: 4 },
  reorderRow: { flexDirection: "row", gap: Spacing.sm, marginTop: 4 },
  addButtons: { flexDirection: "row", gap: Spacing.sm },
  addTile: { width: 84, height: 108, borderRadius: BorderRadius.sm, borderWidth: 1.5, borderColor: Colors.primary, borderStyle: "dashed", alignItems: "center", justifyContent: "center", gap: 4 },
  addTileText: { ...Typography.small, color: Colors.primary, fontWeight: "700" },
  input: { borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.md, paddingVertical: 12, backgroundColor: Colors.background, fontSize: 15, color: Colors.text },
  textArea: { minHeight: 90, textAlignVertical: "top" },
  errorText: { ...Typography.small, color: Colors.danger, marginTop: 6 },
  priceInputRow: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md, backgroundColor: Colors.background, paddingHorizontal: Spacing.md },
  dollarSign: { ...Typography.h3, color: Colors.textSecondary },
  priceInput: { flex: 1, paddingVertical: 12, paddingHorizontal: Spacing.xs, fontSize: 18, color: Colors.text },
  conditionRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  conditionChip: { paddingHorizontal: Spacing.md, paddingVertical: 8, borderRadius: BorderRadius.pill, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.background },
  conditionChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  conditionChipText: { ...Typography.small, color: Colors.text, fontWeight: "600" },
  stepper: { flexDirection: "row", alignItems: "center", gap: Spacing.lg, alignSelf: "flex-start" },
  stepperButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
  stepperValue: { ...Typography.h3, color: Colors.text, minWidth: 30, textAlign: "center" },
  warningBox: { flexDirection: "row", gap: Spacing.sm, backgroundColor: "#FEF3E2", padding: Spacing.md, borderRadius: BorderRadius.md },
  warningText: { flex: 1, ...Typography.small, color: "#92650B", lineHeight: 18 },
});
