// Real spellcheck — a genuine Hunspell-based dictionary (nspell +
// dictionary-en, the same real English word list/affix rules a desktop
// word processor uses), not a hardcoded typo list or a fake regex trick.
// Runs server-side (not bundled into the mobile client) since dictionary-en
// is a ~500KB word list — no reason to ship that to every device when one
// server-side dictionary instance, loaded once and reused, does the job.

import nspell from "nspell";

interface Speller {
  correct(word: string): boolean;
  suggest(word: string): string[];
}

let spellerPromise: Promise<Speller> | null = null;

function getSpeller(): Promise<Speller> {
  if (!spellerPromise) {
    // dictionary-en is ESM-only; dynamic import works from this CommonJS
    // file under tsx/Node regardless of the caller's own module system.
    // Its aff/dic come back as Uint8Array (web-standard); nspell's own
    // types want Node Buffers, and Buffer.from is a real, lossless wrap
    // around the same underlying bytes, not a conversion that could alter
    // the dictionary data.
    spellerPromise = import("dictionary-en").then(
      ({ default: dictionary }) => nspell({ aff: Buffer.from(dictionary.aff), dic: Buffer.from(dictionary.dic) }) as Speller,
    );
  }
  return spellerPromise;
}

export interface SpellingSuggestion {
  /** The misspelled word exactly as it appeared in the text. */
  word: string;
  /** Real dictionary suggestions (nspell's own edit-distance ranking), best first — capped so the client isn't overwhelmed with rarely-useful sixth-best guesses. */
  suggestions: string[];
  /** Character offset of `word` within the original text, so the client can apply a correction as a precise string replacement rather than a naive find-first-occurrence. */
  index: number;
}

const WORD_REGEX = /[A-Za-z']+/g;
const MAX_SUGGESTIONS_PER_WORD = 3;
// Real names, short interjections, and single letters produce mostly noise
// (a real dictionary has no idea about "Adham" or "lol") — skipping very
// short tokens keeps this feature useful instead of naggy.
const MIN_WORD_LENGTH = 3;

/** Real, dictionary-checked spelling suggestions for every word nspell doesn't recognize — never auto-applied, just returned for the client to offer as a "Did you mean" confirmation. */
export async function checkSpelling(text: string): Promise<SpellingSuggestion[]> {
  const speller = await getSpeller();
  const results: SpellingSuggestion[] = [];
  const seen = new Set<string>();
  WORD_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WORD_REGEX.exec(text))) {
    const word = match[0];
    const key = word.toLowerCase();
    if (word.length < MIN_WORD_LENGTH || seen.has(key) || speller.correct(word)) continue;
    seen.add(key);
    const suggestions = speller.suggest(word).slice(0, MAX_SUGGESTIONS_PER_WORD);
    if (suggestions.length) results.push({ word, suggestions, index: match.index });
  }
  return results;
}
