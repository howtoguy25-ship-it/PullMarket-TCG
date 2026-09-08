import React, { useEffect, useRef } from "react";
import { Animated, Easing } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../theme/colors";

export type McpConnectPhase = "connecting" | "success" | "error";

/**
 * Real, driven-by-actual-request-state animation for an MCP connector's
 * connect/reconnect attempt — a spinning plug icon while the request is in
 * flight, then a spring-pop checkmark or X reflecting the real result
 * (routes/mcp.ts's tryDiscover outcome), not a cosmetic delay.
 */
export function McpStatusAnimation({ phase, size = 20 }: { phase: McpConnectPhase; size?: number }) {
  const spin = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (phase === "connecting") {
      spin.setValue(0);
      const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }));
      loop.start();
      return () => loop.stop();
    }
    pop.setValue(0);
    Animated.spring(pop, { toValue: 1, friction: 5, tension: 140, useNativeDriver: true }).start();
  }, [phase, spin, pop]);

  if (phase === "connecting") {
    const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
    return (
      <Animated.View style={{ transform: [{ rotate }] }}>
        <Ionicons name="sync" size={size} color={colors.accentBright} />
      </Animated.View>
    );
  }
  const scale = pop.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.3, 1.15, 1] });
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Ionicons name={phase === "success" ? "checkmark-circle" : "close-circle"} size={size} color={phase === "success" ? colors.success : colors.danger} />
    </Animated.View>
  );
}
