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
