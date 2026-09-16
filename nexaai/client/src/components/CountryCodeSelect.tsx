import React, { useMemo, useRef, useState } from "react";
import { FlatList, Modal, Text, TextInput, TouchableOpacity, View, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { radii, spacing, typography } from "../theme/colors";
import { useTheme } from "../lib/ThemeContext";
import type { Palette } from "../theme/palettes";
import { COUNTRIES, flagEmoji, type Country } from "../lib/countries";

interface CountryCodeSelectProps {
  value: Country;
  onChange: (country: Country) => void;
  testID?: string;
}

/**
 * Real country/dial-code picker for phone sign-in (AuthScreen.tsx) — every
 * entry in lib/countries.ts is a genuine ISO 3166-1 country with its real
 * E.164 calling code, searchable by name or code, not a static "+1"
 * assumption. Matches TextField.tsx's pill-field visual language so it
 * reads as one input row together with the phone number field next to it.
 */
export function CountryCodeSelect({ value, onChange, testID }: CountryCodeSelectProps) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<TextInput>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter((c) => c.name.toLowerCase().includes(q) || c.dialCode.includes(q) || c.code.toLowerCase() === q);
  }, [query]);

  return (
    <>
      <TouchableOpacity
        testID={testID}
        style={styles.trigger}
        onPress={() => {
          setQuery("");
          setOpen(true);
        }}
      >
        <Text style={styles.flag}>{flagEmoji(value.code)}</Text>
        <Text style={styles.dialCode}>{value.dialCode}</Text>
        <Ionicons name="chevron-down" size={14} color={palette.textMuted} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Choose a country</Text>
              <TouchableOpacity onPress={() => setOpen(false)} hitSlop={8}>
                <Ionicons name="close" size={20} color={palette.textMuted} />
              </TouchableOpacity>
            </View>
            <View style={styles.searchRow}>
              <Ionicons name="search" size={16} color={palette.textMuted} />
              <TextInput
                ref={searchInputRef}
                style={styles.searchInput}
                placeholder="Search country or code"
                placeholderTextColor={palette.textMuted}
                value={query}
                onChangeText={setQuery}
                autoFocus
                returnKeyType="search"
                testID={testID ? `${testID}-search` : undefined}
              />
              {query.length > 0 && (
                <TouchableOpacity
                  onPress={() => {
                    setQuery("");
                    searchInputRef.current?.focus();
                  }}
                  hitSlop={8}
                  testID={testID ? `${testID}-search-clear` : undefined}
                >
                  <Ionicons name="close-circle" size={16} color={palette.textMuted} />
                </TouchableOpacity>
              )}
            </View>
            <FlatList
              style={styles.list}
              data={filtered}
              keyExtractor={(item) => item.code}
              keyboardShouldPersistTaps="handled"
              ItemSeparatorComponent={() => <View style={styles.rowDivider} />}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.row}
                  activeOpacity={0.6}
                  onPress={() => {
                    onChange(item);
                    setOpen(false);
                  }}
                  testID={testID ? `${testID}-option-${item.code}` : undefined}
                >
                  <Text style={styles.flag}>{flagEmoji(item.code)}</Text>
                  <Text style={styles.rowName}>{item.name}</Text>
                  <Text style={styles.rowDialCode}>{item.dialCode}</Text>
                  {item.code === value.code && <Ionicons name="checkmark" size={16} color={palette.accentBright} />}
                </TouchableOpacity>
              )}
              ListEmptyComponent={<Text style={styles.emptyText}>No matching country.</Text>}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    trigger: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: palette.bgCardAlt,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      paddingHorizontal: spacing.md,
      paddingVertical: 14,
    },
    flag: { fontSize: 18 },
    dialCode: { ...typography.body, color: palette.textPrimary, fontVariant: ["tabular-nums"] },
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
    sheet: { backgroundColor: palette.bgCard, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, maxHeight: "75%", paddingTop: spacing.lg },
    sheetHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: palette.border,
    },
    sheetTitle: { ...typography.bodyBold, color: palette.textPrimary },
    // Borderless, filled pill — the same "search bar" language iOS/Android
    // use, deliberately distinct from a bordered form-field box, since this
    // is filtering an already-open list rather than collecting a value.
    searchRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: palette.bgCardAlt,
      borderRadius: radii.pill,
      marginHorizontal: spacing.lg,
      paddingHorizontal: spacing.md,
      marginTop: spacing.md,
      marginBottom: spacing.sm,
    },
    // outlineWidth is an RN Web-specific passthrough — without it the
    // browser draws its own default focus ring on the underlying <input>,
    // reintroducing exactly the boxed look this pill design is meant to
    // avoid (autoFocus means this field starts focused). RN's own style
    // types only admit "solid"/"dotted"/"dashed" for outlineStyle (not the
    // "none" the web actually needs), so width:0 is the type-safe way to
    // get the same visual result.
    searchInput: { flex: 1, paddingVertical: 10, color: palette.textPrimary, outlineWidth: 0, ...typography.body },
    // Without an explicit flex:1 here, RN Web's FlatList doesn't reliably
    // pick up a bounded height from the sheet's percentage maxHeight alone
    // — it renders every row unclipped and the whole page scrolls instead
    // of just this list, which silently hides everything past the fold.
    list: { flex: 1 },
    row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: 13 },
    rowDivider: { height: 1, backgroundColor: palette.border, marginLeft: spacing.lg + 26 + spacing.md },
    rowName: { flex: 1, ...typography.body, color: palette.textPrimary },
    rowDialCode: { ...typography.caption, color: palette.textMuted, fontVariant: ["tabular-nums"] },
    emptyText: { ...typography.caption, color: palette.textMuted, textAlign: "center", padding: spacing.lg },
  });
}
