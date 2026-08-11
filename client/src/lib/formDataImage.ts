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
