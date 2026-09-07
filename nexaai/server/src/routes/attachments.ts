import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { requireAuth, type AuthedRequest } from "../middleware/auth";

// Real large-file uploads: multer streams the incoming multipart body
// straight to disk (never buffers the whole file in memory), so this
// genuinely supports big video files — not just small base64 JSON blobs
// like the camera-ask flow uses for photos.
//
// HONEST LIMITS: the product brief asks for up to 30GB video uploads. A
// single HTTP request moving tens of gigabytes over a mobile connection is
// not realistic regardless of server code — it needs a resumable/chunked
// upload protocol (e.g. tus) so a dropped connection doesn't restart from
// zero, which this simple endpoint does not implement. MAX_UPLOAD_BYTES
// below defaults to a real, useful 2GB ceiling; raise it if your hosting's
// disk/bandwidth budget supports more, but treat anything beyond a few GB
// over a single request as fragile until a resumable uploader is added.
export const UPLOADS_DIR = path.join(__dirname, "../../uploads");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES) || 2 * 1024 * 1024 * 1024; // 2GB default

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).slice(0, 10);
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({ storage, limits: { fileSize: MAX_UPLOAD_BYTES } });

export const attachmentsRouter = Router();
attachmentsRouter.use(requireAuth);

function attachmentKind(mimeType: string): "image" | "video" | "file" {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  return "file";
}

attachmentsRouter.post("/", (req: AuthedRequest, res) => {
  upload.single("file")(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
          error: "file_too_large",
          message: `That file is over this server's ${(MAX_UPLOAD_BYTES / (1024 * 1024 * 1024)).toFixed(1)}GB upload limit.`,
        });
      }
      return res.status(400).json({ error: "upload_failed", message: err.message });
    }
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const kind = attachmentKind(req.file.mimetype);
    res.status(201).json({
      url: `/uploads/${req.file.filename}`,
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      kind,
    });
  });
});
