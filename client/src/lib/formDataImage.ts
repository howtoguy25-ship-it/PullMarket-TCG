import { Platform } from "react-native";

/** Appends a locally-picked image URI to a FormData under `images`, handling
 * the web (blob URIs need fetch→blob) vs native (uri/name/type object) split. */
export async function appendImageToFormData(formData: FormData, uri: string, index: number): Promise<void> {
  await appendImageField(formData, "images", uri, `card-${index}.jpg`);
}

/** Same web/native split as above, but for a single named field (e.g. the
 * card-compositing endpoint's `image` field) instead of the multi-image
 * `images` array listings use. */
export async function appendImageField(formData: FormData, field: string, uri: string, name = "photo.jpg"): Promise<void> {
  if (Platform.OS === "web") {
    const response = await fetch(uri);
    const blob = await response.blob();
    formData.append(field, blob, name);
  } else {
    formData.append(field, { uri, name, type: "image/jpeg" } as unknown as Blob);
  }
}

/** Same web/native split, for a picked photo OR video (chat attachments) —
 * infers mime/extension from the picker asset's `type`/`mimeType`. */
export async function appendMediaToFormData(
  formData: FormData,
  field: string,
  asset: { uri: string; type?: string; mimeType?: string; fileName?: string | null },
  index: number,
): Promise<void> {
  const isVideo = asset.type === "video" || !!asset.mimeType?.startsWith("video/");
  const mimeType = asset.mimeType || (isVideo ? "video/mp4" : "image/jpeg");
  const name = asset.fileName || `media-${index}.${isVideo ? "mp4" : "jpg"}`;
  if (Platform.OS === "web") {
    const response = await fetch(asset.uri);
    const blob = await response.blob();
    formData.append(field, blob, name);
  } else {
    formData.append(field, { uri: asset.uri, name, type: mimeType } as unknown as Blob);
  }
}
