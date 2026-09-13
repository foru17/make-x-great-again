import { INVISIBLE_TEXT_CHARACTERS } from "../../../src/text-normalization";

// D1 caps LIKE/GLOB patterns at 50 bytes: spell contiguous controls as ranges
// (44 UTF-8 bytes) rather than expanding the shared character set (73 bytes).
const INVISIBLE_GLOB = "*[\u00ad\u034f\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]*";

// expression is code-owned SQL, never user input. Fast-path ordinary text;
// normalization happens before filtering/counting/paging, including old rows.
export function stripInvisibleSql(expression: string): string {
  const text = `coalesce(${expression},'')`;
  const clean = Array.from(INVISIBLE_TEXT_CHARACTERS).reduce(
    (sql, character) => `replace(${sql},char(${character.codePointAt(0)}),'')`,
    text,
  );
  return `(CASE WHEN ${text} GLOB '${INVISIBLE_GLOB}' THEN ${clean} ELSE ${text} END)`;
}
