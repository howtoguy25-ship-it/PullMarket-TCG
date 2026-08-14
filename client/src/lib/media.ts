import { getApiUrl } from "./api";

/** Server image paths come back relative (e.g. "/api/uploads/x.jpg"). In
 * production the app and API share an origin so that's fine as-is, but in
 * local dev the Expo web client and API run on different ports — resolve
 * relative paths against the API origin so images actually load. Absolute
 * URLs pass through untouched: http(s)/data/blob (external seed data,
 * future S3/CDN links) as well as file:/content: (a local device URI a
 * screen picked directly off the device, like an image attached to a
 * message before it's uploaded — prefixing those with the API origin
 * would corrupt them into a broken URL). */
export function resolveImageUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (/^(https?:|data:|blob:|file:|content:)/.test(url)) return url;
  return `${getApiUrl()}${url}`;
}
