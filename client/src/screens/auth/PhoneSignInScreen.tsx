import React, { useState, useMemo } from "react";
import { View, StyleSheet, Text, TextInput, Pressable, Modal, FlatList, Platform, Alert } from "react-native";
import * as Localization from "expo-localization";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Feather } from "@expo/vector-icons";
import { Colors, Spacing, Typography, BorderRadius } from "@/constants/theme";
import { Button } from "@/components/ui";
import { AuthStackParamList } from "@/navigation/types";
import { COUNTRIES, DEFAULT_COUNTRY, Country } from "@/constants/countries";
import { apiJson, ApiError } from "@/lib/api";

type Nav = NativeStackNavigationProp<AuthStackParamList, "PhoneSignIn">;

function showAlert(title: string, message: string) {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}

/** Defaults the country picker to wherever the user actually is, using the
 * device's region setting (native) or browser locale (web) — same API on
 * both platforms. Falls back to DEFAULT_COUNTRY if detection fails or the
 * region isn't in our dial-code list. */
function detectCountry(): Country {
  try {
    const regionCode = Localization.getLocales()[0]?.regionCode;
    const match = regionCode ? COUNTRIES.find((c) => c.code === regionCode) : undefined;
    return match ?? DEFAULT_COUNTRY;
  } catch {
    return DEFAULT_COUNTRY;
  }
}

export default function PhoneSignInScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const [country, setCountry] = useState<Country>(detectCountry);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [number, setNumber] = useState("");
  const [loading, setLoading] = useState(false);

  const filteredCountries = useMemo(
    () => COUNTRIES.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()) || c.dial.includes(search)),
    [search],
  );

  const handleContinue = async () => {
    const digits = number.replace(/\D/g, "");
    if (digits.length < 4) {
      showAlert("Enter a phone number", "That doesn't look like a valid phone number.");
      return;
    }
    const destination = `${country.dial}${digits}`;
    setLoading(true);
    try {
      await apiJson("POST", "/api/auth/otp/request", { destination, channel: "sms" });
      navigation.navigate("OtpVerify", { destination, channel: "sms" });
    } catch (err) {
      console.error("[auth] Phone OTP request failed", { destination, status: err instanceof ApiError ? err.status : undefined, message: err instanceof Error ? err.message : err });
      showAlert("Couldn't send code", err instanceof ApiError ? err.message : "Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: headerHeight + Spacing.xl, paddingBottom: insets.bottom + Spacing.xl }]}>
      <Text style={styles.title}>What's your number?</Text>
      <Text style={styles.subtitle}>We'll text you a 6-digit code to verify it's you.</Text>

      <View style={styles.inputRow}>
        <Pressable style={styles.countryButton} onPress={() => setPickerOpen(true)}>
          <Text style={styles.flag}>{country.flag}</Text>
          <Text style={styles.dial}>{country.dial}</Text>
          <Feather name="chevron-down" size={16} color={Colors.textSecondary} />
        </Pressable>
        <TextInput
          style={styles.input}
          placeholder="412 345 678"
          placeholderTextColor={Colors.textMuted}
          keyboardType="phone-pad"
          value={number}
          onChangeText={setNumber}
          autoFocus
        />
      </View>

      <Button title="Send code" onPress={handleContinue} loading={loading} style={{ marginTop: Spacing.xl }} />

      <Modal visible={pickerOpen} animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <View style={[styles.modalContainer, { paddingTop: insets.top + Spacing.md }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select country</Text>
            <Pressable onPress={() => setPickerOpen(false)} hitSlop={8}>
              <Feather name="x" size={24} color={Colors.text} />
            </Pressable>
          </View>
          <TextInput style={styles.searchInput} placeholder="Search country or code" value={search} onChangeText={setSearch} placeholderTextColor={Colors.textMuted} />
          <FlatList
            data={filteredCountries}
            keyExtractor={(item) => item.code}
            renderItem={({ item }) => (
              <Pressable
                style={styles.countryRow}
                onPress={() => {
                  setCountry(item);
                  setPickerOpen(false);
                  setSearch("");
                }}
              >
                <Text style={styles.flag}>{item.flag}</Text>
                <Text style={styles.countryName}>{item.name}</Text>
                <Text style={styles.dial}>{item.dial}</Text>
              </Pressable>
            )}
          />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, paddingHorizontal: Spacing.xl },
  title: { ...Typography.h2, color: Colors.text },
  subtitle: { ...Typography.body, color: Colors.textSecondary, marginTop: Spacing.xs, marginBottom: Spacing.xl },
  inputRow: { flexDirection: "row", gap: Spacing.sm },
  countryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface,
  },
  flag: { fontSize: 20 },
  dial: { ...Typography.bodyBold, color: Colors.text },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 14,
    backgroundColor: Colors.surface,
    fontSize: 16,
    color: Colors.text,
  },
  modalContainer: { flex: 1, backgroundColor: Colors.background, paddingHorizontal: Spacing.lg },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: Spacing.md },
  modalTitle: { ...Typography.h3, color: Colors.text },
  searchInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    backgroundColor: Colors.surface,
    marginBottom: Spacing.sm,
  },
  countryRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  countryName: { flex: 1, ...Typography.body, color: Colors.text },
});
