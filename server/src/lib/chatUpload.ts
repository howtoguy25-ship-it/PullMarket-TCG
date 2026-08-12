import multer from "multer";

// Same memory-storage contract as lib/upload.ts (persisted via
// saveUploadedFile, to local disk or object storage depending on
// configuration), but chat attachments are allowed to be photos OR
// videos, unlike listing photos which are images-only.
export const chatUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 4 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/") && !file.mimetype.startsWith("video/")) {
      cb(new Error("Only photo or video attachments are allowed"));
      return;
    }
    cb(null, true);
  },
});

export function attachmentTypeFromMime(mimetype: string): "image" | "video" {
  return mimetype.startsWith("video/") ? "video" : "image";
}
