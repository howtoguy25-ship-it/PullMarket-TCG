// Real text extraction for a file attachment (routes/attachments.ts) so the
// model actually reads the document instead of only seeing its filename —
// covers plain text/code/data files directly, and real PDFs via pdf-parse.
// Returns null for anything else (binary formats we have no real reader
// for) so the caller falls back to the honest "can't open this" message
// instead of pretending to have read it.
import fs from "fs";
import { PDFParse } from "pdf-parse";

const TEXT_MIME_PATTERN = /^text\/|^application\/(json|xml|x-yaml|yaml)$/;
const TEXT_EXTENSIONS = /\.(txt|md|markdown|csv|tsv|json|xml|yaml|yml|log|ts|tsx|js|jsx|py|java|c|cpp|h|go|rb|rs|sql|html|css|sh)$/i;

// Keep well under the model's context — a document is context for the
// answer, not the whole conversation.
const MAX_EXTRACTED_CHARS = 8000;

export async function extractFileText(filePath: string, mimeType: string, filename: string): Promise<string | null> {
  if (mimeType === "application/pdf") {
    const parser = new PDFParse({ data: fs.readFileSync(filePath) });
    try {
      const result = await parser.getText();
      return truncate(result.text);
    } finally {
      await parser.destroy();
    }
  }
  if (TEXT_MIME_PATTERN.test(mimeType) || TEXT_EXTENSIONS.test(filename)) {
    return truncate(fs.readFileSync(filePath, "utf8"));
  }
  return null;
}

function truncate(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > MAX_EXTRACTED_CHARS
    ? `${trimmed.slice(0, MAX_EXTRACTED_CHARS)}\n\n[...truncated — the file continues beyond what's shown here]`
    : trimmed;
}
