import { Platform } from "react-native";

/** Appends a locally-picked image URI to a FormData under `images`, handling
 * the web (blob URIs need fetch→blob) vs native (uri/name/type object) split. */
export async function appendImageToFormData(formData: FormData, uri: string, index: number): Promise<void> {
  const name = `card-${index}.jpg`;
  if (Platform.OS === "web") {
    const response = await fetch(uri);
    const blob = await response.blob();
    formData.append("images", blob, name);
  } else {
    formData.append("images", { uri, name, type: "image/jpeg" } as unknown as Blob);
  }
}
