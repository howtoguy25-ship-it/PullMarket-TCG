import React, { useCallback, useEffect, useState } from "react";
import { Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { radii, spacing, typography } from "../theme/colors";
import { useTheme } from "./ThemeContext";
import type { Palette } from "../theme/palettes";

export interface AlertButtonSpec {
  text?: string;
  style?: "default" | "cancel" | "destructive";
  onPress?: () => void;
}

interface AlertState {
  title: string;
  message?: string;
  buttons: AlertButtonSpec[];
}

let showImpl: ((state: AlertState) => void) | null = null;

/**
 * Drop-in replacement for React Native's `Alert.alert` — react-native-web's
 * own Alert is a complete no-op stub (`static alert() {}`, see
 * node_modules/react-native-web/dist/exports/Alert/index.js), so every one
 * of this app's Alert.alert() calls (confirmations, error messages) was
 * silently doing nothing on the web build — a real, live-verified bug, not
 * a style nitpick. Same call signature as the real Alert.alert, so every
 * existing call site only needs its import changed, not its logic.
 */
export const Alert = {
  alert(title: string, message?: string, buttons?: AlertButtonSpec[]) {
    const resolvedButtons = buttons && buttons.length ? buttons : [{ text: "OK" }];
    if (showImpl) showImpl({ title, message, buttons: resolvedButtons });
    else console.warn("Alert.alert called before AlertProvider mounted:", title, message);
  },
};

/** Mounted once near the app root (see App.tsx) — renders whatever Alert.alert's real, styled modal. */
export function AlertProvider({ children }: { children: React.ReactNode }) {
  const { palette } = useTheme();
  const styles = React.useMemo(() => makeStyles(palette), [palette]);
  const [state, setState] = useState<AlertState | null>(null);

  useEffect(() => {
    showImpl = setState;
    return () => {
      showImpl = null;
    };
  }, []);

  const close = useCallback((button: AlertButtonSpec) => {
    setState(null);
    button.onPress?.();
  }, []);

  return (
    <>
      {children}
      <Modal visible={!!state} transparent animationType="fade" onRequestClose={() => state && close(state.buttons[state.buttons.length - 1])}>
        {state && (
          <View style={styles.overlay}>
            <View style={styles.card}>
              <Text style={styles.title}>{state.title}</Text>
              {state.message ? <Text style={styles.message}>{state.message}</Text> : null}
              <View style={styles.buttonRow}>
                {state.buttons.map((button, i) => (
                  <TouchableOpacity key={i} style={[styles.button, i > 0 && styles.buttonBorderLeft]} onPress={() => close(button)} activeOpacity={0.7}>
                    <Text
                      style={[
                        styles.buttonText,
                        button.style === "destructive" && styles.buttonTextDestructive,
                        button.style === "cancel" && styles.buttonTextCancel,
                      ]}
                    >
                      {button.text ?? "OK"}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        )}
      </Modal>
    </>
  );
}

function makeStyles(palette: Palette) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
    card: { width: "100%", maxWidth: 340, backgroundColor: palette.bgCard, borderRadius: radii.lg, borderWidth: 1, borderColor: palette.border, overflow: "hidden" },
    title: { ...typography.h2, color: palette.textPrimary, textAlign: "center", paddingTop: spacing.lg, paddingHorizontal: spacing.lg },
    message: { ...typography.body, color: palette.textSecondary, textAlign: "center", padding: spacing.lg, paddingTop: spacing.sm },
    buttonRow: { flexDirection: "row", borderTopWidth: 1, borderTopColor: palette.border, marginTop: spacing.sm },
    button: { flex: 1, alignItems: "center", paddingVertical: spacing.md },
    buttonBorderLeft: { borderLeftWidth: 1, borderLeftColor: palette.border },
    buttonText: { ...typography.bodyBold, color: palette.accentBright },
    buttonTextCancel: { color: palette.textSecondary, fontWeight: "400" },
    buttonTextDestructive: { color: palette.danger },
  });
}
