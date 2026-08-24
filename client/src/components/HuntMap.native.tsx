// Real interactive map (Apple Maps on iOS, Google Maps on Android) showing
// a radius circle around the hunt's real captured location — never a pin
// on the exact spot, which would trivially give the hiding place away.
import React, { useEffect, useRef } from "react";
import { StyleSheet } from "react-native";
import MapView, { Circle, PROVIDER_DEFAULT } from "react-native-maps";
import { Colors, BorderRadius } from "@/constants/theme";

export function HuntMap({ latitude, longitude, radiusMeters, height = 220 }: { latitude: number; longitude: number; radiusMeters: number; height?: number }) {
  // Frames the circle with comfortable padding — degrees-per-meter varies
  // with latitude, but this rough conversion is plenty accurate for
  // picking an initial zoom level (not for measuring distance).
  const latDelta = (radiusMeters * 2.6) / 111_320;
  const lonDelta = latDelta / Math.max(0.2, Math.cos((latitude * Math.PI) / 180));

  // `initialRegion` only sets the camera once, on mount — react-native-maps
  // never re-reads it. Without this, typing a new radius after the map is
  // already showing resizes the circle but leaves the camera zoomed to
  // whatever the first radius was, so a much bigger/smaller circle can end
  // up cropped or lost in a sea of empty map. Re-animate the camera
  // whenever the owner actually changes the spot or the radius, debounced
  // so it doesn't fight every keystroke while they're typing.
  const mapRef = useRef<MapView>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      mapRef.current?.animateToRegion({ latitude, longitude, latitudeDelta: latDelta, longitudeDelta: lonDelta }, 350);
    }, 250);
    return () => clearTimeout(timer);
  }, [latitude, longitude, latDelta, lonDelta]);

  return (
    <MapView
      ref={mapRef}
      provider={PROVIDER_DEFAULT}
      style={[styles.map, { height }]}
      initialRegion={{ latitude, longitude, latitudeDelta: latDelta, longitudeDelta: lonDelta }}
      scrollEnabled
      zoomEnabled
      pitchEnabled={false}
      rotateEnabled={false}
    >
      <Circle
        center={{ latitude, longitude }}
        radius={radiusMeters}
        strokeColor={Colors.gold}
        strokeWidth={2}
        fillColor="rgba(255,203,5,0.22)"
      />
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: { width: "100%", borderRadius: BorderRadius.md, overflow: "hidden" },
});
