import { Platform } from "react-native";
import { captureRef } from "react-native-view-shot";
// react-native-view-shot's own top-level captureRef calls RN's findNodeHandle
// unconditionally before dispatching to the native module — a real hard
// throw on web (react-native-web's findNodeHandle is a stub that always
// throws "not supported on web"). Its lower-level RNViewShot.web.js
// (html2canvas-based) works fine directly against a View's ref, which on
// web already IS the real DOM node — this routes to the right one per
// platform instead of going through the broken generic wrapper.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const RNViewShotWeb = require("react-native-view-shot/src/RNViewShot").default;

export interface CaptureOptions {
  format: "png" | "jpg";
  quality: number;
  result: "tmpfile" | "data-uri";
}

export async function captureViewAsImage(view: unknown, options: CaptureOptions): Promise<string> {
  if (Platform.OS === "web") {
    return RNViewShotWeb.captureRef(view, options);
  }
  return captureRef(view as Parameters<typeof captureRef>[0], options);
}
