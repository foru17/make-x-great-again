// Formatting controls frequently inserted into spam to evade visible-text
// matching. Keep this explicit set shared with SQLite; do not strip visible
// punctuation, whitespace or combining marks, or rewrite stored evidence.
export const INVISIBLE_TEXT_CHARACTERS =
  "\u00ad\u034f\u061c\u180e\u200b\u200c\u200d\u200e\u200f" +
  "\u202a\u202b\u202c\u202d\u202e\u2060\u2061\u2062\u2063\u2064" +
  "\u2066\u2067\u2068\u2069\ufeff";
const invisibleText = new RegExp(`[${INVISIBLE_TEXT_CHARACTERS}]`, "g");

export function stripInvisibleText(value: string): string {
  return value.replace(invisibleText, "");
}

const keywordRegexCache = new Map<string, RegExp>();
// Inputs are already stripped and lowercased. ASCII rules keep the server's
// word-boundary protection ("visa" must not match "Visakan").
export function keywordIndex(pattern: string, text: string): number {
  if (!pattern) return -1;
  if (!/^[\x20-\x7f]+$/.test(pattern)) return text.indexOf(pattern);
  let re = keywordRegexCache.get(pattern);
  if (!re) {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    re = new RegExp(`(?<![a-z0-9_])${escaped}(?![a-z0-9_])`);
    if (keywordRegexCache.size >= 512) keywordRegexCache.clear();
    keywordRegexCache.set(pattern, re);
  }
  return re.exec(text)?.index ?? -1;
}

// Map a normalized match back onto raw evidence for excerpts. Unicode case
// folding may expand a character, so measure its normalized UTF-16 length.
export function originalMatchSpan(
  original: string,
  index: number,
  length: number,
): [number, number] {
  let normalizedOffset = 0;
  let rawOffset = 0;
  let start = -1;
  for (const character of original) {
    const size = stripInvisibleText(character).toLowerCase().length;
    if (size && start < 0 && normalizedOffset + size > index) start = rawOffset;
    normalizedOffset += size;
    rawOffset += character.length;
    if (start >= 0 && normalizedOffset >= index + length) return [start, rawOffset - start];
  }
  return [Math.max(0, start), length];
}
