import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { GalaxyBackground } from "../components/GalaxyBackground";
import { colors, radii, spacing, typography } from "../theme/colors";
import { THEME_OPTIONS } from "../theme/palettes";
import { useTheme } from "../lib/ThemeContext";
import { FONT_OPTIONS, useFont } from "../lib/FontContext";
import { useAuth } from "../lib/AuthContext";
import { api } from "../lib/api";

export function AppearanceScreen() {
  const { palette, setThemeId } = useTheme();
  const { activeFont, setFontChoice } = useFont();
  const { refreshUser } = useAuth();
  const [pending, setPending] = useState<string | null>(null);

  const pickFont = async (id: (typeof FONT_OPTIONS)[number]["id"]) => {
    setFontChoice(id); // instant feedback
    setPending(`font-${id}`);
    try {
      await api("/api/auth/settings", { method: "PATCH", body: JSON.stringify({ fontChoice: id }) });
      await refreshUser();
    } finally {
      setPending(null);
    }
  };

  const pickTheme = async (id: (typeof THEME_OPTIONS)[number]["id"]) => {
    setThemeId(id); // instant feedback
    setPending(`theme-${id}`);
    try {
      await api("/api/auth/settings", { method: "PATCH", body: JSON.stringify({ themeId: id }) });
      await refreshUser();
    } finally {
      setPending(null);
    }
  };

  return (
    <GalaxyBackground>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Appearance</Text>

        <Text style={styles.sectionLabel}>Font</Text>
        <View style={styles.fontList}>
          {FONT_OPTIONS.map((font) => {
            const active = font.id === activeFont.id;
            return (
              <TouchableOpacity
                key={font.id}
                style={[styles.fontCard, active && { borderColor: palette.accent }]}
                onPress={() => pickFont(font.id)}
                disabled={pending === `font-${font.id}`}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.fontPreview, { fontFamily: font.bold }]}>{font.label}</Text>
                  <Text style={[styles.fontSample, { fontFamily: font.regular }]}>The quick NexaAi jumps over lazy limits.</Text>
                  <Text style={styles.fontTagline}>{font.tagline}</Text>
                </View>
                {active && <Ionicons name="checkmark-circle" size={22} color={palette.accent} />}
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.sectionLabel}>Background theme</Text>
        <View style={styles.themeGrid}>
          {THEME_OPTIONS.map((theme) => {
            const active = theme.id === palette.id;
            return (
              <TouchableOpacity
                key={theme.id}
                style={[styles.themeCard, { backgroundColor: theme.gradientGalaxy[1] }, active && { borderColor: theme.accentBright }]}
                onPress={() => pickTheme(theme.id)}
                disabled={pending === `theme-${theme.id}`}
              >
                <View style={[styles.swatch, { backgroundColor: theme.accent }]} />
                <Text style={styles.themeLabel}>{theme.label}</Text>
                {active && <Ionicons name="checkmark-circle" size={18} color={theme.accentBright} style={styles.themeCheck} />}
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={styles.note}>
          Background themes only change the gradient and accent color — card surfaces and text stay the same shade everywhere so
          contrast is always guaranteed.
        </Text>
      </ScrollView>
    </GalaxyBackground>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md },
  title: { ...typography.h1, color: colors.textPrimary },
  sectionLabel: { ...typography.caption, color: colors.textMuted, textTransform: "uppercase", marginTop: spacing.sm },
  fontList: { gap: spacing.sm },
  fontCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.bgCard,
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  fontPreview: { fontSize: 18, color: colors.textPrimary },
  fontSample: { fontSize: 14, color: colors.textSecondary, marginTop: 4 },
  fontTagline: { ...typography.caption, color: colors.textMuted, marginTop: 4 },
  themeGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  themeCard: {
    flexGrow: 1,
    minWidth: "45%",
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: spacing.lg,
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  swatch: { width: 28, height: 28, borderRadius: radii.pill },
  themeLabel: { ...typography.bodyBold, color: colors.textPrimary },
  themeCheck: { position: "absolute", top: spacing.sm, right: spacing.sm },
  note: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm },
});
