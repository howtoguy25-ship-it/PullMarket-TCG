import { API_URL, getToken, ApiError } from "./api";

export interface UploadedAttachment {
  url: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  kind: "image" | "video" | "file";
}

/**
 * Real multipart upload — the file streams from disk straight into the
 * request body (not read into a giant base64 string first), so this
 * genuinely handles large photo/video files rather than choking on them.
 * `onProgress` isn't wired to a real byte counter here (plain `fetch`
 * doesn't expose upload progress cross-platform); the UI shows an
 * indeterminate spinner instead of a fake percentage.
 */
export async function uploadAttachment(fileUri: string, filename: string, mimeType: string): Promise<UploadedAttachment> {
  const token = await getToken();
  const form = new FormData();
  // React Native's FormData accepts this {uri,name,type} shape for a file field.
  form.append("file", { uri: fileUri, name: filename, type: mimeType } as unknown as Blob);

  const response = await fetch(`${API_URL}/api/attachments`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await response.json() : null;
  if (!response.ok) throw new ApiError(response.status, body);
  return body as UploadedAttachment;
}
