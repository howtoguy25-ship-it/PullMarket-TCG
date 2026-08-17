import { requireNativeViewManager } from "expo-modules-core";
import { Platform } from "react-native";
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
const NativeAudioRoutePickerView =
  Platform.OS === "ios" ? requireNativeViewManager<AudioRoutePickerViewProps>("AudioRoutePicker") : null;

export function AudioRoutePickerView(props: AudioRoutePickerViewProps) {
  if (!NativeAudioRoutePickerView) return null;
  return <NativeAudioRoutePickerView {...props} />;
}
