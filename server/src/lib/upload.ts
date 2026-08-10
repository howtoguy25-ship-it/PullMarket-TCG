import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";

// Local-disk storage for development and small deployments. Render's local
// disk is NOT persistent across deploys/restarts on the free/starter tier —
// for production, point this at an S3-compatible bucket (Cloudflare R2,
// Backblaze B2, AWS S3) instead. Swap the multer.diskStorage below for
// multer-s3 (or upload the buffer to your bucket after receiving it) and
// keep the same /api/uploads/* URL contract.
const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `${randomUUID()}${ext}`);
  },
});

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
