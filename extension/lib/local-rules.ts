// Local keyword-rule engine — the client-side mirror of the server's
// maintainer-curated pre-LLM fast path (keyword_rules, action='blacklist').
// Rules ship inside the synced lite artifact, so brand-new template accounts
// (porn-bot throwaways created an hour ago, not yet on the public list) get
// flagged on first sight with zero upload.
//
// Two rule origins, matched with identical semantics:
//   "official" — synced with the lite artifact. User-controllable via the
//                master switch (settings.officialRulesEnabled) and per-rule
//                disables (xss:rules:disabled, keyed by pattern). Hits may be
//                anonymously reported when settings.ruleTelemetry is on.
//   "custom"   — user-authored rows in xss:rules:custom. Local-only: never
//                uploaded, never part of telemetry.
//
// Same red line as the server: official rules are HUMAN-CURATED patterns, not
// local guessing — and the same X-auto-translate guard applies: a CJK pattern
// is never matched against tweet text that X itself rendered as a translation
// (attribution marker → tweetsTranslated), because that text may be X's
// translation of a legit foreign tweet. Display names / bios are not
// translated by X, so those fields stay fully matchable.
import { keywordIndex, originalMatchSpan, stripInvisibleText } from "../../src/text-normalization";
import { SPAM_CATEGORIES, type SpamCategory, categoryFromCode } from "./category";
import { SETTINGS_KEY, getSettings } from "./settings";
import type { Label, Signals } from "./types";

/** Lite artifact rule row: [pattern, fieldCode, labelCode+categoryCode]. */
export type LiteRuleRow = [string, string, string];

export type RuleOrigin = "official" | "custom";

export type RuleField = "handle" | "display_name" | "bio" | "tweet" | "any";

export interface LocalRuleHit {
  pattern: string;
  label: Label;
  category: SpamCategory;
  origin: RuleOrigin;
  /** Which field the pattern matched in. */
  field: RuleField;
  /** Excerpt (≤200 chars, original case) of the matched field around the
   *  match — the evidence a maintainer reviews before promoting a hit. */
  matchedText: string;
}

const MATCHED_TEXT_MAX = 200;

/** Window of the original text around the (lower-cased) match position. */
export function matchExcerpt(original: string, lowerIndex: number, patternLength: number): string {
  if (original.length <= MATCHED_TEXT_MAX) return original;
  const half = Math.floor((MATCHED_TEXT_MAX - patternLength) / 2);
  const start = Math.max(0, lowerIndex - half);
  const end = Math.min(original.length, start + MATCHED_TEXT_MAX);
  return `${start > 0 ? "…" : ""}${original.slice(start, end)}${end < original.length ? "…" : ""}`;
}

/** User-authored rule as stored in xss:rules:custom. */
export interface CustomRule {
  pattern: string;
  field: RuleField;
  category: SpamCategory;
}

interface CompiledRule {
  pattern: string;
  patternLower: string;
  patternCJK: boolean;
  field: RuleField;
  label: Label;
  category: SpamCategory;
  origin: RuleOrigin;
}

const FIELD_BY_CODE: Record<string, RuleField> = {
  h: "handle",
  d: "display_name",
  b: "bio",
  t: "tweet",
  a: "any",
};

export const CUSTOM_RULES_KEY = "xss:rules:custom";
export const DISABLED_RULES_KEY = "xss:rules:disabled";
export const MAX_CUSTOM_RULES = 200;
const MAX_CUSTOM_PATTERN_LEN = 200;

const CJK_RE = /[㐀-鿿豈-﫿]/;
const hasCJK = (s: string | undefined | null) => !!s && CJK_RE.test(s);

const RULE_FIELDS: RuleField[] = ["handle", "display_name", "bio", "tweet", "any"];

let officialRules: CompiledRule[] = [];
let customRules: CompiledRule[] = [];
let disabledPatterns = new Set<string>();
let officialEnabled = true;
let configWarmed = false;

function compile(
  pattern: string,
  field: RuleField,
  label: Label,
  category: SpamCategory,
  origin: RuleOrigin,
): CompiledRule {
  return {
    pattern,
    patternLower: stripInvisibleText(pattern).toLowerCase(),
    patternCJK: hasCJK(pattern),
    field,
    label,
    category,
    origin,
  };
}

/** Load official rules from a synced lite artifact (tolerant: bad rows are skipped). */
export function setLocalRules(raw: unknown): void {
  const next: CompiledRule[] = [];
  if (Array.isArray(raw)) {
    for (const row of raw as LiteRuleRow[]) {
      if (!Array.isArray(row) || row.length < 3) continue;
      const [pattern, fieldCode, code] = row;
      if (typeof pattern !== "string" || !pattern) continue;
      const field = FIELD_BY_CODE[String(fieldCode)];
      if (!field) continue; // unknown field must not widen into match-everything
      next.push(
        compile(
          pattern,
          field,
          String(code)[0] === "p" ? "porn_bot" : "spam",
          categoryFromCode(String(code)[1]),
          "official",
        ),
      );
    }
  }
  officialRules = next;
}

/** Sanitize an untrusted stored/imported custom-rule collection. */
export function validateCustomRules(raw: unknown): CustomRule[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomRule[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const { pattern, field, category } = row as Partial<CustomRule>;
    if (typeof pattern !== "string") continue;
    const trimmed = pattern.trim();
    if (!trimmed || trimmed.length > MAX_CUSTOM_PATTERN_LEN) continue;
    if (!field || !RULE_FIELDS.includes(field)) continue;
    if (!category || !SPAM_CATEGORIES.includes(category)) continue;
    const key = `${trimmed.toLowerCase()}${field}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ pattern: trimmed, field, category });
    if (out.length >= MAX_CUSTOM_RULES) break;
  }
  return out;
}

export function setCustomRules(raw: unknown): void {
  customRules = validateCustomRules(raw).map((r) =>
    // Personal rules reuse the category → label mapping the official set
    // uses, so downstream policy (per-category actions) treats both alike.
    compile(r.pattern, r.field, r.category === "porn" ? "porn_bot" : "spam", r.category, "custom"),
  );
}

export function setDisabledPatterns(raw: unknown): void {
  disabledPatterns = new Set(
    Array.isArray(raw) ? raw.filter((p): p is string => typeof p === "string") : [],
  );
}

export function setOfficialRulesEnabled(on: boolean): void {
  officialEnabled = on;
}

export function localRuleCount(): number {
  return officialRules.length;
}

export function customRuleCount(): number {
  return customRules.length;
}

// ---- Options-page storage helpers (writes hot-swap every open tab via the
// storage.onChanged listener below) ----

export async function getCustomRules(): Promise<CustomRule[]> {
  try {
    const got = await chrome.storage.local.get(CUSTOM_RULES_KEY);
    return validateCustomRules(got[CUSTOM_RULES_KEY]);
  } catch {
    return [];
  }
}

export async function saveCustomRules(rules: CustomRule[]): Promise<CustomRule[]> {
  const clean = validateCustomRules(rules);
  await chrome.storage.local.set({ [CUSTOM_RULES_KEY]: clean });
  return clean;
}

export async function getDisabledPatterns(): Promise<string[]> {
  try {
    const got = await chrome.storage.local.get(DISABLED_RULES_KEY);
    const v = got[DISABLED_RULES_KEY];
    return Array.isArray(v) ? v.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

export async function saveDisabledPatterns(patterns: string[]): Promise<void> {
  await chrome.storage.local.set({ [DISABLED_RULES_KEY]: [...new Set(patterns)] });
}

/** Read the user's rule config (master switch / per-rule disables / custom
 *  rules) from storage once. Safe to call repeatedly; live updates flow
 *  through the storage.onChanged listener below. */
export async function warmRuleConfig(): Promise<void> {
  if (configWarmed) return;
  configWarmed = true;
  try {
    const settings = await getSettings();
    officialEnabled = settings.officialRulesEnabled;
    const got = await chrome.storage.local.get([CUSTOM_RULES_KEY, DISABLED_RULES_KEY]);
    setCustomRules(got[CUSTOM_RULES_KEY]);
    setDisabledPatterns(got[DISABLED_RULES_KEY]);
  } catch {
    /* not an extension context (tests) — defaults stand */
  }
}

// Hot-swap: the options page edits rule config in another context; every open
// tab picks the change up without a reload (mirrors local-index's listener).
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[CUSTOM_RULES_KEY]) setCustomRules(changes[CUSTOM_RULES_KEY].newValue);
    if (changes[DISABLED_RULES_KEY]) setDisabledPatterns(changes[DISABLED_RULES_KEY].newValue);
    if (changes[SETTINGS_KEY]) {
      const next = changes[SETTINGS_KEY].newValue as
        | { officialRulesEnabled?: boolean }
        | undefined;
      officialEnabled = next?.officialRulesEnabled !== false;
    }
  });
} catch {
  /* not an extension context (tests) — non-fatal */
}

function matchAgainst(rules: CompiledRule[], s: Signals): LocalRuleHit | null {
  if (!rules.length) return null;
  const handle = stripInvisibleText(s.handle).toLowerCase();
  const name = stripInvisibleText(s.displayName).toLowerCase();
  const bio = stripInvisibleText(s.bio).toLowerCase();
  const tweetsRaw = [...s.recentTweets, s.triggeringComment ?? ""];
  const tweets = tweetsRaw.map((t) => stripInvisibleText(t).toLowerCase());

  for (const r of rules) {
    if (r.origin === "official" && disabledPatterns.has(r.pattern)) continue;
    const p = r.patternLower;
    if (!p) continue;
    // Custom rules retain their documented literal-substring behavior.
    const indexOf = (text: string) => r.origin === "official" ? keywordIndex(p, text) : text.indexOf(p);
    // Translate guard: a CJK pattern must not match text X itself rendered
    // as a translation (attribution marker → tweetsTranslated). That marker
    // is the whole guard — an extra "author profile must also show CJK"
    // belt used to sit here, and a porn ring walked straight through it by
    // pairing Latin/kana display names with Chinese spam text (2026-07-14
    // wave: "sao货…" replies from "Gigi 🌸"-style throwaways). A raw
    // non-CJK tweet can never contain a CJK pattern anyway, so the marker
    // check alone carries no extra false-positive surface for originals.
    const tweetTrusted = !r.patternCJK || !s.tweetsTranslated;
    const any = r.field === "any";
    // Field-aware match so the hit can carry WHERE it matched and an excerpt
    // (the maintainer's evidence when reviewing telemetry). Same precedence
    // as the old boolean chain: handle → display name → bio → tweets.
    let field: RuleField | undefined;
    let text = "";
    let at = -1;
    if ((any || r.field === "handle") && (at = indexOf(handle)) >= 0) {
      field = "handle";
      text = s.handle;
    } else if ((any || r.field === "display_name") && (at = indexOf(name)) >= 0) {
      field = "display_name";
      text = s.displayName;
    } else if ((any || r.field === "bio") && (at = indexOf(bio)) >= 0) {
      field = "bio";
      text = s.bio;
    } else if ((any || r.field === "tweet") && tweetTrusted) {
      const i = tweets.findIndex((t) => indexOf(t) >= 0);
      if (i >= 0) {
        field = "tweet";
        text = tweetsRaw[i] ?? "";
        at = indexOf(tweets[i] ?? "");
      }
    }
    if (field) {
      const [rawIndex, rawLength] = originalMatchSpan(text, Math.max(0, at), p.length);
      return {
        pattern: r.pattern,
        label: r.label,
        category: r.category,
        origin: r.origin,
        field,
        matchedText: matchExcerpt(text, rawIndex, rawLength),
      };
    }
  }
  return null;
}

/** First matching blacklist rule for these signals, or null. Official rules
 *  (minus user-disabled ones) win over custom rules so telemetry and the
 *  server's own stats stay aligned on the shared vocabulary. */
export function matchLocalRules(s: Signals): LocalRuleHit | null {
  if (officialEnabled) {
    const hit = matchAgainst(officialRules, s);
    if (hit) return hit;
  }
  return matchAgainst(customRules, s);
}
