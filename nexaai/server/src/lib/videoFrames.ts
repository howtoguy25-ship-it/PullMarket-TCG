// Real video "watching" via frame sampling — Claude's API has no native
// video input at all, so this is the honest, real way to give it something
// to actually look at: extract a handful of real stills spread across the
// video's actual duration (using a real ffmpeg binary, @ffmpeg-installer/ffmpeg
// bundles a static build so this works with no system package install) and
// hand them to the model as real vision content. The reply is grounded in
// sampled frames, not full motion — routes/chat.ts says so plainly in the
// prompt context rather than implying NexaAi watched the whole thing.
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";

const execFileAsync = promisify(execFile);
const FFMPEG_PATH: string = ffmpegInstaller.path;

const FRAME_COUNT = 4;
const SAMPLE_FRACTIONS = [0.15, 0.4, 0.65, 0.9]; // skip the very start/end, where a video is often blank/credits

async function getDurationSeconds(filePath: string): Promise<number> {
  // ffmpeg with no output specified always exits non-zero, but still prints
  // real "Duration: HH:MM:SS.ms" metadata to stderr first — no ffprobe needed.
  try {
    await execFileAsync(FFMPEG_PATH, ["-i", filePath]);
  } catch (err: any) {
    const match = (err?.stderr ?? "").match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (match) {
      const [, h, m, s] = match;
      return Number(h) * 3600 + Number(m) * 60 + Number(s);
    }
  }
  throw new Error("Couldn't read this video's duration.");
}

export interface VideoFrame {
  data: string;
  mediaType: "image/jpeg";
}

/** Extracts up to FRAME_COUNT real JPEG stills spread across the video's actual duration. Throws on any real ffmpeg failure — callers fall back to the honest "can't watch video" note. */
export async function extractVideoFrames(filePath: string): Promise<VideoFrame[]> {
  const durationSeconds = await getDurationSeconds(filePath);
  if (!durationSeconds || durationSeconds < 0.5) throw new Error("Video too short to sample frames from.");

  const tmpDir = path.join(os.tmpdir(), `nexaai-frames-${crypto.randomUUID()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    const frames: VideoFrame[] = [];
    for (let i = 0; i < FRAME_COUNT; i++) {
      const timestamp = Math.max(0.1, durationSeconds * SAMPLE_FRACTIONS[i]);
      const outPath = path.join(tmpDir, `frame-${i}.jpg`);
      await execFileAsync(FFMPEG_PATH, ["-ss", timestamp.toFixed(2), "-i", filePath, "-frames:v", "1", "-q:v", "3", "-y", outPath]);
      if (fs.existsSync(outPath)) {
        frames.push({ data: fs.readFileSync(outPath).toString("base64"), mediaType: "image/jpeg" });
      }
    }
    if (!frames.length) throw new Error("Couldn't extract any frames from this video.");
    return frames;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
