import { requireNativeViewManager } from "expo-modules-core";
import { Platform, UIManager } from "react-native";
import type { ViewProps } from "react-native";

export interface AudioRoutePickerViewProps extends ViewProps {
  /** Icon color for the picker button in its normal (inactive) state. */
  tintColor?: string;
  /** Icon color while the system route menu is open / a non-default route (e.g. Bluetooth) is active. */
  activeTintColor?: string;
}

// iOS only — this wraps AVKit's AVRoutePickerView, which has no Android
// equivalent. On Android, callers should keep using the existing
// InCallManager speaker/Bluetooth toggle instead of this component.
//
// A binary built before this native module existed (or one where
// autolinking otherwise failed to register it) has no "AudioRoutePicker"
// view manager on the native side at all. requireNativeViewManager doesn't
// throw for that — React Native silently substitutes its built-in
// UnimplementedView, which renders as a plain box with the literal text
// "Unimplemented component: AudioRoutePicker" wrapped inside it. That's a
// real bug callers must not ship: checking the view manager config up
// front lets callers fall back to a real, working control instead.
export const isAudioRoutePickerAvailable = Platform.OS === "ios" && UIManager.getViewManagerConfig("AudioRoutePicker") != null;

const NativeAudioRoutePickerView = isAudioRoutePickerAvailable ? requireNativeViewManager<AudioRoutePickerViewProps>("AudioRoutePicker") : null;

export function AudioRoutePickerView(props: AudioRoutePickerViewProps) {
  if (!NativeAudioRoutePickerView) return null;
  return <NativeAudioRoutePickerView {...props} />;
}
