import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, ViewStyle, TextStyle, PressableProps } from "react-native";
import { Colors, Spacing, BorderRadius, Typography, Fonts } from "@/constants/theme";

export function Button({
  title,
  onPress,
  variant = "primary",
  loading = false,
  disabled = false,
  style,
  icon,
  ...rest
}: {
  title: string;
  onPress?: () => void;
  variant?: "primary" | "secondary" | "outline" | "gold" | "danger" | "ghost" | "white" | "outlineOnDark";
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  icon?: React.ReactNode;
} & Omit<PressableProps, "style">) {
  const bg =
    variant === "primary"
      ? Colors.primary
      : variant === "secondary"
        ? Colors.secondary
        : variant === "gold"
          ? Colors.gold
          : variant === "danger"
            ? Colors.danger
            : variant === "white"
              ? Colors.white
              : "transparent";
  const textColor =
    variant === "outline" || variant === "ghost"
      ? Colors.primary
      : variant === "gold" || variant === "white"
        ? "#3A2A00"
        : variant === "outlineOnDark"
          ? Colors.white
          : Colors.white;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        variant === "outline" && { borderWidth: 1.5, borderColor: Colors.primary },
        variant === "outlineOnDark" && { borderWidth: 1.5, borderColor: Colors.white },
        variant === "ghost" && { paddingHorizontal: 0 },
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <View style={styles.buttonContent}>
          {icon}
          <Text style={[styles.buttonText, { color: textColor }]} numberOfLines={1} ellipsizeMode="tail">
            {title}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

export function Screen({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.screen, style]}>{children}</View>;
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function PriceTag({ cents, style }: { cents: number; style?: TextStyle }) {
  return <Text style={[styles.price, style]}>${(cents / 100).toFixed(2)}</Text>;
}

export function Badge({ label, color = Colors.primary, textColor = Colors.white, style }: { label: string; color?: string; textColor?: string; style?: ViewStyle }) {
  return (
    <View style={[styles.badge, { backgroundColor: color }, style]}>
      <Text style={[styles.badgeText, { color: textColor }]}>{label}</Text>
    </View>
  );
}

export function EmptyState({ icon, title, subtitle }: { icon?: React.ReactNode; title: string; subtitle?: string }) {
  return (
    <View style={styles.empty}>
      {icon}
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle ? <Text style={styles.emptySubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  button: {
    borderRadius: BorderRadius.pill,
    paddingVertical: 14,
    paddingHorizontal: Spacing.xl,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonContent: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  buttonText: { ...Typography.bodyBold, fontFamily: Fonts.displayBold, fontSize: 16, letterSpacing: 0.2 },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  price: { ...Typography.price, color: Colors.text },
  badge: { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: BorderRadius.pill },
  badgeText: { ...Typography.small, fontWeight: "700" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: Spacing.xl, gap: Spacing.sm },
  emptyTitle: { ...Typography.h3, color: Colors.text, textAlign: "center" },
  emptySubtitle: { ...Typography.body, color: Colors.textSecondary, textAlign: "center" },
});
