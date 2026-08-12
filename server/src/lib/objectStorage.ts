import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

// S3-compatible object storage — works with Cloudflare R2, Backblaze B2
// (S3-compatible mode), AWS S3 itself, or any other S3-compatible provider,
// distinguished purely by env vars. This is what lib/upload.ts's uploads
// fall back away from local disk to when configured (see that file for
// why: Render's free/starter local disk isn't persistent across deploys).
export function isObjectStorageConfigured(): boolean {
  return !!(process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY && process.env.S3_PUBLIC_URL_BASE);
}

let client: S3Client | null = null;

function getClient(): S3Client {
  if (!client) {
    client = new S3Client({
      region: process.env.S3_REGION || "auto",
      // Left unset, the AWS SDK talks to real AWS S3. Set this for
      // R2/B2/MinIO/any other S3-compatible endpoint.
      endpoint: process.env.S3_ENDPOINT || undefined,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      },
      // Path-style (endpoint/bucket/key) is what R2/B2/MinIO expect;
      // virtual-hosted style (bucket.endpoint/key) is AWS S3's default and
      // doesn't work against most other providers.
      forcePathStyle: !!process.env.S3_ENDPOINT,
    });
  }
  return client;
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<string> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET!,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
  const base = process.env.S3_PUBLIC_URL_BASE!.replace(/\/+$/, "");
  return `${base}/${key}`;
}

export async function deleteObject(key: string): Promise<void> {
  await getClient()
    .send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key }))
    .catch((err) => console.error("Object storage delete failed:", err));
}

/** Extracts the storage key back out of a public URL this module produced,
 * or null if the URL isn't one of ours (e.g. a Google avatar URL, or a
 * local /api/uploads/* path from before object storage was configured). */
export function keyFromPublicUrl(url: string): string | null {
  const base = process.env.S3_PUBLIC_URL_BASE?.replace(/\/+$/, "");
  if (!base || !url.startsWith(`${base}/`)) return null;
  return url.slice(base.length + 1);
}
