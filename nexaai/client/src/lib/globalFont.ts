import { Text, TextInput } from "react-native";

// A real, widely-used RN technique (the same one react-native-global-props
// uses) for applying one default font across every <Text>/<TextInput> in the
// app without having to touch every screen's StyleSheet — those are plain
// objects created once at module-load time, so swapping a shared constant
// later wouldn't reactively restyle anything already created. Overriding
// defaultProps.style instead works because RN merges defaultProps in at the
// lowest priority on every render, so any component's own explicit style
// (which never sets fontFamily in this app) still layers on top correctly.
//
// Known real limitation: each Google Font weight ships as its own distinct
// font family (e.g. "Inter_700Bold" is not "Inter" + bold), so a numeric
// `fontWeight` in an existing style can't reliably re-synthesize a
// different weight of a custom family the way it does for a system font.
// Switching fonts here changes every piece of text to the chosen family's
// Regular cut; headings still read as bold on most platforms via partial
// synthetic boldening, but won't be pixel-identical to a dedicated Bold cut.

let capturedBaseTextStyle: unknown;
let capturedBaseInputStyle: unknown;
let captured = false;

export function applyGlobalFont(fontFamily: string) {
  if (!captured) {
    capturedBaseTextStyle = (Text as any).defaultProps?.style;
    capturedBaseInputStyle = (TextInput as any).defaultProps?.style;
    captured = true;
  }
  (Text as any).defaultProps = {
    ...((Text as any).defaultProps ?? {}),
    style: [capturedBaseTextStyle, { fontFamily }].filter(Boolean),
  };
  (TextInput as any).defaultProps = {
    ...((TextInput as any).defaultProps ?? {}),
    style: [capturedBaseInputStyle, { fontFamily }].filter(Boolean),
  };
}
