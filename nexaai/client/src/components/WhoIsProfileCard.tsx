import React, { useMemo, useState } from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { radii, spacing, typography } from "../theme/colors";
import { useTheme } from "../lib/ThemeContext";
import type { Palette } from "../theme/palettes";
import { FadeInUp } from "./FadeInUp";

interface WhoIsAccount {
  platform: string;
  detail: string;
}

interface WhoIsSource {
  title: string;
  url: string;
}

interface WhoIsProfile {
  name: string;
  knownFor: string | null;
  bio: string;
  accounts: WhoIsAccount[];
  photoUrl: string | null;
  sources: WhoIsSource[];
}

/**
 * Parses the exact structured layout WHO_IS_FORMAT requires
 * (shared/src/nexaPersona.ts) into sections for animated rendering. Returns
 * null for anything that doesn't match that shape — a refusal ("only works
 * for public figures...") or an ambiguous-name clarifying question — so
 * those fall back to plain text rendering instead of being mis-parsed.
 */
const RESERVED_HEADERS = /^(Bio|Official accounts found|Sources)$/i;

export function parseWhoIsProfile(text: string): WhoIsProfile | null {
  const lines = text.split("\n").map((l) => l.trim());

  // The model occasionally writes a lead-in line ("I'll look up...") before
  // the structured profile, a side effect of the web-search tool loop —
  // scan forward for the first bold line that isn't itself a section
  // header, rather than requiring it to be line one, so that preamble
  // doesn't make this parse fail and silently fall back to plain text.
  let i = 0;
  let name: string | null = null;
  while (i < lines.length) {
    const candidate = lines[i]?.match(/^\*\*(.+)\*\*$/);
    if (candidate && !RESERVED_HEADERS.test(candidate[1])) {
      name = candidate[1];
      i++;
      break;
    }
    i++;
  }
  if (!name) return null;
  while (i < lines.length && !lines[i]) i++;

  let knownFor: string | null = null;
  const knownForMatch = lines[i]?.match(/^_(.+)_$/);
  if (knownForMatch) {
    knownFor = knownForMatch[1];
    i++;
  }

  const bioLines: string[] = [];
  const accounts: WhoIsAccount[] = [];
  const sources: WhoIsSource[] = [];
  let photoUrl: string | null = null;
  let section: "bio" | "accounts" | "sources" | null = null;
  let sawAccountsHeader = false;
  let sawSourcesHeader = false;

  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (/^\*\*Bio\*\*$/i.test(line)) {
      section = "bio";
      continue;
    }
    if (/^\*\*Official accounts found\*\*$/i.test(line)) {
      section = "accounts";
      sawAccountsHeader = true;
      continue;
    }
    if (/^\*\*Sources\*\*$/i.test(line)) {
      section = "sources";
      sawSourcesHeader = true;
      continue;
    }
    const photoMatch = line.match(/^!\[.*?\]\((https?:\/\/[^\s)]+)\)/);
    if (photoMatch) {
      photoUrl = photoMatch[1];
      continue;
    }
    if (section === "bio") {
      bioLines.push(line);
    } else if (section === "accounts") {
      const accountMatch = line.match(/^-\s*(.+?)\s*[—-]\s*(.+)$/);
      if (accountMatch) accounts.push({ platform: accountMatch[1], detail: accountMatch[2] });
    } else if (section === "sources") {
      const sourceMatch = line.match(/^\d+\.\s*(.+?)\s*[—-]\s*(https?:\S+)$/);
      if (sourceMatch) sources.push({ title: sourceMatch[1], url: sourceMatch[2] });
    }
  }

  // Require the two mandatory headers the prompt always produces for a real
  // profile — anything missing them (a refusal, a clarifying question) is
  // deliberately left unparsed rather than guessed at.
  if (!sawAccountsHeader || !sawSourcesHeader) return null;

  return { name, knownFor, bio: bioLines.join(" "), accounts, photoUrl, sources };
}

const PLATFORM_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  twitter: "logo-twitter",
  x: "logo-twitter",
  instagram: "logo-instagram",
  facebook: "logo-facebook",
  linkedin: "logo-linkedin",
  youtube: "logo-youtube",
  tiktok: "logo-tiktok",
  github: "logo-github",
  website: "globe",
};

function iconForPlatform(platform: string): keyof typeof Ionicons.glyphMap {
  const key = platform.toLowerCase();
  for (const [needle, icon] of Object.entries(PLATFORM_ICON)) {
    if (key.includes(needle)) return icon;
  }
  return "link";
}

/**
 * The animated "deep dive" presentation: title and known-for scale/fade in
 * first, then the attributed photo (if any) fades+scales in, then the bio,
 * then each official account slides in one at a time, then a collapsible
 * sources list — a real staggered reveal (FadeInUp with increasing delays),
 * not everything appearing at once.
 */
export function WhoIsProfileCard({ profile }: { profile: WhoIsProfile }) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);
  const [sourcesOpen, setSourcesOpen] = useState(false);

  return (
    <View style={styles.card}>
      <FadeInUp delayMs={0}>
        <Text style={[styles.name, { color: palette.textPrimary }]}>{profile.name}</Text>
        {profile.knownFor && <Text style={[styles.knownFor, { color: palette.accentBright }]}>{profile.knownFor}</Text>}
      </FadeInUp>

      {profile.photoUrl && (
        <FadeInUp delayMs={120}>
          <Image source={{ uri: profile.photoUrl }} style={styles.photo} resizeMode="cover" />
        </FadeInUp>
      )}

      {profile.bio && (
        <FadeInUp delayMs={220}>
          <Text style={styles.sectionLabel}>Bio</Text>
          <Text style={styles.bio}>{profile.bio}</Text>
        </FadeInUp>
      )}

      {profile.accounts.length > 0 && (
        <View style={styles.accountsBlock}>
          <Text style={styles.sectionLabel}>Official accounts found</Text>
          {profile.accounts.map((account, i) => (
            <FadeInUp key={`${account.platform}-${i}`} delayMs={320 + i * 90}>
              <View style={styles.accountRow}>
                <Ionicons name={iconForPlatform(account.platform)} size={16} color={palette.accentBright} />
                <Text style={styles.accountPlatform}>{account.platform}</Text>
                <Text style={styles.accountDetail} numberOfLines={1}>
                  {account.detail}
                </Text>
              </View>
            </FadeInUp>
          ))}
        </View>
      )}

      {profile.sources.length > 0 && (
        <FadeInUp delayMs={320 + profile.accounts.length * 90 + 100}>
          <TouchableOpacity style={styles.sourcesToggle} onPress={() => setSourcesOpen((v) => !v)}>
            <Ionicons name={sourcesOpen ? "chevron-down" : "chevron-forward"} size={14} color={palette.textMuted} />
            <Text style={styles.sourcesToggleText}>
              {sourcesOpen ? "Hide" : "Show"} {profile.sources.length} source{profile.sources.length === 1 ? "" : "s"}
            </Text>
          </TouchableOpacity>
          {sourcesOpen && (
            <View style={styles.sourcesList}>
              {profile.sources.map((source, i) => (
                <FadeInUp key={source.url} delayMs={i * 50}>
                  <Text style={styles.sourceLine} numberOfLines={1}>
                    {i + 1}. {source.title}
                  </Text>
                </FadeInUp>
              ))}
            </View>
          )}
        </FadeInUp>
      )}
    </View>
  );
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    card: { gap: spacing.sm },
    name: { ...typography.h1, fontSize: 22 },
    knownFor: { ...typography.body, fontStyle: "italic", marginTop: 2 },
    photo: { width: "100%", height: 200, borderRadius: radii.lg, marginTop: spacing.sm, backgroundColor: palette.bgCardAlt },
    sectionLabel: { ...typography.caption, color: palette.textMuted, textTransform: "uppercase", marginTop: spacing.sm, marginBottom: 4 },
    bio: { ...typography.body, color: palette.textPrimary, lineHeight: 21 },
    accountsBlock: { marginTop: spacing.xs },
    accountRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 6 },
    accountPlatform: { ...typography.bodyBold, color: palette.textPrimary },
    accountDetail: { ...typography.caption, color: palette.textSecondary, flex: 1 },
    sourcesToggle: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm },
    sourcesToggleText: { ...typography.caption, color: palette.textMuted, fontWeight: "700" },
    sourcesList: { marginTop: spacing.xs, gap: 4 },
    sourceLine: { ...typography.caption, color: palette.textSecondary },
  });
}
