import { Router } from "express";
import { z } from "zod";
import path from "path";
import sharp from "sharp";
import { authenticateToken } from "../middleware/auth";
import { upload, saveGeneratedImage } from "../lib/upload";
import { CARD_BACKGROUNDS, BACKGROUNDS_DIR, getBackground } from "../lib/cardBackgrounds";

const router = Router();
router.use(authenticateToken);

router.get("/backgrounds", (_req, res) => {
  res.json(CARD_BACKGROUNDS.map((b) => ({ id: b.id, label: b.label, previewUrl: `/api/backgrounds/${b.file}` })));
});

// Composites a scanned/uploaded card photo onto one of the pre-built
// backdrops, cropped to fill the card-shaped placeholder and (usually) given
// a soft drop shadow so it reads as sitting on top rather than pasted flat.
router.post("/card", upload.single("image"), async (req, res) => {
  const schema = z.object({ background: z.enum(CARD_BACKGROUNDS.map((b) => b.id) as [string, ...string[]]) });
  const parsed = schema.safeParse(req.body);
  const file = req.file;
  if (!file) return res.status(400).json({ message: "No image uploaded" });
  if (!parsed.success) return res.status(400).json({ message: "Invalid background choice" });

  const background = getBackground(parsed.data.background)!;

  try {
    const { x, y, width, height } = background.cardRect;
    const radius = 18;

    const cardBuffer = await sharp(file.buffer).resize(width, height, { fit: "cover", position: "attention" }).toBuffer();

    const roundedMask = Buffer.from(`<svg width="${width}" height="${height}"><rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`);
    const roundedCard = await sharp(cardBuffer)
      .composite([{ input: roundedMask, blend: "dest-in" }])
      .png()
      .toBuffer();

    const composites: { input: Buffer; left: number; top: number }[] = [];

    if (background.shadow) {
      const shadowSvg = Buffer.from(
        `<svg width="${width + 40}" height="${height + 40}"><rect x="20" y="24" width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="#000" fill-opacity="0.35"/></svg>`,
      );
      const shadowBuffer = await sharp(shadowSvg).blur(14).toBuffer();
      composites.push({ input: shadowBuffer, left: x - 20, top: y - 20 });
    }

    composites.push({ input: roundedCard, left: x, top: y });

    const outputBuffer = await sharp(path.join(BACKGROUNDS_DIR, background.file))
      .composite(composites)
      .jpeg({ quality: 90 })
      .toBuffer();

    const url = await saveGeneratedImage(outputBuffer, "image/jpeg");
    res.json({ url });
  } catch (err) {
    console.error("Card compositing failed:", err);
    res.status(500).json({ message: "Couldn't apply that background — try again." });
  }
});

export default router;
