// Real fix for a live bug: every OAuth/callback/webhook URL builder in this
// codebase does `${process.env.APP_BASE_URL}/api/...`. If the deployed
// APP_BASE_URL env var itself ends in a slash (e.g. "https://asknexaai.com/"
// instead of "https://asknexaai.com"), every one of those URLs comes out
// with a double slash ("asknexaai.com//api/..."), which breaks Google's
// exact-string redirect_uri match and any other exact-match callback
// registration. Centralizing the read here means the env var can be set
// either way and every caller still gets a clean, single-slash join.
export function appBaseUrl(): string | undefined {
  return process.env.APP_BASE_URL?.replace(/\/+$/, "");
}
