import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { UPLOAD_DIR_PATH } from "./upload";

// Same disk-storage contract as lib/upload.ts (served back out at
// /api/uploads/*), but chat attachments are allowed to be photos OR videos,
// unlike listing photos which are images-only.
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR_PATH),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || (file.mimetype.startsWith("video/") ? ".mp4" : ".jpg");
    cb(null, `${randomUUID()}${ext}`);
  },
});

if (!fs.existsSync(UPLOAD_DIR_PATH)) fs.mkdirSync(UPLOAD_DIR_PATH, { recursive: true });

export const chatUpload = multer({
  storage,
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
