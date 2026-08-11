import React, { useEffect, useState } from "react";
import { View, StyleSheet, Text, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "@react-navigation/elements";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { Colors, Spacing, Typography, BorderRadius } from "@/constants/theme";
import { Button } from "@/components/ui";
import { apiJson } from "@/lib/api";

const OPTIONS = [
  { key: "pokemon", label: "Pokémon", color: Colors.pokemon },
  { key: "one_piece", label: "One Piece", color: Colors.onePiece },
];

export default function NotificationFiltersScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const queryClient = useQueryClient();
  const { data } = useQuery<string[]>({ queryKey: ["/api/listings/subscriptions/mine"] });
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (data) setSelected(data);
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () => apiJson<{ franchises: string[] }>("PUT", "/api/listings/subscriptions/mine", { franchises: selected }),
    onSuccess: (result) => {
      // Update the cache directly (not just invalidate) so coming back to
      // this screen shows what was actually saved even within the query's
      // staleTime window, instead of the pre-save snapshot.
      queryClient.setQueryData(["/api/listings/subscriptions/mine"], result.franchises);
    },
  });

  const toggle = (key: string) => setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  return (
    <View style={[styles.container, { paddingTop: headerHeight + Spacing.lg, paddingBottom: insets.bottom + Spacing.xl }]}>
      <Text style={styles.title}>Get notified about new cards</Text>
      <Text style={styles.subtitle}>Select every franchise you want alerts for. You can pick both.</Text>

      <View style={styles.options}>
        {OPTIONS.map((opt) => {
          const active = selected.includes(opt.key);
          return (
            <Pressable key={opt.key} onPress={() => toggle(opt.key)} style={[styles.optionRow, active && { borderColor: opt.color, backgroundColor: `${opt.color}15` }]}>
              <View style={[styles.checkbox, active && { backgroundColor: opt.color, borderColor: opt.color }]}>
                {active ? <Feather name="check" size={14} color={Colors.white} /> : null}
              </View>
              <Text style={styles.optionLabel}>{opt.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <Button title={saveMutation.isSuccess ? "Saved!" : "Save preferences"} onPress={() => saveMutation.mutate()} loading={saveMutation.isPending} style={{ marginTop: Spacing.xl }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, paddingHorizontal: Spacing.xl },
  title: { ...Typography.h3, color: Colors.text },
  subtitle: { ...Typography.body, color: Colors.textSecondary, marginTop: Spacing.xs, marginBottom: Spacing.lg },
  options: { gap: Spacing.sm },
  optionRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, padding: Spacing.md, borderRadius: BorderRadius.md, borderWidth: 1.5, borderColor: Colors.border },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: Colors.border, alignItems: "center", justifyContent: "center" },
  optionLabel: { ...Typography.bodyBold, color: Colors.text },
});
