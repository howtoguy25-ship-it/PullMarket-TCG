// Derives a short "what NexaAi is doing right now" status label straight
// from the actual content streamed in so far — not a canned rotating
// phrase. Mirrors the structured formats in shared/src/nexaPersona.ts
// (WHO_IS_FORMAT, CODE_BUILD_FORMAT, STRUCTURED_TEXT_FORMAT): as each
// section's bold header appears, or a code fence opens, the label reflects
// it live, the same way Claude Code's own status line names its real
// current step instead of looping a fixed phrase.

const HEADER_LABELS: Record<string, string> = {
  bio: "Writing the bio…",
  "official accounts found": "Checking accounts…",
  sources: "Compiling sources…",
  "how to use this": "Explaining how to use it…",
  reasoning: "Working through the reasoning…",
  steps: "Listing the steps…",
};

const FENCE_LINE = /^```\s*([a-zA-Z0-9_+-]*)\s*(?:filename="([^"]+)")?/;
const HEADER_LINE = /^\*\*(.+?)\*\*$/;

export function deriveLiveStatus(text: string): string {
  const lines = text.split("\n");

  // Inside an unclosed code fence right now (odd number of ``` markers so
  // far) — name the file/language it's writing rather than a generic label.
  const fenceCount = (text.match(/^```/gm) ?? []).length;
  if (fenceCount % 2 === 1) {
    for (let i = lines.length - 1; i >= 0; i--) {
      const match = lines[i].match(FENCE_LINE);
      if (match) {
        const [, lang, filename] = match;
        if (filename) return `Writing ${filename}…`;
        if (lang) return `Writing the ${lang} code…`;
        return "Writing the code…";
      }
    }
    return "Writing the code…";
  }

  // The most recent bold line NexaAi has fully written past — either one of
  // the format's fixed section headers, or (in structured chat mode) a
  // per-approach title, which we name directly since it's real content.
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = lines[i].trim().match(HEADER_LINE);
    if (!match) continue;
    const raw = match[1].trim();
    const key = raw.toLowerCase().replace(/[:.]+$/, "");
    if (HEADER_LABELS[key]) return HEADER_LABELS[key];
    if (raw.length > 0 && raw.length < 60) return `Writing "${raw}"…`;
  }

  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return "Getting started…";
  if (words < 15) return "Getting started…";
  if (words < 60) return "Writing the answer…";
  if (words < 150) return "Filling in the details…";
  return "Wrapping it up…";
}
