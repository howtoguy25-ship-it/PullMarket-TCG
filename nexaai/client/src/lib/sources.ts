// Pulls a trailing "**Sources**\n1. Title — URL\n2. ..." block (the exact
// shape both WHO_IS_FORMAT and the topic-images Sources addendum in
// shared/src/nexaPersona.ts produce) out of an assistant reply, so it can be
// rendered as real tappable links (SourceLinksList) instead of plain text
// inside the markdown body.

export interface ParsedSource {
  title: string;
  url: string;
}

const SOURCES_BLOCK_RE = /\n\s*\*\*Sources\*\*\s*\n([\s\S]*)$/i;
const SOURCE_LINE_RE = /^\d+\.\s*(.+?)\s*[—-]\s*(https?:\S+)$/;

export function extractSources(text: string): { mainText: string; sources: ParsedSource[] } {
  const match = text.match(SOURCES_BLOCK_RE);
  if (!match) return { mainText: text, sources: [] };

  const sources: ParsedSource[] = [];
  for (const rawLine of match[1].split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const lineMatch = line.match(SOURCE_LINE_RE);
    if (lineMatch) sources.push({ title: lineMatch[1], url: lineMatch[2] });
  }
  if (!sources.length) return { mainText: text, sources: [] };

  return { mainText: text.slice(0, match.index).trimEnd(), sources };
}
