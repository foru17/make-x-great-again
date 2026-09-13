import { INVISIBLE_TEXT_CHARACTERS } from "../../../src/text-normalization";

// expression is code-owned SQL, never user input. Fast-path ordinary text;
// normalization happens before filtering/counting/paging, including old rows.
export function stripInvisibleSql(expression: string): string {
  const text = `coalesce(${expression},'')`;
  const clean = Array.from(INVISIBLE_TEXT_CHARACTERS).reduce(
    (sql, character) => `replace(${sql},char(${character.codePointAt(0)}),'')`, text,
  );
  return `(CASE WHEN ${text} GLOB '*[${INVISIBLE_TEXT_CHARACTERS}]*' THEN ${clean} ELSE ${text} END)`;
}
