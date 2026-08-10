import { getApiUrl } from "./api";

/** Server image paths come back relative (e.g. "/api/uploads/x.jpg"). In
 * production the app and API share an origin so that's fine as-is, but in
 * local dev the Expo web client and API run on different ports — resolve
 * relative paths against the API origin so images actually load. Absolute
 * URLs (external seed data, future S3/CDN links) pass through untouched. */
export function resolveImageUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (/^(https?:|data:|blob:)/.test(url)) return url;
  return `${getApiUrl()}${url}`;
}
