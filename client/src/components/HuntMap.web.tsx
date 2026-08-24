// react-native-maps has no web implementation, so web gets a real (not
// fake) interactive map instead: an OpenStreetMap embed, no API key
// needed. The bounding box is sized to roughly match the radius so the
// framing feels consistent with the native circle view, even though the
// OSM embed itself can't draw the circle overlay directly.
import React from "react";
import { View, StyleSheet } from "react-native";
import { BorderRadius, Colors } from "@/constants/theme";

export function HuntMap({ latitude, longitude, radiusMeters, height = 220 }: { latitude: number; longitude: number; radiusMeters: number; height?: number }) {
  const latDelta = (radiusMeters * 2.6) / 111_320;
  const lonDelta = latDelta / Math.max(0.2, Math.cos((latitude * Math.PI) / 180));
  const bbox = [longitude - lonDelta / 2, latitude - latDelta / 2, longitude + lonDelta / 2, latitude + latDelta / 2].join("%2C");
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${latitude}%2C${longitude}`;

  return (
    <View style={[styles.wrap, { height }]}>
      {/* eslint-disable-next-line react/forbid-elements */}
      <iframe src={src} style={{ width: "100%", height: "100%", border: 0 }} loading="lazy" title="Card Hunt search area" />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%", borderRadius: BorderRadius.md, overflow: "hidden", borderWidth: 2, borderColor: Colors.gold },
});
