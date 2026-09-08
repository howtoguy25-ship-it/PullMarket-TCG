import React, { useEffect, useRef } from "react";
import { Animated, type StyleProp, type ViewStyle } from "react-native";

interface FadeInUpProps {
  children: React.ReactNode;
  /** Stagger multiple items in a list by passing their index * ~60ms here. */
  delayMs?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Real mount-in animation (fade + rise + slight scale) — not CSS, an actual
 * Animated.timing/spring run once per mount. Used across card lists
 * (Projects, Connectors, Agents, chat messages) so new content genuinely
 * animates into place instead of popping in flat.
 */
export function FadeInUp({ children, delayMs = 0, style }: FadeInUpProps) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.spring(progress, {
      toValue: 1,
      delay: delayMs,
      useNativeDriver: true,
      damping: 14,
      mass: 0.6,
      stiffness: 120,
    });
    anim.start();
    return () => anim.stop();
  }, [progress, delayMs]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
            { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
