// Map raw LLM verdict reasons (English sentences from the classifier) into
// a small number of Chinese display categories so the management panel
// can show a tight color-coded chip instead of a long English string.
//
// The classifier itself is not changed — categorization happens at display
// time. Categories are heuristic; when no rule matches, falls back to 「其它」.
// Hover the chip in the UI to see the raw original reason.

export type ReasonTone = "violet" | "warn" | "danger" | "amber" | "neutral" | "gray";

export interface ReasonCategory {
  /** stable id, used for analytics / future grouping */
  key: "sex" | "redirect" | "ad" | "newacc" | "filler" | "other";
  /** Chinese label shown on the chip */
  zh: string;
  /** Color tone (maps to a token via Tailwind in the panel) */
  tone: ReasonTone;
}

const RULES: Array<[RegExp, ReasonCategory]> = [
  // 色情招揽 — covers most of the porn-bot patterns we see (display name,
  // bio, recent tweets all funnel into these wording families)
  [
    /sexual|porn|hookup|escort|solicit|sex\b|约\b|涩|色情|同城|线下|裸/i,
    { key: "sex", zh: "色情招揽", tone: "violet" },
  ],
  // 引流话术 — "look at my profile" / "DM me" / bio link redirect bait
  [
    /redirect|看主页|加我|主页|bio[- ]?link|引流|私聊|私信|看简介|进群|进裙|DM\s/i,
    { key: "redirect", zh: "引流话术", tone: "warn" },
  ],
  // 垃圾广告 — promotional / crypto / telegram / link spam
  [
    /promot|advert(?:is|y)|telegram|crypto|bitcoin|btc|eth|wallet|airdrop|广告|推广|空投/i,
    { key: "ad", zh: "垃圾广告", tone: "danger" },
  ],
  // 新号特征 — default avatar / brand-new account / suspiciously low stats
  [
    /new\s+account|default\s+avatar|no\s+followers|low\s+engagement|brand[- ]new|account\s+age|新号|新注册|无粉丝|无关注|无头像/i,
    { key: "newacc", zh: "新号特征", tone: "amber" },
  ],
  // 填充乱码 / mention bait — garbled characters, random padding, @mention redirect
  [
    /garbled|filler|random\s+chars?|padded?|@mention|乱码|填充|混淆/i,
    { key: "filler", zh: "填充乱码", tone: "neutral" },
  ],
];

const FALLBACK: ReasonCategory = { key: "other", zh: "其它", tone: "gray" };

/** Categorize a single LLM reason string. Empty / null → 其它. */
export function categorizeReason(reason?: string | null): ReasonCategory {
  if (!reason) return FALLBACK;
  for (const [pat, cat] of RULES) if (pat.test(reason)) return cat;
  return FALLBACK;
}

/** Given a list of reasons (a verdict can have several), pick the dominant
 *  category. We prefer the most severe matching rule (rules are ordered by
 *  signal severity), falling back to the first hit. */
export function categorizeReasons(reasons: readonly (string | null | undefined)[]): ReasonCategory {
  for (const r of reasons) {
    if (!r) continue;
    for (const [pat, cat] of RULES) if (pat.test(r)) return cat;
  }
  return FALLBACK;
}

/** Tailwind class for the chip tone — keep next to the rules so the two
 *  stay in sync. */
export function toneClasses(tone: ReasonTone): string {
  switch (tone) {
    case "violet":
      return "text-violet border-violet/40 bg-violet/8";
    case "warn":
      return "text-warn border-warn/40 bg-warn/8";
    case "danger":
      return "text-danger border-danger/40 bg-danger/8";
    case "amber":
      return "text-warn border-warn/30 bg-warn/6";
    case "neutral":
      return "text-fg-2 border-border-2 bg-card-hi";
    default:
      return "text-fg-3 border-border bg-card";
  }
}
