import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import sharp from "sharp";
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

// Long edge cap for uploaded photos — comfortably more detail than any
// screen will display (even zoomed into a single card), while keeping raw
// 12MP+ phone camera output (often 8-10MB) down to a few hundred KB.
const MAX_IMAGE_DIMENSION = 2000;
const IMAGE_QUALITY = 88;

class UploadValidationError extends Error {
  status = 400;
}

// Every uploaded photo (avatars, listing photos, chat images) goes through
// this before it's persisted, so "clean and clear" isn't left to whatever
// the sender's camera/app happened to produce:
//  - .rotate() with no args auto-applies the EXIF orientation tag then
//    drops it — otherwise photos taken holding the phone sideways/upside
//    down render sideways/upside down for everyone else too, since most
//    image viewers respect EXIF orientation but plain <img>/Image
//    rendering in this app doesn't.
//  - resize() caps runaway-large camera output without upscaling anything
//    smaller.
//  - re-encoding as JPEG at a fixed quality means storage size and visual
//    quality are consistent regardless of what the original device sent
//    (some phones send HEIC, very low-quality JPEG, giant PNGs, etc).
//  - sharp only carries metadata into the output when .withMetadata() is
//    called, which this doesn't call — GPS/EXIF metadata is stripped for
//    free as a side effect, which is also the right privacy default for
//    photos strangers on a marketplace are about to see.
// A file that fails to decode here (corrupt data, or a format sharp can't
// read despite passing the image/* mimetype filter) is rejected outright
// rather than silently stored broken.
async function normalizeImage(buffer: Buffer): Promise<Buffer> {
  try {
    return await sharp(buffer)
      .rotate()
      .resize({ width: MAX_IMAGE_DIMENSION, height: MAX_IMAGE_DIMENSION, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: IMAGE_QUALITY, mozjpeg: true })
      .toBuffer();
  } catch (err) {
    console.error("Image normalization failed:", err);
    throw new UploadValidationError("That image couldn't be processed — try a different photo.");
  }
}

/** Persists a file multer parsed (from `upload` or `chatUpload`) to
 * whichever backend is active, returning its public URL. Image uploads are
 * normalized first (see normalizeImage); video attachments pass through
 * unchanged since sharp can't process video. */
export async function saveUploadedFile(file: Express.Multer.File): Promise<string> {
  if (file.mimetype.startsWith("image/")) {
    const normalized = await normalizeImage(file.buffer);
    return persistBuffer(normalized, ".jpg", "image/jpeg");
  }
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
