// Thin re-export — CheckoutForm.native.tsx / CheckoutForm.web.tsx are
// resolved automatically by Metro's platform-suffix convention (same as
// any Foo.native.tsx/Foo.web.tsx pair), which happens before module graph
// resolution. That's what actually keeps @stripe/stripe-react-native (a
// native-only SDK whose CardField imports React Native internals that
// don't even resolve on web) out of the web bundle — a dynamic import()
// alone isn't enough, since Metro still needs to resolve the imported
// file's own static imports to build that split chunk.
export { default } from "./CheckoutForm";
