import React, { useMemo } from "react";
import { Linking, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { spacing, typography } from "../theme/colors";
import { useTheme } from "../lib/ThemeContext";
import type { Palette } from "../theme/palettes";
import type { ParsedSource } from "../lib/sources";
import { FadeInUp } from "./FadeInUp";

/** Real domain name for a display label, e.g. "wikipedia.org" from a full URL — never guessed, always derived from the actual link. */
function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * The one "here's where I got this" link list used everywhere NexaAi cites
 * real sources — general web-search-backed chat answers and the who-is
 * deep dive alike (see shared/src/nexaPersona.ts's Sources format both
 * share). Plain numbered links, no card/border around them — reads as
 * real hyperlinks (own blue, underlined) rather than another boxed UI
 * element, the same way Claude's own citations render as plain text links.
 */
export function SourceLinksList({ sources }: { sources: ParsedSource[] }) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  if (!sources.length) return null;

  return (
    <View style={styles.block}>
      <Text style={styles.label}>
        Sources · {sources.length} link{sources.length === 1 ? "" : "s"}
      </Text>
      {sources.map((source, i) => (
        <FadeInUp key={`${source.url}-${i}`} delayMs={i * 40}>
          <TouchableOpacity onPress={() => Linking.openURL(source.url).catch(() => {})} activeOpacity={0.6} style={styles.row}>
            <Text style={styles.index}>{i + 1}.</Text>
            <Text style={styles.link} numberOfLines={1}>
              {source.title} <Text style={styles.host}>· {hostname(source.url)}</Text>
            </Text>
          </TouchableOpacity>
        </FadeInUp>
      ))}
    </View>
  );
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    block: { marginTop: spacing.md, gap: 4 },
    label: { ...typography.sectionLabel, color: palette.textMuted, textTransform: "uppercase", marginBottom: 2 },
    row: { flexDirection: "row", gap: 6, paddingVertical: 2 },
    index: { ...typography.caption, color: palette.textMuted },
    link: { ...typography.caption, color: palette.link, textDecorationLine: "underline", flexShrink: 1 },
    host: { color: palette.textMuted, textDecorationLine: "none" },
  });
}
