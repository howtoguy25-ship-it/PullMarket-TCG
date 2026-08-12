import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { isObjectStorageConfigured, putObject, deleteObject, keyFromPublicUrl } from "./objectStorage";

// Uploads land on local disk by default (fine for development, and for a
// small deployment where you're okay losing uploads on redeploy/restart —
// notably Render's free/starter tier local disk is NOT persistent across
// those). Setting S3_BUCKET + friends (see objectStorage.ts, .env.example)
// switches every upload in the app over to S3-compatible object storage
// instead — Cloudflare R2, Backblaze B2, real AWS S3, or anything else
// S3-compatible — with no other code changes required.
const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// multer keeps the file in memory (not written to local disk) regardless
// of which backend it ultimately lands in — persistBuffer below decides
// where it actually goes. This also means routes that need to process the
// upload (e.g. composite.ts's image compositing) can read `file.buffer`
// directly instead of round-tripping through a temp file on disk.
const storage = multer.memoryStorage();

export const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024, files: 6 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      cb(new Error("Only image uploads are allowed"));
      return;
    }
    cb(null, true);
  },
});

export const UPLOAD_DIR_PATH = UPLOAD_DIR;

function extFor(originalname: string, mimetype: string): string {
  return path.extname(originalname) || (mimetype.startsWith("video/") ? ".mp4" : ".jpg");
}

async function persistBuffer(buffer: Buffer, ext: string, mimetype: string): Promise<string> {
  if (isObjectStorageConfigured()) {
    return putObject(`uploads/${randomUUID()}${ext}`, buffer, mimetype);
  }
  const filename = `${randomUUID()}${ext}`;
  await fs.promises.writeFile(path.join(UPLOAD_DIR, filename), buffer);
  return `/api/uploads/${filename}`;
}

/** Persists a file multer parsed (from `upload` or `chatUpload`) to
 * whichever backend is active, returning its public URL. */
export async function saveUploadedFile(file: Express.Multer.File): Promise<string> {
  return persistBuffer(file.buffer, extFor(file.originalname, file.mimetype), file.mimetype);
}

/** Same as saveUploadedFile, but for a buffer generated server-side (e.g.
 * composite.ts's sharp output) rather than one multer parsed from a request. */
export async function saveGeneratedImage(buffer: Buffer, mimetype = "image/jpeg"): Promise<string> {
  return persistBuffer(buffer, mimetype.startsWith("image/png") ? ".png" : ".jpg", mimetype);
}

/** Deletes a previously-saved file given its public URL, from whichever
 * backend it actually lives on — a no-op for URLs this app didn't create
 * (e.g. a Google avatar URL), so it's always safe to call. */
export async function deleteUploadedFile(url: string | null | undefined): Promise<void> {
  if (!url) return;
  const key = keyFromPublicUrl(url);
  if (key) {
    await deleteObject(key);
    return;
  }
  if (url.startsWith("/api/uploads/")) {
    await fs.promises.unlink(path.join(UPLOAD_DIR, path.basename(url))).catch(() => {});
  }
}
