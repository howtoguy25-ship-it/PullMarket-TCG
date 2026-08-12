import React from "react";
import { Image, StyleSheet } from "react-native";
import { MascotAvatar } from "./MascotAvatar";
import { resolveImageUrl } from "@/lib/media";

/** Renders a user's real uploaded/OAuth profile photo when they have one,
 * falling back to the generated MascotAvatar otherwise — the single place
 * that decision is made, so every avatar in the app (search results, chat,
 * profiles, listings) stays consistent as real photos get added. */
export function Avatar({ avatarUrl, seed, size = 36 }: { avatarUrl?: string | null; seed: string; size?: number }) {
  const uri = resolveImageUrl(avatarUrl);
  if (uri) {
    return <Image source={{ uri }} style={[styles.image, { width: size, height: size, borderRadius: size / 2 }]} />;
  }
  return <MascotAvatar seed={seed} size={size} />;
}

const styles = StyleSheet.create({
  image: { backgroundColor: "#E7E1D3" },
});
