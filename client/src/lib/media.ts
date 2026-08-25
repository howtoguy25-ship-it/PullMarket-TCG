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

/** Real display aspect ratio for a Status frame: 16:9 landscape unless the
 * real (post-rotation) shape is taller than it is wide, in which case 9:16 —
 * used to size video frames from the actual picked/stored asset instead of
 * forcing every clip into one fixed ratio. `rotation` is 0/90/180/270; a
 * 90/270 rotation swaps which of width/height is "effectively" wider. */
export function effectiveStoryAspectRatio(width: number | null | undefined, height: number | null | undefined, rotation: number): number {
  if (!width || !height) return 16 / 9;
  const swapped = rotation === 90 || rotation === 270;
  const effW = swapped ? height : width;
  const effH = swapped ? width : height;
  return effH > effW ? 9 / 16 : 16 / 9;
}
