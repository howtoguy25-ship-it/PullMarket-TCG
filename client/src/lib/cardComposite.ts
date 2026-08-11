import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { apiJson, apiRequest, getApiUrl } from "@/lib/api";
import { appendImageField } from "@/lib/formDataImage";

export interface CardBackgroundOption {
  id: string;
  label: string;
  previewUrl: string;
}

export async function fetchCardBackgrounds(): Promise<CardBackgroundOption[]> {
  const backgrounds = await apiJson<{ id: string; label: string; previewUrl: string }[]>("GET", "/api/composite/backgrounds");
  return backgrounds.map((b) => ({ ...b, previewUrl: `${getApiUrl()}${b.previewUrl}` }));
}

/** Composites a scanned card photo onto a pre-built backdrop server-side,
 * then returns a URI usable exactly like any other locally-picked photo. On
 * native this downloads the result into the app's cache first, since RN's
 * FormData file parts need a local file:// URI, not a remote URL. */
export async function applyCardBackground(localUri: string, backgroundId: string): Promise<string> {
  const formData = new FormData();
  formData.append("background", backgroundId);
  await appendImageField(formData, "image", localUri, "card.jpg");

  const res = await apiRequest("POST", "/api/composite/card", formData, true);
  const { url } = (await res.json()) as { url: string };
  const fullUrl = `${getApiUrl()}${url}`;

  if (Platform.OS === "web") return fullUrl;

  const dest = `${FileSystem.cacheDirectory}composited-${Date.now()}.jpg`;
  await FileSystem.downloadAsync(fullUrl, dest);
  return dest;
}
