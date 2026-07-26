import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { ANALYTICS_CSP, googleAnalyticsHead } from "./analytics";
import { isArtifactIdentityValid } from "./artifact-identity";
import { BRAND } from "./brand";
import { adminHtml } from "./pages/admin";
import { landingHtml } from "./pages/landing";
import { listHtml } from "./pages/list";

// Runtime bindings are generated from wrangler.toml in
// worker-configuration.d.ts. Only secrets (which intentionally do not live in
// config) are declared by hand here.
interface Secrets {
  // LLM provider config — ALL three are Worker secrets (NOT in wrangler.toml).
  // The provider URL + model name are treated as sensitive (so the project can
  // be open-sourced without doxxing the inference dependency); the API key
  // obviously also is.
  //   wrangler secret put LLM_API_BASE   (OpenAI-compatible /chat/completions)
  //   wrangler secret put LLM_API_MODEL  (model id)
  //   wrangler secret put LLM_API_KEY    (bearer token)
  LLM_API_BASE: string;
  LLM_API_MODEL: string;
  LLM_API_KEY: string;
  // "1" => enforce GitHub auth on classify/report/confirm. Keep this in sync
  // with the currently shipped extension's login flow.
  REQUIRE_AUTH?: string;
  ADMIN_TOKEN?: string; // bearer for the admin moderation endpoints
  AGENT_TOKEN?: string; // bearer for the side-channel agent endpoints (/v1/agent/*)
  // HMAC salt for reporter anti-abuse fingerprints. Keep as a Worker secret;
  // raw reporter identities must never be persisted in reports/review_log.
  REPORT_SALT?: string;
  // Fine-grained GitHub PAT scoped to Contents:Write on the upstream repo,
  // used by the scheduled handler to mirror the curated whitelist /
  // blacklist to data/*.json. Unset = mirror is disabled and the cron is a
  // no-op (the public /v1/whitelist endpoint still works).
  WHITELIST_SYNC_TOKEN?: string;
  WHITELIST_SYNC_REPO?: string; // "owner/repo", defaults to foru17/make-x-great-again
  // Required data-only branch for the GitHub mirror. There is deliberately no
  // default: omitting a branch from GitHub's Contents API writes to the repo's
  // default branch, which a scheduled data export must never do implicitly.
  WHITELIST_SYNC_BRANCH?: string;
  // Optional override for the global hourly LLM-call ceiling (see
  // LLM_GLOBAL_MAX_PER_WINDOW below).
  LLM_GLOBAL_MAX_PER_WINDOW?: string;
}

type Bindings = Env & Secrets;
type Ctx = Context<{ Bindings: Bindings }>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function logError(event: string, error: unknown, details: Record<string, unknown> = {}): void {
  console.error(JSON.stringify({ event, error: errorMessage(error), ...details }));
}

function logWarn(event: string, details: Record<string, unknown> = {}): void {
  console.warn(JSON.stringify({ event, ...details }));
}

function logInfo(event: string, details: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event, ...details }));
}

const AUTO_CONF = 0.9; // AI confidence floor for auto-publish
const AUTO_REPORTERS = 3; // distinct GitHub reporters required for auto-publish
// Confidence floor for AI-only auto-publish on the /v1/classify path (no
// reporter corroboration needed). Validated 2026-06-12 against 100 random
// pending candidates: fresh-classify spam/porn_bot verdicts were ~93% precise
// with zero clear false positives at conf>=0.9; the bar is set at 0.95 for
// extra public-list safety. Lower to 0.9 to widen coverage. This path is the
// mirror of the auto_legit fast-accept and is DELIBERATELY separate from the
// report path, whose inherited verdicts are the noisy ones (kept manual-only).
const AUTO_AI_PUBLISH_CONF = 0.95;
// High-reach guard for EVERY auto-publish path (ai / rule / mention /
// apply-to-queue). Accounts at this follower count are overwhelmingly real
// humans/brands/creators (2026-07-24 audit: 23% of queued ≥100k spam verdicts
// were outright false positives — official brand accounts, celebrities,
// disclosed-ad posts — rising to 37% in the top follower band), and a wrong
// publish against a big account is maximally visible. They can still be
// blacklisted — only via the maintainer queue, never automatically. NULL
// followers (handle-only rows, legacy payloads) pass: the guard exists for
// accounts we positively KNOW are high-reach.
const AUTO_PUBLISH_MAX_FOLLOWERS = 100_000;

// The only verdict labels that may ever reach the public list through an
// automatic path. Rules can be configured with 'uncertain'/'legit' labels
// (e.g. as annotations); before 2026-07-24 a 'blacklist' rule carrying such a
// label still published — that's how uncertain-verdict rows ended up on the
// public artifact. Every auto-publish path funnels through this check now.
const AUTO_PUBLISH_LABELS = new Set(["spam", "porn_bot", "likely_spam"]);

/** Central eligibility check for ALL automatic publishes (human decisions are
 *  never subject to it). Label must be a spam label, and a known follower
 *  count must be under the high-reach cap. */
function autoPublishEligible(label: string, followers: number | null | undefined): boolean {
  if (!AUTO_PUBLISH_LABELS.has(label)) return false;
  if (typeof followers === "number" && followers >= AUTO_PUBLISH_MAX_FOLLOWERS) return false;
  return true;
}
// GH accounts younger than this don't count toward the auto-publish
// reporter threshold. Their reports are still stored (audit /
// future re-evaluation), but a fresh throwaway account can't help flip
// status to human_confirmed. 90d is a common drive-by abuse cutoff.
const REPORTER_MIN_AGE_DAYS = 90;
// Max handles a single keyword-rule hit may auto-promote from a post's
// @-mentions. Caps the blast radius of a forged tweet that lists many victims;
// mention-promotion is also gated on an aged reporter identity at the call site.
const MENTION_PROMOTE_MAX = 3;
const REPORT_WINDOW_MS = 60 * 60_000;
const REPORT_MAX_PER_WINDOW = 10;
// /v1/classify is the cost endpoint — cap it per reporter fingerprint (or per
// IP when anonymous). The cap gates ONLY the LLM path: cache/TTL reuse and
// keyword-rule hits short-circuit before the throttle (see the handler), so a
// browser extension scanning a timeline burns budget only on genuinely-novel
// accounts. Sized for that — 60 fresh classifications/hour/identity is ample
// headroom for real discovery while still bounding worst-case LLM spend.
// /v1/appeal is fully unauthenticated, so it gets a tighter per-IP cap.
const CLASSIFY_MAX_PER_WINDOW = 60;
// Keyword-rule hits skip the LLM but are still a WRITE path: a hit can mint a
// brand-new public-list row (tier 'rule') from nothing but a client-supplied
// payload, and the patterns ship in the public lite artifact — so an attacker
// can craft guaranteed hits. Without its own cap this branch is an unmetered
// anonymous publish/write channel (the LLM throttle never sees it). Legit
// clients only land here for genuinely-new accounts (repeats return via the
// cache/TTL reuse first), so a generous per-identity cap is invisible to real
// browsing while bounding forged-payload floods.
const RULE_WRITE_MAX_PER_WINDOW = 30;
// Global (cross-identity) LLM calls per hour — the hard spend ceiling behind
// the per-identity classify cap (which an anonymous caller can reset by
// rotating IPs). Override with the LLM_GLOBAL_MAX_PER_WINDOW env var.
const LLM_GLOBAL_MAX_PER_WINDOW = 2000;
const APPEAL_MAX_PER_WINDOW = 5;
const BLOOM_SIZE = 65_536; // 8 KB bit array
const BLOOM_HASHES = 7;
// Per-status freshness TTL gating LLM re-classification on /v1/classify.
// The cache key (signals_hash) includes recentTweets, so it busts on every
// new tweet — and the same spam account is seen by many viewers with slightly
// different timelines. Without a TTL one account gets re-classified dozens of
// times. An account that already has a verdict is reused (no LLM) until its
// status' TTL lapses. Terminal/settled statuses (human/agent decisions) are
// never re-scored: writeAccount preserves them anyway, so re-running the LLM
// only burns tokens. An exact signals_hash match still returns cached for ANY
// status regardless of these TTLs.
const NEVER_RESCORE = Number.POSITIVE_INFINITY;
const RESCORE_TTL_MS: Record<string, number> = {
  human_confirmed: NEVER_RESCORE,
  rejected: NEVER_RESCORE,
  removed: NEVER_RESCORE,
  whitelisted: NEVER_RESCORE, // also short-circuited earlier; here for safety
  agent_whitelist: NEVER_RESCORE,
  agent_blacklist: NEVER_RESCORE,
  auto_legit: 30 * 86_400_000, // legit rarely flips; re-check monthly at most
  auto_pending_review: 24 * 3_600_000, // still ambiguous — allow a daily re-look
  agent_pending: 7 * 86_400_000,
};
const BLOOM_SHARD_SIZE = 500; // accounts per logical shard in the JSON artifact

interface PublishedShardEntry {
  userId: string | null;
  handle: string;
  label: string;
  confidence: number;
  published_at: number;
  /** 'human' = maintainer-reviewed; 'auto' = AI/rule/mention auto-publish.
   *  Clients must only auto-act (mute/block) on 'human' entries. */
  tier: "human" | "auto";
}

interface Reporter {
  /** Stable id, namespaced. `gh:<numeric>` for GitHub, `anon` when enforcement off. */
  id: string;
  /** GH account age in days at the moment of this request. 0 for anon. */
  ageDays: number;
}

/** Verify a GitHub token → reporter id + account age.
 *  null = invalid identity (token rejected by GitHub). */
async function ghIdentity(req: Request): Promise<Reporter | null> {
  const auth = req.headers.get("authorization") ?? "";
  const tok = auth.replace(/^Bearer\s+/i, "").trim();
  if (!tok) return null;
  try {
    const r = await fetch("https://api.github.com/user", {
      headers: {
        authorization: `Bearer ${tok}`,
        "user-agent": "mxga",
        accept: "application/vnd.github+json",
      },
    });
    if (!r.ok) return null;
    const u = (await r.json()) as { id?: number; created_at?: string };
    if (!u.id) return null;
    const ageDays = u.created_at
      ? Math.max(0, Math.floor((Date.now() - new Date(u.created_at).getTime()) / 86_400_000))
      : 0;
    return { id: `gh:${u.id}`, ageDays };
  } catch {
    return null;
  }
}

/** Enforce identity only when REQUIRE_AUTH is on. Returns reporter id (or
 *  "anon" when enforcement is off and no token). null => reject. */
async function requireReporter(c: Ctx): Promise<Reporter | null> {
  const ident = await ghIdentity(c.req.raw);
  if (ident) return ident;
  return c.env.REQUIRE_AUTH === "1" ? null : { id: "anon", ageDays: 0 };
}

async function reporterFingerprint(env: Bindings, reporterId: string): Promise<string | null> {
  const salt = env.REPORT_SALT?.trim();
  if (!salt) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(salt),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(reporterId));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return `rpt:${hex.slice(0, 32)}`;
}

function reporterActor(fp: string): string {
  return `reporter:${fp.slice(4, 16)}`;
}

function reporterAliases(fp: string, reporterId: string): [string, string] {
  const legacy = reporterId.startsWith("gh:") ? reporterId : fp;
  return legacy === fp ? [fp, fp] : [fp, legacy];
}

const Signals = z.object({
  // X numeric user id — immutable, the canonical identity key. Optional
  // because the fiber-walk that extracts it from X's React state fails on
  // some feed/reply contexts; we still accept handle-only payloads but the
  // worker logs and cleans those up at write-time (see writeAccount). When
  // present, must be the digit-only id — matches the Node-side schema in
  // `src/schema.ts` and tightens what was previously z.string().optional().
  userId: z.string().regex(/^\d+$/, "userId must be the X numeric id").optional(),
  // Real X handles are 1-15 chars of [A-Za-z0-9_]. Accept one leading "@"
  // (normalizeHandle strips it at write-time) but reject anything else — a
  // handle containing "|" would corrupt the admin UI's "uid|handle" keys.
  handle: z
    .string()
    .trim()
    .regex(/^@?[A-Za-z0-9_]{1,15}$/, "handle must be a valid X handle"),
  // Free-text fields are TRUNCATED (not rejected) so a legit client sending a
  // long premium tweet still classifies, while a hostile/broken client can't
  // pad the LLM prompt to burn input tokens. Bounds total prompt to a few KB.
  displayName: z.string().transform((s) => s.slice(0, 200)).default(""),
  bio: z.string().transform((s) => s.slice(0, 500)).default(""),
  recentTweets: z.array(z.string().transform((s) => s.slice(0, 500))).max(20).default([]),
  triggeringComment: z.string().transform((s) => s.slice(0, 1000)).optional(),
  threadTopic: z.string().transform((s) => s.slice(0, 500)).optional(),
  accountCreatedAt: z.string().max(80).optional(),
  accountAgeDays: z.number().optional(),
  followersCount: z.number().optional(),
  followingCount: z.number().optional(),
  hasDefaultAvatar: z.boolean().optional(),
  avatarUrl: z.string().optional(),
  viewerFollowing: z.boolean().optional(),
  viewerBlocking: z.boolean().optional(),
  viewerMuting: z.boolean().optional(),
  viewerFollowRequestSent: z.boolean().optional(),
  viewerIsSelf: z.boolean().optional(),
  // Client-side hint: the tweet texts in this payload were machine-translated
  // by X's auto-translate before the client scraped them (the DOM shows the
  // translation, the original is not available). When set, keyword rules must
  // not match CJK patterns against the tweet text and the LLM is told the
  // text is a translation. Optional — legacy clients never send it.
  tweetsTranslated: z.boolean().optional(),
});
type Signals = z.infer<typeof Signals>;

// Canonical spam category taxonomy. Stored in accounts.category, published in
// the lite artifact, and used by the extension's per-category action policy
// (e.g. auto-block porn bots but only badge marketing accounts).
const SPAM_CATEGORIES = ["porn", "crypto", "gambling", "resource", "marketing", "other"] as const;
type SpamCategory = (typeof SPAM_CATEGORIES)[number];

// Single-char codes used in the lite artifact to keep entries tiny.
const CATEGORY_CODE: Record<SpamCategory, string> = {
  porn: "p",
  crypto: "c",
  gambling: "g",
  resource: "r",
  marketing: "m",
  other: "o",
};

const CJK_RE = /[㐀-鿿豈-﫿]/;
function hasCJK(s: string | null | undefined): boolean {
  return !!s && CJK_RE.test(s);
}

// Category resolution is LLM-first by design: the classifier outputs an
// explicit category, and keyword-rule hits use the category the maintainer
// set on the rule (human curation). There is deliberately NO keyword-based
// category guessing here — pattern matching on free text misclassifies, so
// anything without an authoritative category stays NULL and is later filled
// by the LLM backfill sweep (backfillCategories in the cron).
//
// The only non-LLM mapping kept is label-level: porn_bot IS the porn
// category by definition of the label.
function categoryForLabel(label: string): SpamCategory | null {
  return label === "porn_bot" ? "porn" : null;
}

// Category for a keyword-rule hit: the maintainer's explicit rule.category,
// else the label-level mapping, else NULL (LLM backfill picks it up).
function categoryForRule(rule: KeywordRule): SpamCategory | null {
  if (rule.category && (SPAM_CATEGORIES as readonly string[]).includes(rule.category)) {
    return rule.category as SpamCategory;
  }
  return categoryForLabel(rule.verdict_label);
}

const Verdict = z.object({
  label: z.enum(["spam", "porn_bot", "likely_spam", "uncertain", "legit"]),
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.string()).min(1).max(6),
  // Optional so old cached conversations / lenient models still parse; the
  // classify path falls back to inferCategory when absent.
  category: z.enum(SPAM_CATEGORIES).optional(),
});
type Verdict = z.infer<typeof Verdict>;

const SYSTEM = `You classify X (Twitter) accounts ONLY for spam / porn-advertising-bot abuse.
- Judge ONLY commercial spam and pornographic-advertising bot behavior; NEVER viewpoints/politics/identity.
- Weight account age as a SOFT prior, NOT a veto. New accounts (<30d) with promo / escort wording → very likely bot. Old accounts (>730d) lean legit ONLY when the actual content is benign. Hijacked, bought, and aged-up accounts are common — judge the content first, registration date second.
- CONTENT-OVER-AGE OVERRIDE: if the triggering comment matches the linkless-redirect-bait pattern below, account age is IRRELEVANT. A 10-year-old hijacked account posting redirect bait is still spam. Do not let "OLD established account" outvote a blatant template.
- If threadTopic is given and the reply is off-topic AND promotional/sexual/link-spam, that mismatch is a strong spam signal.
- LINKLESS REDIRECT BAIT (very common, do NOT rate this "uncertain"): a short
  reply that is sexual innuendo or solicitation ("她好涩", "我不行了", "约",
  "看主页", "主页能打", "sao货", "线下", "比她好看", "没她骚", "第一骚",
  "刷了半天", "涩货") PLUS an @mention redirecting to another account,
  often padded with garbled filler chars (a[ pz l' ~t !+ qw fg* u[v ]!] =t),
  and unrelated to the thread topic, is a porn/spam amplifier bot even with NO
  link and NO platform name → label porn_bot or spam, confidence >= 0.85.
  Repetition of the same template or same @target across replies corroborates.
- When genuinely unsure prefer "uncertain" over a false accusation — but the
  linkless-redirect-bait pattern above is NOT "unsure", it is spam.
- TRANSLATION TRAP: X auto-translates tweets, so tweet text may be a machine
  translation of the account's real language (the payload flags this when the
  client knows: "note: tweet texts are machine-translated"). A Chinese-looking
  tweet from an account whose bio/display name are clearly another language is
  probably translated — judge the CONTENT, and never treat the mere presence of
  Chinese wording as a spam signal in that case. This holds EVEN WITHOUT the
  flag (older clients don't send it): never infer "hijacked account", "language
  mismatch" or "farm account" from the tweet language alone.
- AVATAR CAVEAT: hasDefaultAvatar is unreliable — the scraper frequently fails
  to load real avatars (verified official accounts have arrived flagged as
  default-avatar). NEVER cite a default avatar as evidence of a hijacked,
  bought, or fake account, and never let it raise confidence.
- LEGIT COMMERCE IS NOT SPAM: an account promoting ITS OWN products, content,
  or services is not spam — official brand/company accounts posting their own
  campaigns or giveaways, creators posting disclosed sponsorships (【PR】, #ad,
  #sponsored, *publi), streamers/artists/authors linking their own channels,
  commissions, or releases, and paid "Promoted" ads surfacing inside unrelated
  threads. Off-topic promotion alone is NOT enough for spam: it becomes spam
  when it baits to THIRD-PARTY funnels (link farms, referral/affiliate codes,
  Telegram groups, pirated resources) or repeats template-style across
  unrelated threads.
- HIGH-REACH CAUTION: for accounts with followers >= 100000, a false
  accusation is maximally harmful and true spam at that reach is rare — such
  accounts are usually real celebrities, brands, media, or creators. Require
  hard content evidence (an explicit scam/solicitation template, third-party
  bait funnel) before any spam label; a lopsided follower ratio, default
  avatar, or an off-topic ad is NOT enough. When in doubt at this reach,
  prefer "uncertain" or "legit".
- category (required when label is spam/porn_bot/likely_spam): the dominant
  spam business — "porn" (sexual solicitation/porn bots), "crypto" (coins,
  trading, airdrops, stocks), "gambling" (casino/betting), "resource" (netdisk
  / pirated-resource bait), "marketing" (ads, follower-farming, promo matrix,
  redirect bait for generic promotion), "other" (none of the above).
Return ONLY JSON: {"label":"spam|porn_bot|likely_spam|uncertain|legit","confidence":<0..1>,"reasons":[1-6 short strings],"category":"porn|crypto|gambling|resource|marketing|other"}`;

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
const sigHash = (s: Signals) =>
  hash(
    JSON.stringify([
      s.handle,
      s.displayName,
      s.bio,
      s.recentTweets,
      s.hasDefaultAvatar ?? 0,
      s.accountAgeDays ?? -1,
    ]),
  );

/** MurmurHash3-like 32-bit hash (deterministic, fast). */
function murmur32(key: string, seed: number): number {
  let h = seed;
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 0x5bd1e995);
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
  }
  return h >>> 0;
}

function buildBloom(items: string[]): Uint8Array {
  const bits = new Uint8Array(BLOOM_SIZE);
  for (const item of items) {
    for (let h = 0; h < BLOOM_HASHES; h++) {
      const pos = murmur32(item, h * 0x9e3779b9) % (BLOOM_SIZE * 8);
      bits[pos >>> 3] |= 1 << (pos & 7);
    }
  }
  return bits;
}

function bloomToBase64(bits: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bits.length; i++) binary += String.fromCharCode(bits[i] ?? 0);
  return btoa(binary);
}

function userPrompt(s: Signals): string {
  const meta = [
    s.accountAgeDays !== undefined ? `accountAgeDays=${s.accountAgeDays}` : "",
    s.followersCount !== undefined ? `followers=${s.followersCount}` : "",
    s.followingCount !== undefined ? `following=${s.followingCount}` : "",
    s.hasDefaultAvatar !== undefined ? `hasDefaultAvatar=${s.hasDefaultAvatar}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `handle: @${s.handle}
displayName: ${s.displayName || "(empty)"}
bio: ${s.bio || "(empty)"}
${meta ? `signals: ${meta}\n` : ""}${s.tweetsTranslated ? "note: tweet texts are machine-translated by X auto-translate; the original language text was not available\n" : ""}threadTopic: ${s.threadTopic ?? "(none)"}
triggeringComment: ${s.triggeringComment ?? "(none)"}
recentTweets:
${s.recentTweets.map((t, i) => `  ${i + 1}. ${t}`).join("\n") || "  (none)"}`;
}

/**
 * Pull the verdict object out of a raw completion. Reasoning models (minimax,
 * deepseek, …) wrap the answer in ```json fences, prepend chain-of-thought
 * prose that itself contains braces ("the account {@handle} looks off"), or
 * emit an echo object before the real one — a greedy first-`{`…last-`}` match
 * mis-parses all of these. Instead scan for every string-aware brace-balanced
 * {...} span and return the first that parses AND carries a "label" key, so
 * stray braces in prose/strings can't derail it.
 */
function extractVerdictJson(txt: string): unknown {
  const objs: string[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
    } else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}" && depth > 0) {
      depth--;
      if (depth === 0 && start !== -1) {
        objs.push(txt.slice(start, i + 1));
        start = -1;
      }
    }
  }
  for (const c of objs) {
    try {
      const o = JSON.parse(c);
      if (o && typeof o === "object" && "label" in o) return o;
    } catch {
      // not valid JSON (prose with braces) — keep scanning
    }
  }
  for (let i = objs.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(objs[i]);
    } catch {
      // ignore
    }
  }
  throw new Error(`no JSON object in model output: ${txt.slice(0, 200)}`);
}

interface ChatChoice {
  message: { content?: string | null; reasoning_content?: string | null };
  finish_reason?: string;
}

async function classify(env: Bindings, s: Signals): Promise<Verdict> {
  const messages: { role: string; content: string }[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: userPrompt(s) },
  ];

  let lastErr: unknown;
  // Two attempts: a single self-correcting retry recovers from a malformed or
  // truncated first answer (re-asking concisely also dodges runaway reasoning).
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${env.LLM_API_BASE}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.LLM_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: env.LLM_API_MODEL,
        temperature: 0,
        // Reasoning models (e.g. deepseek-v4-pro, minimax-m3) spend tokens on
        // hidden reasoning that counts toward max_tokens; give ample headroom
        // so the JSON answer is never truncated under high reasoning effort.
        max_tokens: 4096,
        thinking: { type: "enabled" },
        reasoning_effort: "high",
        messages,
      }),
    });
    if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { choices: ChatChoice[] };
    const choice = j.choices[0];
    // Some reasoning models leave `content` empty and put the answer (or just
    // the JSON) in `reasoning_content` — fall back to it before giving up.
    const txt = (choice?.message?.content || choice?.message?.reasoning_content || "").trim();
    try {
      return Verdict.parse(extractVerdictJson(txt));
    } catch (err) {
      lastErr = err;
      const truncated = choice?.finish_reason === "length";
      messages.push(
        { role: "assistant", content: txt.slice(0, 2000) },
        {
          role: "user",
          content: truncated
            ? "Your reply was cut off. Reply with ONLY the compact JSON verdict object, no reasoning, no markdown fences."
            : "That was not valid. Reply with ONLY the JSON verdict object in the exact required shape, no prose, no markdown fences.",
        },
      );
    }
  }
  throw new Error(`LLM did not return a valid verdict: ${String(lastErr)}`);
}

function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@+/, "").toLowerCase();
}

function evidenceText(s: Signals): string | null {
  return (s.triggeringComment ?? s.recentTweets[0] ?? s.bio ?? "").trim().slice(0, 240) || null;
}

function reportEvidence(s: Signals): string {
  return JSON.stringify({
    signalsHash: sigHash(s),
    snippet: evidenceText(s),
    accountAgeDays: metricInt(s.accountAgeDays),
    followersCount: metricInt(s.followersCount),
    followingCount: metricInt(s.followingCount),
    hasDefaultAvatar: s.hasDefaultAvatar ?? null,
  }).slice(0, 1000);
}

// Count rate_log entries for a fingerprint pair inside the window. Degrades
// gracefully (count 0) when the rate_log table hasn't been migrated yet — a
// partially-migrated DB must not 500 the public endpoints.
async function rateLogCount(
  env: Bindings,
  keys: [string, string],
  windowStart: number,
): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT count(*) n FROM rate_log WHERE fp IN (?,?) AND created_at>=?",
  )
    .bind(keys[0], keys[1], windowStart)
    .first<{ n: number }>()
    .catch((err) => {
      logError("rate_log.lookup_failed", err, { fallback: "empty" });
      return null;
    });
  return row?.n ?? 0;
}

async function reportRate(
  env: Bindings,
  aliases: [string, string],
  now: number,
): Promise<{ ok: boolean; remaining: number }> {
  const count = await rateLogCount(env, aliases, now - REPORT_WINDOW_MS);
  return {
    ok: count < REPORT_MAX_PER_WINDOW,
    remaining: Math.max(0, REPORT_MAX_PER_WINDOW - count),
  };
}

async function recordReportRate(env: Bindings, fp: string, now: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO rate_log (fp, created_at) VALUES (?,?)").bind(fp, now),
    env.DB.prepare("DELETE FROM rate_log WHERE created_at<?").bind(now - REPORT_WINDOW_MS * 2),
  ]).catch((err) => {
    // Same degrade-gracefully contract as rateLogCount — losing one rate
    // sample beats 500ing the public write path on a partially-migrated DB.
    logError("rate_log.write_failed", err, { fallback: "ignored" });
  });
}

async function activeReporterBan(
  env: Bindings,
  aliases: [string, string],
  now: number,
): Promise<{ id: number; reporter_fp: string; reason: string | null } | null> {
  return (
    (await env.DB.prepare(
      `SELECT id, reporter_fp, reason
         FROM reporter_bans
        WHERE reporter_fp IN (?,?)
          AND (expires_at IS NULL OR expires_at > ?)
        ORDER BY created_at DESC
        LIMIT 1`,
    )
      .bind(aliases[0], aliases[1], now)
      .first<{ id: number; reporter_fp: string; reason: string | null }>()
      .catch((err) => {
        // reporter_bans arrived in a later migration — treat "table missing"
        // as "no ban" instead of 500ing the public report path.
        logError("reporter_bans.lookup_failed", err, { fallback: "not_banned" });
        return null;
      })) ?? null
  );
}

/** Throttle key for endpoints that aren't tied to the report-alias pair.
 *  Always salted (same fail-closed REPORT_SALT contract as reports): the
 *  caller must 503 when this returns null rather than fall back to storing
 *  a raw identity/IP in rate_log. */
async function throttleFingerprint(env: Bindings, scope: string, id: string): Promise<string | null> {
  return reporterFingerprint(env, `${scope}|${id}`);
}

async function throttleOk(env: Bindings, fp: string, now: number, max: number): Promise<boolean> {
  return (await rateLogCount(env, [fp, fp], now - REPORT_WINDOW_MS)) < max;
}

interface AccountSignalSnapshot {
  accountCreatedAt?: string | null;
  accountAgeDays?: number | null;
  followersCount?: number | null;
  followingCount?: number | null;
}

function metricInt(v: number | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
}

function normalizedAccountCreatedAt(v: string | undefined): string | null {
  const raw = v?.trim();
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? raw.slice(0, 80) : new Date(t).toISOString();
}

function signalSnapshot(s: Signals): AccountSignalSnapshot {
  return {
    accountCreatedAt: normalizedAccountCreatedAt(s.accountCreatedAt),
    accountAgeDays: metricInt(s.accountAgeDays),
    followersCount: metricInt(s.followersCount),
    followingCount: metricInt(s.followingCount),
  };
}

function viewerScopedIgnore(s: Signals): boolean {
  return !!(
    s.viewerIsSelf ||
    s.viewerFollowing ||
    s.viewerBlocking ||
    s.viewerMuting ||
    s.viewerFollowRequestSent
  );
}

interface AccountRow {
  rowid: number;
  verdict_label: string;
  confidence: number;
  reasons: string | null;
  model: string | null;
  signals_hash: string | null;
  status: string;
  // Last time this row was (re)scored — used to gate LLM re-classification
  // by a per-status freshness TTL (see RESCORE_TTL_MS).
  last_scored: number;
  // Included so the write path can tell the caller "I matched by uid even
  // though your handle is new" (used by the rename-detection log line).
  handle: string;
  x_user_id: string | null;
}

async function findAccount(
  env: Bindings,
  handle: string,
  uid: string | null,
): Promise<AccountRow | null> {
  // Pass 1 — by-uid (the immutable key). When the caller knows the X
  // numeric uid, this returns the canonical row even if the handle is now
  // different ("user renamed @foo → @bar"). Critical for forward-compat
  // once the accounts(x_user_id) UNIQUE INDEX is in place: without finding
  // the existing row by uid, writeAccount would try to INSERT a fresh row
  // with the same uid and hit a constraint violation.
  if (uid) {
    const byUid =
      (await env.DB.prepare(
        `SELECT rowid, verdict_label, confidence, reasons, model, signals_hash, status, last_scored, handle, x_user_id
           FROM accounts
          WHERE x_user_id=?
          ORDER BY CASE WHEN status='whitelisted' THEN 0 ELSE 1 END,
                   last_scored DESC
          LIMIT 1`,
      )
        .bind(uid)
        .first<AccountRow>()) ?? null;
    if (byUid) return byUid;
  }

  // Pass 2 — by-handle. Covers two cases:
  //   - Caller has no uid (fiber-walk failure): plain handle-only lookup.
  //   - Caller has a uid but no row exists for it yet: maybe there's a
  //     handle-only row to fill in. The (x_user_id IS NULL) branch picks
  //     that up so the UPDATE path COALESCEs the uid in.
  // Whitelisted wins; among the rest, matching uid wins over handle-only.
  return (
    (await env.DB.prepare(
      `SELECT rowid, verdict_label, confidence, reasons, model, signals_hash, status, last_scored, handle, x_user_id
         FROM accounts
        WHERE lower(handle)=?
          AND (? IS NULL OR x_user_id IS NULL OR x_user_id=?)
        ORDER BY CASE
                   WHEN status='whitelisted' THEN 0
                   ELSE 1
                 END,
                 CASE
                   WHEN ? IS NOT NULL AND x_user_id=? THEN 0
                   WHEN x_user_id IS NOT NULL THEN 1
                   ELSE 2
                 END,
                 last_scored DESC
        LIMIT 1`,
    )
      .bind(handle, uid, uid, uid, uid)
      .first<AccountRow>()) ?? null
  );
}

interface AccountWrite {
  uid: string | null;
  handle: string;
  displayName: string;
  avatarUrl?: string | null;
  verdictLabel: string;
  confidence: number;
  reasons: string;
  category?: string | null;
  model?: string | null;
  status: string;
  source: string;
  signalsHash?: string | null;
  evidenceText?: string | null;
  now: number;
  publishedAt?: number | null;
  /** Provenance of a human_confirmed publish: 'human' | 'ai' | 'rule' |
   *  'mention'. Only meaningful when status='human_confirmed'; the artifact
   *  and /v1/check read it to keep unreviewed auto-publishes out of clients'
   *  auto-block paths. */
  publishedTier?: string | null;
  accountCreatedAt?: string | null;
  accountAgeDays?: number | null;
  followersCount?: number | null;
  followingCount?: number | null;
}

// Tolerant parse for the `reasons` JSON column. A single malformed value
// (legacy import, manual SQL edit) must not 500 the classify cache path or
// silently break the 6h GitHub mirror — degrade to a single-element array.
function safeReasons(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [String(v)];
  } catch {
    return [raw];
  }
}

async function writeAccount(
  env: Bindings,
  w: AccountWrite,
  retried = false,
): Promise<AccountRow | null> {
  const prev = await findAccount(env, w.handle, w.uid);
  if (prev) {
    await env.DB.prepare(
      `UPDATE accounts SET
         x_user_id=COALESCE(?, x_user_id),
         handle=?,
         display_name=?,
         avatar_url=COALESCE(?, avatar_url),
         account_created_at=COALESCE(?, account_created_at),
         account_age_days=COALESCE(?, account_age_days),
         followers_count=COALESCE(?, followers_count),
         following_count=COALESCE(?, following_count),
         verdict_label=?,
         confidence=?,
         reasons=?,
         category=COALESCE(?, category),
         model=COALESCE(?, model),
         source=CASE
                  WHEN status IN ('human_confirmed','rejected','removed','whitelisted')
                    THEN source
                  ELSE ?
                END,
         signals_hash=COALESCE(?, signals_hash),
         evidence_text=COALESCE(?, evidence_text),
         last_scored=?,
         status=CASE
                  WHEN status IN ('human_confirmed','rejected','removed','whitelisted')
                    THEN status
                  ELSE ?
                END,
         published_at=CASE
                        WHEN status IN ('human_confirmed','rejected','removed','whitelisted')
                          THEN published_at
                        ELSE ?
                      END,
         published_tier=CASE
                          WHEN status IN ('human_confirmed','rejected','removed','whitelisted')
                            THEN published_tier
                          ELSE ?
                        END
       WHERE rowid=?`,
    )
      .bind(
        w.uid,
        w.handle,
        w.displayName,
        w.avatarUrl ?? null,
        w.accountCreatedAt ?? null,
        w.accountAgeDays ?? null,
        w.followersCount ?? null,
        w.followingCount ?? null,
        w.verdictLabel,
        w.confidence,
        w.reasons,
        w.category ?? null,
        w.model ?? null,
        w.source,
        w.signalsHash ?? null,
        w.evidenceText ?? null,
        w.now,
        w.status,
        w.publishedAt ?? null,
        w.publishedTier ?? null,
        prev.rowid,
      )
      .run();
    // Cleanup is meaningful only when the kept row has a uid (so null-uid
    // siblings collapse INTO a canonical identity). w.uid takes precedence
    // because we just COALESCEd it onto the row; otherwise fall back to
    // prev's pre-existing uid. The cleanup also runs the status promotion
    // (whitelisted / human_confirmed sibling intent → canonical row).
    if (w.uid ?? prev.x_user_id) {
      await cleanupHandleOnlyAccountDuplicates(env, w.handle, prev.rowid);
    }
    return findAccount(env, w.handle, w.uid);
  }

  try {
    await env.DB.prepare(
      `INSERT INTO accounts
         (x_user_id,handle,display_name,avatar_url,account_created_at,account_age_days,
          followers_count,following_count,verdict_label,confidence,reasons,category,model,
          status,source,signals_hash,evidence_text,first_seen,last_scored,published_at,published_tier)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
      .bind(
        w.uid,
        w.handle,
        w.displayName,
        w.avatarUrl ?? null,
        w.accountCreatedAt ?? null,
        w.accountAgeDays ?? null,
        w.followersCount ?? null,
        w.followingCount ?? null,
        w.verdictLabel,
        w.confidence,
        w.reasons,
        w.category ?? null,
        w.model ?? null,
        w.status,
        w.source,
        w.signalsHash ?? null,
        w.evidenceText ?? null,
        w.now,
        w.now,
        w.publishedAt ?? null,
        w.publishedTier ?? null,
      )
      .run();
  } catch (err) {
    // A concurrent classify of the same account (common: many viewers see the
    // same spam reply at once) can insert the canonical uid row between our
    // findAccount miss and this INSERT, tripping idx_accounts_uid_uq. Re-resolve
    // and take the UPDATE path once, rather than 500-ing after the LLM was paid.
    if (!retried) return writeAccount(env, w, true);
    throw err;
  }
  // Fresh INSERT — only call cleanup when we just created a uid-bearing row.
  // (Race protection: if another writer added a handle-only sibling between
  // findAccount and INSERT, this collapses it.) For pure null-uid INSERTs
  // there's no canonical to merge into, so skip.
  const fresh = await findAccount(env, w.handle, w.uid);
  if (fresh && w.uid) {
    await cleanupHandleOnlyAccountDuplicates(env, w.handle, fresh.rowid);
    return findAccount(env, w.handle, w.uid);
  }
  return fresh;
}

async function updateAccountSignalSnapshot(
  env: Bindings,
  rowid: number,
  snapshot: AccountSignalSnapshot,
): Promise<void> {
  if (
    snapshot.accountCreatedAt == null &&
    snapshot.accountAgeDays == null &&
    snapshot.followersCount == null &&
    snapshot.followingCount == null
  ) {
    return;
  }
  await env.DB.prepare(
    `UPDATE accounts SET
       account_created_at=COALESCE(?, account_created_at),
       account_age_days=COALESCE(?, account_age_days),
       followers_count=COALESCE(?, followers_count),
       following_count=COALESCE(?, following_count)
     WHERE rowid=?`,
  )
    .bind(
      snapshot.accountCreatedAt ?? null,
      snapshot.accountAgeDays ?? null,
      snapshot.followersCount ?? null,
      snapshot.followingCount ?? null,
      rowid,
    )
    .run();
}

// Called from writeAccount after a uid-bearing row is inserted or updated.
// Two jobs, run in order so the maintainer's manual signal survives:
//
//   1. STATUS PROMOTION — if any null-uid sibling for the same handle holds
//      a stronger maintainer signal (whitelisted > human_confirmed) than the
//      canonical uid'd row, propagate it. Mirrors what the one-shot
//      2026-05-26 identity-cleanup migration did across the backlog.
//   2. COLLAPSE — mark every null-uid sibling with the same handle as
//      status='removed', source='auto_dedup_to_uid_twin'. We DON'T delete
//      so the audit trail (verdict, reasons, evidence_text) survives.
//
// Idempotent: re-running on already-cleaned state writes nothing.
async function cleanupHandleOnlyAccountDuplicates(
  env: Bindings,
  handle: string,
  keepRowid: number,
): Promise<void> {
  // 1a. Promote uid'd row → whitelisted if a null-uid sibling is whitelisted.
  await env.DB.prepare(
    `UPDATE accounts
        SET status='whitelisted',
            source='admin_whitelist',
            verdict_label='legit',
            confidence=1.0,
            reasons='["whitelisted by admin"]',
            signals_hash=NULL,
            published_at=NULL
      WHERE rowid=?
        AND status<>'whitelisted'
        AND EXISTS (SELECT 1 FROM accounts s
                     WHERE s.x_user_id IS NULL
                       AND s.status='whitelisted'
                       AND lower(s.handle)=?)`,
  )
    .bind(keepRowid, handle)
    .run();

  // 1b. Promote uid'd row → human_confirmed if a null-uid sibling is
  //     human_confirmed and the canonical row is still in an auto_* state.
  //     (Don't downgrade rejected/whitelisted; don't re-promote.)
  await env.DB.prepare(
    `UPDATE accounts
        SET status='human_confirmed',
            published_at=?,
            published_tier=(SELECT s.published_tier FROM accounts s
                             WHERE s.x_user_id IS NULL
                               AND s.status='human_confirmed'
                               AND lower(s.handle)=?
                             LIMIT 1)
      WHERE rowid=?
        AND status IN ('auto_pending_review','auto_legit')
        AND EXISTS (SELECT 1 FROM accounts s
                     WHERE s.x_user_id IS NULL
                       AND s.status='human_confirmed'
                       AND lower(s.handle)=?)`,
  )
    .bind(Date.now(), handle, keepRowid, handle)
    .run();

  // 2. Collapse: mark all null-uid siblings as removed, preserve payload.
  //    Skip rows already marked removed so this stays idempotent.
  await env.DB.prepare(
    `UPDATE accounts
        SET status='removed',
            source='auto_dedup_to_uid_twin',
            published_at=NULL
      WHERE rowid<>?
        AND lower(handle)=?
        AND x_user_id IS NULL
        AND status<>'removed'`,
  )
    .bind(keepRowid, handle)
    .run();
}

async function insertReportIfNew(
  env: Bindings,
  s: Signals,
  handle: string,
  uid: string | null,
  reporter: Reporter,
  fp: string,
  aliases: [string, string],
  now: number,
): Promise<boolean> {
  const res = await env.DB.prepare(
    `INSERT INTO reports
       (id,x_user_id,handle,reporter_fp,reporter_age_days,evidence,status,created_at)
     SELECT ?,?,?,?,?,?,'pending',?
      WHERE NOT EXISTS (
        SELECT 1 FROM reports
         WHERE lower(handle)=?
           AND reporter_fp IN (?,?)
           AND (? IS NULL OR x_user_id IS NULL OR x_user_id=?)
      )`,
  )
    .bind(
      crypto.randomUUID(),
      uid,
      handle,
      fp,
      reporter.ageDays,
      reportEvidence(s),
      now,
      handle,
      aliases[0],
      aliases[1],
      uid,
      uid,
    )
    .run();
  return (res.meta.changes ?? 0) > 0;
}

// ----------------------------------------------------------------------------
// Keyword rules — fast path that short-circuits the LLM for obvious patterns.
// ----------------------------------------------------------------------------
//
// A maintainer-curated keyword (or substring) match against the incoming
// Signals payload. If any enabled rule matches, the LLM call is skipped
// entirely and the account is routed straight to the rule's action
// (default: human_confirmed → public list). The audit trail (review_log)
// records actor='rule:<id>' so any false-positive is traceable back to
// the specific rule.
//
// Rules are cached in module-level memory with a short TTL — saves a D1
// hit per /v1/classify call while still picking up edits within 30s.

interface KeywordRule {
  id: number;
  pattern: string;
  field: string; // 'handle'|'display_name'|'bio'|'tweet'|'any'
  action: string; // 'blacklist'|'whitelist'|'reject'
  verdict_label: string; // 'spam'|'porn_bot'|'likely_spam'|'uncertain'|'legit'
  category: string | null; // SpamCategory stamped onto accounts on hit; NULL = infer
  enabled: number; // SQLite stores as INTEGER
  note: string | null;
  created_at: number;
  hit_count: number;
  last_hit_at: number | null;
}

const RULE_CACHE_TTL_MS = 30_000;
let ruleCache: { at: number; rules: KeywordRule[] } | null = null;

async function getKeywordRules(env: Bindings): Promise<KeywordRule[]> {
  const now = Date.now();
  if (ruleCache && now - ruleCache.at < RULE_CACHE_TTL_MS) return ruleCache.rules;
  const rows = await env.DB.prepare(
    "SELECT * FROM keyword_rules WHERE enabled=1 ORDER BY id",
  ).all<KeywordRule>();
  ruleCache = { at: now, rules: rows.results ?? [] };
  return ruleCache.rules;
}

// Manual invalidation — call after any CRUD on keyword_rules so the next
// /v1/classify picks up the change before the TTL would expire naturally.
function invalidateRuleCache() {
  ruleCache = null;
}

// X auto-translate guard for CJK rules matched against TWEET TEXT. X renders
// machine translations in place of the original tweet body, so a legit
// non-Chinese account's tweet can arrive here as fluent Chinese and collide
// with a curated CJK pattern ("主页", "约" …). Two independent tells:
//   - a new-style client flags the payload (tweetsTranslated), or
//   - the pattern is CJK but the account's own profile (display name + bio +
//     handle) contains no CJK at all — a Chinese spam account essentially
//     always self-describes in Chinese, so a CJK tweet on a CJK-free profile
//     is far more likely X's translator than a Chinese bot.
// Suppressed hits fall through to the LLM (which is told about translation),
// so the account is still classified — just not insta-blacklisted by keyword.
function tweetTextTrusted(pattern: string, s: Signals): boolean {
  if (!hasCJK(pattern)) return true; // ascii patterns (urls…) survive translation
  if (s.tweetsTranslated) return false;
  return hasCJK(s.displayName) || hasCJK(s.bio) || hasCJK(s.handle);
}

// Shared pattern matcher for keyword rules (live fast-path + queue sweep).
// Bare substring matching caused a real public-list false positive: pattern
// "visa" hit display name "Visakan" (a 205k-follower author) and published at
// confidence=1. ASCII-only patterns now require word boundaries (no adjacent
// [a-z0-9_]); patterns containing CJK or other non-ASCII keep substring
// semantics — CJK text has no word delimiters, so boundaries would silently
// disable every curated Chinese rule.
const keywordRegexCache = new Map<string, RegExp>();
function keywordHit(pattern: string, v: string | undefined | null): boolean {
  if (!v) return false;
  const p = pattern.toLowerCase();
  if (!p) return false;
  const t = v.toLowerCase();
  // eslint-disable-next-line no-control-regex
  if (!/^[\x20-\x7f]+$/.test(p)) return t.includes(p);
  let re = keywordRegexCache.get(p);
  if (!re) {
    const esc = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    re = new RegExp(`(?<![a-z0-9_])${esc}(?![a-z0-9_])`);
    keywordRegexCache.set(p, re);
  }
  return re.test(t);
}

function ruleMatchesText(rule: KeywordRule, s: Signals): boolean {
  if (!rule.pattern) return false;
  const has = (v: string | undefined | null) => keywordHit(rule.pattern, v);
  const tweetHit = () =>
    tweetTextTrusted(rule.pattern, s) &&
    (s.recentTweets.some((t) => has(t)) || has(s.triggeringComment));
  switch (rule.field) {
    case "handle":
      return has(s.handle);
    case "display_name":
      return has(s.displayName);
    case "bio":
      return has(s.bio);
    case "tweet":
      return tweetHit();
    case "any":
      return has(s.handle) || has(s.displayName) || has(s.bio) || tweetHit();
    default:
      // Unknown field — do NOT silently widen to match every field. A typo'd
      // or future field name must not turn into an everything-matcher.
      return false;
  }
}

async function matchKeywordRules(env: Bindings, s: Signals): Promise<KeywordRule | null> {
  const rules = await getKeywordRules(env);
  for (const rule of rules) {
    if (ruleMatchesText(rule, s)) return rule;
  }
  return null;
}

// Map a rule's `action` to the accounts table `status` the row should land in.
// A 'blacklist' hit publishes directly to the public list — keyword rules are
// maintainer-curated and trusted to be high-precision (the maintainer picks
// specific, non-generic phrases). The audit log records actor='rule:<id>' so
// any hit is traceable, and writeAccount still preserves an existing
// human_confirmed/rejected/removed/whitelisted status, so a rule can never
// override a prior human decision on the same account.
function statusForRuleAction(action: string): "human_confirmed" | "whitelisted" | "rejected" {
  if (action === "whitelist") return "whitelisted";
  if (action === "reject") return "rejected";
  return "human_confirmed"; // 'blacklist' default
}

// Only machine-made, non-terminal verdicts may be overturned by a newly-added
// keyword rule. Human decisions and Agent staging remain authoritative.
const RULE_OVERRIDABLE_STATUSES = new Set(["auto_pending_review", "auto_legit"]);

// Mention-promotion allowlist — handles that must NEVER be auto-blacklisted via
// the @-mention path below, even if a spam tweet @-mentions them. These are
// official/utility accounts a spam post might legitimately tag (e.g. asking
// @grok to "summarize", or @-ing @x support). Lowercased, no leading '@'.
const MENTION_BLACKLIST_SKIP = new Set([
  "grok",
  "gork", // common misspelling that still resolves to the assistant
  "x",
  "elonmusk",
  "support",
  "safety",
  "premium",
  "verified",
  "twitter",
  "twittersupport",
]);

// Pull unique, normalized @mentions out of a post body. We scan only the tweet
// text (recentTweets + triggeringComment) — the "正文" where promoted handles
// appear — not bio/display-name, to keep this conservative. X handles are
// [A-Za-z0-9_]{1,15}; the '@' must not be preceded by a word char (so email
// locals like "foo@bar" don't match) and must be followed by a boundary (so a
// 16+ char run — not a real handle — is skipped rather than truncated).
function extractMentions(s: Signals): string[] {
  const text = [s.triggeringComment ?? "", ...s.recentTweets].join("\n");
  const out = new Set<string>();
  const re = /(?:^|[^A-Za-z0-9_@])@([A-Za-z0-9_]{1,15})\b/g;
  let match = re.exec(text);
  while (match !== null) {
    out.add(match[1].toLowerCase());
    match = re.exec(text);
  }
  return [...out];
}

// When a 'blacklist' keyword rule fires, any account @-mentioned in the post
// body is almost always the spam target being promoted — the matched account is
// frequently a throwaway whose only job is to point at the "main" handle. So we
// auto-blacklist those mentions too, minus:
//   - the matched account's own handle,
//   - the curated MENTION_BLACKLIST_SKIP allowlist (official/utility accounts),
//   - any handle a human has already ruled on (whitelisted/rejected/removed) or
//     that's already on the public list (human_confirmed) — nothing to do.
// Each promotion is a handle-only row (we have no uid for a bare @mention) and
// is logged with actor='rule:<id>' so it is traceable and reversible, exactly
// like the primary rule hit. Returns the list of newly-promoted handles.
async function autoBlacklistMentions(
  env: Bindings,
  rule: KeywordRule,
  s: Signals,
  now: number,
): Promise<string[]> {
  const own = normalizeHandle(s.handle);
  const promoted: string[] = [];
  // A rule configured with a non-spam verdict label must never mint public
  // rows via its mentions (mentioned accounts are handle-only here, so the
  // follower half of the guard can't apply — the label half still must).
  if (!autoPublishEligible(rule.verdict_label, null)) return promoted;
  for (const handle of extractMentions(s)) {
    if (promoted.length >= MENTION_PROMOTE_MAX) break;
    if (handle === own) continue;
    if (MENTION_BLACKLIST_SKIP.has(handle)) continue;
    const prev = await findAccount(env, handle, null);
    // Only auto-promote when there's nothing to step on: a brand-new handle, or
    // one still in an auto_* limbo. Any human decision or an existing public
    // listing is left untouched.
    if (prev && prev.status !== "auto_pending_review" && prev.status !== "auto_legit") {
      continue;
    }
    const reasons = [
      `auto-blacklisted: @-mentioned by spam account @${own} which matched keyword rule "${rule.pattern}"`,
    ];
    await writeAccount(env, {
      uid: null,
      handle,
      displayName: "",
      verdictLabel: rule.verdict_label,
      confidence: 1.0,
      reasons: JSON.stringify(reasons),
      category: categoryForRule(rule),
      model: null,
      status: "human_confirmed",
      source: "auto_keyword_mention",
      evidenceText: evidenceText(s),
      now,
      publishedAt: now,
      publishedTier: "mention",
    });
    await env.DB.prepare(
      "INSERT INTO review_log (x_user_id, handle, action, actor, note, at) VALUES (?,?,?,?,?,?)",
    )
      .bind(
        null,
        handle,
        "keyword_mention_blacklist",
        `rule:${rule.id}`,
        `promoted from @${own} (matched "${rule.pattern}" on ${rule.field})`,
        now,
      )
      .run();
    promoted.push(handle);
  }
  return promoted;
}

const app = new Hono<{ Bindings: Bindings }>();

// CORS is scoped to the public read/report surface only. The admin and agent
// routes are same-origin (the /admin panel) or server-to-server, and must NOT
// advertise wildcard cross-origin access.
const publicCors = cors();
for (const route of [
  "/v1/health",
  "/v1/check",
  "/v1/classify",
  "/v1/confirm",
  "/v1/report",
  "/v1/appeal",
  "/v1/whitelist",
  "/v1/whitelist/apply",
  "/v1/whitelist/apply/status",
  "/v1/list",
  "/v1/list/*",
  "/v1/artifacts/*",
]) {
  app.use(route, publicCors);
}

const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;

app.get("/v1/health", async (c) => {
  // Read the published count from the 24-row publications ledger instead of
  // `count(*)` over the ~97K human_confirmed partition — /v1/health is public,
  // uncached, and often polled by uptime monitors, so the full-partition scan
  // was a standing D1 rows-read cost (~100K rows/call). The published count is
  // ≤10 min stale (cron cadence), which is fine for a liveness probe.
  const r = await c.env.DB.prepare(
    "SELECT count FROM publications ORDER BY published_at DESC LIMIT 1",
  )
    .first<{ count: number }>()
    .catch(() => null);
  return c.json({ ok: true, published: r?.count ?? 0 });
});

// Public membership check — only human_confirmed (the public list).
// Confirmatory lookup for Bloom hits; cache hot paths at the edge.
app.get("/v1/check", async (c) => {
  const ids = (c.req.query("ids") ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 100);
  if (!ids.length) return c.json({ hits: {} });
  const cacheUrl = new URL(c.req.url);
  cacheUrl.search = new URLSearchParams({ ids: [...ids].sort().join(",") }).toString();
  const cacheKey = cacheUrl.toString();
  const cached = await caches.default.match(cacheKey);
  if (cached) return cached;

  const ph = ids.map(() => "?").join(",");
  // `+status` (the SQLite no-op unary plus) deliberately disqualifies the
  // composite status indexes so the planner drives off idx_accounts_uid via
  // the `x_user_id IN (...)` list. Without it the planner picked
  // idx_accounts_status_confidence and SCANNED EVERY human_confirmed row
  // (~97K) on every call — this batch lookup is the extension's hottest
  // endpoint, so that was the dominant source of D1 rows-read. Measured:
  // 96,763 rows/call → 4 rows/call. Status is still filtered, just not via index.
  // published_tier='human' — /v1/check has always meant "human-confirmed
  // public list", and deployed v0.4 clients auto-BLOCK on any hit returned
  // here. AI/rule/mention auto-publishes stay out of this endpoint (they
  // still ship in the lite artifact, tier-tagged, for badge display).
  const rows = await c.env.DB.prepare(
    `SELECT x_user_id, verdict_label, confidence FROM accounts
     WHERE x_user_id IN (${ph}) AND +status='human_confirmed'
       AND published_tier='human'`,
  )
    .bind(...ids)
    .all<{ x_user_id: string; verdict_label: string; confidence: number }>();
  const hits: Record<string, { label: string; confidence: number }> = {};
  for (const r of rows.results ?? [])
    hits[r.x_user_id] = { label: r.verdict_label, confidence: r.confidence };
  const resp = Response.json(
    { hits },
    { headers: { "Cache-Control": "public, max-age=15, s-maxage=30" } },
  );
  c.executionCtx.waitUntil(caches.default.put(cacheKey, resp.clone()));
  return resp;
});

app.post("/v1/classify", async (c) => {
  // Cost endpoint — GitHub identity required (when enforcement is on).
  const who = await requireReporter(c);
  if (!who) return c.json({ error: "github_login_required" }, 401);
  let parsed: Signals;
  try {
    parsed = Signals.parse(await c.req.json());
  } catch (err) {
    return c.json({ error: "bad_request", detail: (err as Error).message }, 400);
  }
  // NOTE: the per-identity throttle is enforced later, immediately before the
  // LLM call — NOT here. Every short-circuit below (viewer-ignore, whitelist,
  // signals_hash/TTL reuse, keyword rules) returns without spending an LLM
  // call, so they must stay free: a browser extension classifies every account
  // in the timeline and is almost entirely cache hits, which would otherwise
  // exhaust the window on free lookups and 429 the genuinely-new accounts.
  const s: Signals = { ...parsed, handle: normalizeHandle(parsed.handle) };
  if (viewerScopedIgnore(s)) {
    return c.json({
      cached: true,
      ignored: true,
      record: {
        verdict: { label: "legit", confidence: 1, reasons: ["viewer-scoped ignored"] },
        status: "viewer_ignored",
      },
    });
  }
  const h = sigHash(s);
  const uid = s.userId ?? null;
  const prev = await findAccount(c.env, s.handle, uid);
  // Hard short-circuit for admin-curated whitelist — skip the LLM AND ignore
  // signals_hash drift. Whitelist beats heuristics.
  if (prev && prev.status === "whitelisted") {
    await updateAccountSignalSnapshot(c.env, prev.rowid, signalSnapshot(s));
    return c.json({
      cached: true,
      record: {
        verdict: { label: "legit", confidence: 1, reasons: ["whitelisted"] },
        status: "whitelisted",
      },
    });
  }
  // Rules must run before cache reuse: a newly-added rule should immediately
  // correct stale machine verdicts, while terminal human decisions stay fixed.
  const ruleHit = await matchKeywordRules(c.env, s);
  let ruleDest: string | null = null;
  let ruleDemotedToQueue = false;
  if (ruleHit) {
    ruleDest = statusForRuleAction(ruleHit.action);
    ruleDemotedToQueue =
      ruleDest === "human_confirmed" &&
      !autoPublishEligible(ruleHit.verdict_label, s.followersCount ?? null);
    if (ruleDemotedToQueue) ruleDest = "auto_pending_review";
  }
  // Reuse the existing verdict (no LLM) when either the signals are byte-for-byte
  // unchanged, OR the account already has a verdict that's still fresh per its
  // status TTL. The latter collapses the recentTweets-drift re-classification
  // storm (same account, many viewers/times) that dominated LLM spend.
  let cachedPrevResponse: Response | null = null;
  if (prev) {
    const exact = prev.signals_hash === h;
    const ttl = RESCORE_TTL_MS[prev.status];
    const fresh = ttl !== undefined && Date.now() - prev.last_scored < ttl;
    if (exact || fresh) {
      const ruleOverrides =
        ruleDest !== null && RULE_OVERRIDABLE_STATUSES.has(prev.status) && ruleDest !== prev.status;
      if (!ruleOverrides) {
        await updateAccountSignalSnapshot(c.env, prev.rowid, signalSnapshot(s));
        return c.json({
          cached: true,
          record: {
            verdict: {
              label: prev.verdict_label,
              confidence: prev.confidence,
              reasons: safeReasons(prev.reasons),
            },
            status: prev.status,
          },
        });
      }
      cachedPrevResponse = c.json({
        cached: true,
        record: {
          verdict: {
            label: prev.verdict_label,
            confidence: prev.confidence,
            reasons: safeReasons(prev.reasons),
          },
          status: prev.status,
        },
      });
    }
  }
  // Fast-path: keyword rules. Match before spending an LLM call. A hit routes
  // the account straight to the rule's destination status (default 'blacklist'
  // → 'human_confirmed' on the public list). The audit log records
  // actor='rule:<id>' so any hit is traceable.
  if (ruleHit) {
    const now = Date.now();
    // See RULE_WRITE_MAX_PER_WINDOW: this branch writes (and can publish), so
    // it gets its own throttle even though it never spends an LLM call.
    const ruleRateId =
      who.id === "anon" ? `ip:${c.req.header("cf-connecting-ip") ?? "unknown"}` : who.id;
    const ruleFp = await throttleFingerprint(c.env, "classify-rule", ruleRateId);
    if (!ruleFp) {
      return c.json({ error: "report_salt_required", detail: "REPORT_SALT not configured" }, 503);
    }
    if (!(await throttleOk(c.env, ruleFp, now, RULE_WRITE_MAX_PER_WINDOW))) {
      if (cachedPrevResponse) return cachedPrevResponse;
      return c.json({ error: "rate_limited", retryAfterMs: REPORT_WINDOW_MS }, 429);
    }
    await recordReportRate(c.env, ruleFp, now);
    const status = ruleDest ?? statusForRuleAction(ruleHit.action);
    const reasons = [`matched keyword rule "${ruleHit.pattern}" on ${ruleHit.field}`];
    const verdict = {
      label: ruleHit.verdict_label,
      confidence: 1.0,
      reasons,
    };
    await writeAccount(c.env, {
      uid,
      handle: s.handle,
      displayName: s.displayName,
      avatarUrl: s.avatarUrl,
      verdictLabel: ruleHit.verdict_label,
      confidence: 1.0,
      reasons: JSON.stringify(reasons),
      category: categoryForRule(ruleHit),
      model: null,
      status,
      source: "auto_keyword",
      signalsHash: h,
      evidenceText: evidenceText(s),
      now,
      publishedAt: status === "human_confirmed" ? now : null,
      publishedTier: status === "human_confirmed" ? "rule" : null,
      ...signalSnapshot(s),
    });
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE keyword_rules SET hit_count=hit_count+1, last_hit_at=? WHERE id=?",
      ).bind(now, ruleHit.id),
      c.env.DB.prepare(
        "INSERT INTO review_log (x_user_id, handle, action, actor, note, at) VALUES (?,?,?,?,?,?)",
      ).bind(
        uid ?? null,
        s.handle,
        `keyword_${ruleHit.action}`,
        `rule:${ruleHit.id}`,
        `matched "${ruleHit.pattern}" on ${ruleHit.field}${
          ruleDemotedToQueue ? " · queued (auto-publish guard: label/high-follower)" : ""
        }`,
        now,
      ),
    ]);
    // Propagation: a 'blacklist' rule hit promotes any account the spam post
    // @-mentions in its body — the promoted "main" handle these throwaways point
    // at — to the public list as well. Whitelist/reject rules don't propagate.
    // Mention-promotion is the highest-abuse surface (it publishes handles the
    // caller merely typed into a tweet body). Gate it on an aged GitHub identity
    // so a throwaway/anon caller can't weaponize it, and cap the count below.
    // If the primary hit itself was demoted to the queue (possible false
    // positive), don't fan its @mentions out to the public list either.
    const promotedMentions =
      ruleHit.action === "blacklist" && !ruleDemotedToQueue && who.ageDays >= REPORTER_MIN_AGE_DAYS
        ? await autoBlacklistMentions(c.env, ruleHit, s, now)
        : [];
    return c.json({
      cached: false,
      record: { verdict, status },
      matchedRule: { id: ruleHit.id, pattern: ruleHit.pattern, field: ruleHit.field },
      ...(promotedMentions.length ? { promotedMentions } : {}),
    });
  }
  // Throttle the EXPENSIVE path only. We reached here past every cache/rule
  // short-circuit, so this request WILL spend an LLM call — the cost the cap
  // exists to bound. Keyed by a salted fingerprint of the GitHub identity (or
  // the connecting IP when anonymous); fails closed when REPORT_SALT is unset
  // so raw identities never land in rate_log.
  const now = Date.now();
  const rateId = who.id === "anon" ? `ip:${c.req.header("cf-connecting-ip") ?? "unknown"}` : who.id;
  const rateFp = await throttleFingerprint(c.env, "classify", rateId);
  if (!rateFp) {
    return c.json({ error: "report_salt_required", detail: "REPORT_SALT not configured" }, 503);
  }
  if (!(await throttleOk(c.env, rateFp, now, CLASSIFY_MAX_PER_WINDOW))) {
    return c.json({ error: "rate_limited", retryAfterMs: REPORT_WINDOW_MS }, 429);
  }
  // Global (cross-identity) circuit breaker on top of the per-identity cap:
  // the per-identity key is the connecting IP for anonymous legacy clients,
  // so an IP-rotating attacker gets a fresh 60-call window per address and
  // total LLM spend is otherwise unbounded. Sized far above organic
  // fresh-classify volume (post-TTL that's a fraction of this) — it only
  // trips under attack, and turns "unbounded bill" into "bounded hour".
  const globalFp = await throttleFingerprint(c.env, "classify-global", "all");
  const globalMax = Number(c.env.LLM_GLOBAL_MAX_PER_WINDOW ?? "") || LLM_GLOBAL_MAX_PER_WINDOW;
  if (!globalFp || !(await throttleOk(c.env, globalFp, now, globalMax))) {
    if (globalFp === null) {
      return c.json({ error: "report_salt_required", detail: "REPORT_SALT not configured" }, 503);
    }
    logError("classify.global_llm_cap_tripped", new Error("global LLM cap reached"), {
      max: globalMax,
    });
    return c.json({ error: "rate_limited", retryAfterMs: REPORT_WINDOW_MS }, 429);
  }
  await recordReportRate(c.env, rateFp, now);
  await recordReportRate(c.env, globalFp, now);
  const verdict = await classify(c.env, s);
  // Auto-publish high-confidence AI spam straight to the public list — the
  // mirror image of the auto_legit fast-accept below. Only the classify path
  // does this; the report path stays manual-confirm-only (its inherited
  // verdicts are the noisy ones). writeAccount still preserves any prior human
  // decision (human_confirmed/rejected/removed/whitelisted), so this can never
  // override a maintainer, and /v1/appeal remains the fallback.
  // Corroboration gate: classify signals are entirely client-supplied and are
  // never verified against the real X account, so a fabricated payload could
  // otherwise publish an arbitrary victim to the public list. Require BOTH a
  // numeric uid (a bare handle is trivial to target; a uid is the account's
  // immutable id, far harder to weaponize against a chosen victim) AND an aged
  // GitHub identity. When the gate fails the verdict still lands in the
  // maintainer review queue (writeStatus below) instead of auto-publishing.
  // porn_bot ONLY: that's the template-flood class where the AI is reliably
  // precise. Generic "spam" verdicts (marketing/procurement/crypto chatter)
  // produced real false positives on normal accounts (e.g. @Jackywine, a
  // normal AI-content account auto-published off one GPU-procurement post),
  // so they always queue for human review now.
  const aiAutoPublish =
    verdict.label === "porn_bot" &&
    verdict.confidence >= AUTO_AI_PUBLISH_CONF &&
    uid !== null &&
    who.ageDays >= REPORTER_MIN_AGE_DAYS &&
    // High-reach guard: a known ≥100k-follower account never auto-publishes,
    // whatever the confidence — it queues for a human instead (2026-07-24
    // audit found real creators/brands in this band mislabeled porn_bot).
    autoPublishEligible(verdict.label, s.followersCount ?? null);
  // High-confidence legit verdicts are cached but kept out of the maintainer
  // queue. /admin/queue still only selects status='auto_pending_review', so
  // auto_legit rows are invisible there but the next /v1/classify hit still
  // gets a free cache return.
  const writeStatus = aiAutoPublish
    ? "human_confirmed"
    : verdict.label === "legit" && verdict.confidence >= 0.85
      ? "auto_legit"
      : "auto_pending_review";
  // Pick the most-relevant public X snippet that triggered this verdict so
  // the public list can be audited without retaining unrelated context.
  // Category: the LLM's explicit pick, else the label-level mapping
  // (porn_bot → porn). Anything else stays NULL for the backfill sweep —
  // no keyword guessing. legit/uncertain rows stay uncategorized.
  const spammyVerdict = ["spam", "porn_bot", "likely_spam"].includes(verdict.label);
  const verdictCategory = spammyVerdict
    ? (verdict.category ?? categoryForLabel(verdict.label))
    : null;
  const written = await writeAccount(c.env, {
    uid,
    handle: s.handle,
    displayName: s.displayName,
    avatarUrl: s.avatarUrl,
    verdictLabel: verdict.label,
    confidence: verdict.confidence,
    reasons: JSON.stringify(verdict.reasons),
    category: verdictCategory,
    model: c.env.LLM_API_MODEL,
    status: writeStatus,
    source: "auto_scan",
    signalsHash: h,
    evidenceText: evidenceText(s),
    now,
    publishedAt: aiAutoPublish ? now : null,
    // Honest provenance: an AI auto-publish is NOT a human confirmation.
    // Clients gate auto mute/block on tier 'human'; 'ai' rows badge only.
    publishedTier: aiAutoPublish ? "ai" : null,
    ...signalSnapshot(s),
  });
  // Audit every AI auto-publish (mirrors the keyword-rule actor='rule:<id>'
  // trail). Skip rows that were already on the public list — writeAccount
  // preserves an existing human_confirmed status, so re-scanning a published
  // account would otherwise log a spurious publish.
  if (aiAutoPublish && written?.status === "human_confirmed" && prev?.status !== "human_confirmed") {
    await c.env.DB.prepare(
      "INSERT INTO review_log (x_user_id,handle,action,actor,note,at) VALUES (?,?,?,?,?,?)",
    )
      .bind(
        uid ?? null,
        s.handle,
        "ai_blacklist",
        "ai:auto",
        `auto-published ${verdict.label} @ ${verdict.confidence}`,
        now,
      )
      .run();
  }
  return c.json({ cached: false, record: { verdict, status: writeStatus } });
});

/**
 * A user block/report is a SIGNAL, not a verdict. Auto-publish only when
 * AI is high-confidence spam AND ≥3 *distinct GitHub reporters* corroborate
 * (the human signal — governance red line intact). Otherwise it queues for
 * admin review.
 */
async function submitReport(c: Ctx, source: string) {
  const who = await requireReporter(c);
  if (!who) return c.json({ error: "github_login_required" }, 401);
  let parsed: Signals;
  try {
    parsed = Signals.parse(await c.req.json());
  } catch (err) {
    return c.json({ error: "bad_request", detail: (err as Error).message }, 400);
  }
  const s: Signals = { ...parsed, handle: normalizeHandle(parsed.handle) };
  if (viewerScopedIgnore(s)) {
    return c.json({ ok: true, status: "viewer_ignored", reporters: 0, auto: false, ignored: true });
  }
  const uid = s.userId ?? null;
  const now = Date.now();
  const fp = await reporterFingerprint(c.env, who.id);
  // Fail closed: without the salt we'd be storing raw `gh:<id>` identities,
  // which SECURITY.md explicitly promises never happens.
  if (!fp) {
    return c.json({ error: "report_salt_required", detail: "REPORT_SALT not configured" }, 503);
  }
  const aliases = reporterAliases(fp, who.id);

  const ban = await activeReporterBan(c.env, aliases, now);
  if (ban) {
    return c.json({ error: "reporter_banned", reason: ban.reason ?? "banned" }, 403);
  }

  const rate = await reportRate(c.env, aliases, now);
  if (!rate.ok) {
    return c.json({ error: "rate_limited", remaining: 0, retryAfterMs: REPORT_WINDOW_MS }, 429);
  }

  // Whitelist short-circuit — if maintainer has explicitly whitelisted the
  // target, ignore the report entirely (don't even store it). Avoids letting
  // a coordinated brigade pollute the audit trail against a trusted account.
  const cur = await findAccount(c.env, s.handle, uid);
  if (cur?.status === "whitelisted") {
    await updateAccountSignalSnapshot(c.env, cur.rowid, signalSnapshot(s));
    return c.json({ ok: true, status: "whitelisted", reporters: 0, auto: false });
  }

  // one report per (target, reporter); always store, even for "young" GH
  // accounts — they just don't count toward AUTO_REPORTERS.
  const insertedReport = await insertReportIfNew(c.env, s, s.handle, uid, who, fp, aliases, now);
  const alreadyReported = !insertedReport;
  if (insertedReport) {
    await recordReportRate(c.env, fp, now);
  }

  // Reporter count for auto-publish: only GH accounts older than
  // REPORTER_MIN_AGE_DAYS count. NULL age = legacy rows; treat them as
  // eligible so existing maintainer history is preserved.
  const cnt = await c.env.DB.prepare(
    `SELECT count(DISTINCT CASE WHEN reporter_fp=? THEN ? ELSE reporter_fp END) n FROM reports
       WHERE lower(handle)=?
         AND (? IS NULL OR x_user_id IS NULL OR x_user_id=?)
         AND (reporter_age_days IS NULL OR reporter_age_days >= ?)`,
  )
    .bind(aliases[1], aliases[0], s.handle, uid, uid, REPORTER_MIN_AGE_DAYS)
    .first<{ n: number }>();
  const reporters = cnt?.n ?? (who.ageDays >= REPORTER_MIN_AGE_DAYS ? 1 : 0);
  if (alreadyReported && cur) {
    await updateAccountSignalSnapshot(c.env, cur.rowid, signalSnapshot(s));
    return c.json({ ok: true, status: cur.status, reporters, auto: false, duplicate: true });
  }

  // Apply enabled rules on reports too; this path previously skipped them and
  // queued accounts that the same payload would have classified by rule.
  const prev = await findAccount(c.env, s.handle, uid);
  const ruleHit = await matchKeywordRules(c.env, s);
  const ruleApplies = ruleHit && (!prev || RULE_OVERRIDABLE_STATUSES.has(prev.status));
  let vLabel: string;
  let vConf: number;
  // Fresh-classify rows get the LLM's category; for prev rows pass null so
  // writeAccount's COALESCE keeps whatever category the row already carries.
  let vCategory: string | null = null;
  let vReasons = '["reported"]';
  let ruleStatus: string | null = null;
  let rulePublished = false;
  if (ruleApplies && ruleHit) {
    vLabel = ruleHit.verdict_label;
    vConf = 1;
    vReasons = JSON.stringify([
      `matched keyword rule "${ruleHit.pattern}" on ${ruleHit.field}`,
      "reported",
    ]);
    ruleStatus = statusForRuleAction(ruleHit.action);
    if (ruleStatus === "human_confirmed") {
      if (autoPublishEligible(ruleHit.verdict_label, s.followersCount ?? null)) {
        rulePublished = true;
        vCategory = categoryForRule(ruleHit);
      } else {
        ruleStatus = "auto_pending_review";
      }
    }
  } else if (prev) {
    vLabel = prev.verdict_label;
    vConf = prev.confidence;
  } else {
    const cl = await classify(c.env, s);
    vLabel = cl.label;
    vConf = cl.confidence;
    if (["spam", "porn_bot", "likely_spam"].includes(cl.label)) {
      vCategory = cl.category ?? categoryForLabel(cl.label);
    }
  }

  // 2026-05-25 — auto-publish path disabled while the project is still alpha.
  // The original gate (`aiSpam && reporters >= AUTO_REPORTERS`) was a valid
  // design, but at this scale a coordinated brigade of 3 GH accounts could
  // push a target onto the public board before a maintainer notices. Every
  // report now queues for manual confirmation; AUTO_CONF / AUTO_REPORTERS are
  // kept as constants so the path can be re-enabled in one line later.
  const aiSpam = (vLabel === "spam" || vLabel === "porn_bot") && vConf >= AUTO_CONF;
  const wouldAutoIfEnabled = aiSpam && reporters >= AUTO_REPORTERS;
  const auto = false; // manual-confirmation-only for now
  const status = ruleStatus ?? "auto_pending_review";

  const written = await writeAccount(c.env, {
    uid,
    handle: s.handle,
    displayName: s.displayName,
    avatarUrl: s.avatarUrl,
    verdictLabel: vLabel,
    confidence: vConf,
    reasons: vReasons,
    category: vCategory,
    model: prev || ruleApplies ? null : c.env.LLM_API_MODEL,
    status,
    source,
    evidenceText: evidenceText(s),
    now,
    publishedAt: rulePublished ? now : null,
    publishedTier: rulePublished ? "rule" : null,
    ...signalSnapshot(s),
  });
  const finalStatus = written?.status ?? status;
  if (ruleApplies && ruleHit) {
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE keyword_rules SET hit_count=hit_count+1, last_hit_at=? WHERE id=?",
      ).bind(now, ruleHit.id),
      c.env.DB.prepare(
        "INSERT INTO review_log (x_user_id, handle, action, actor, note, at) VALUES (?,?,?,?,?,?)",
      ).bind(
        uid,
        s.handle,
        `keyword_${ruleHit.action}`,
        `rule:${ruleHit.id}`,
        `via ${source}: matched "${ruleHit.pattern}" on ${ruleHit.field}${
          ruleStatus === "auto_pending_review" &&
          statusForRuleAction(ruleHit.action) === "human_confirmed"
            ? " · queued (auto-publish guard: label/high-follower)"
            : ""
        }`,
        now,
      ),
    ]);
  }
  if (!alreadyReported) {
    await c.env.DB.prepare(
      "INSERT INTO review_log (x_user_id,handle,action,actor,note,at) VALUES (?,?,?,?,?,?)",
    )
      .bind(
        uid,
        s.handle,
        finalStatus === status ? "report_queued" : "report_seen",
        reporterActor(fp),
        `${source} r=${reporters} age=${who.ageDays}d${
          wouldAutoIfEnabled ? " · would auto-publish if enabled" : ""
        }`,
        now,
      )
      .run();
  }
  return c.json({ ok: true, status: finalStatus, reporters, auto, duplicate: alreadyReported });
}
app.post("/v1/confirm", (c) => submitReport(c, "block"));
app.post("/v1/report", (c) => submitReport(c, "report"));

const AppealBody = z.object({
  handle: z
    .string()
    .trim()
    .regex(/^@?[A-Za-z0-9_]{1,15}$/, "handle must be a valid X handle"),
  userId: z.string().regex(/^\d+$/).optional(),
  reason: z.string().max(500).optional(),
});

app.post("/v1/appeal", async (c) => {
  let body: z.infer<typeof AppealBody>;
  try {
    body = AppealBody.parse(await c.req.json());
  } catch (err) {
    return c.json({ error: "bad_request", detail: (err as Error).message }, 400);
  }
  // Unauthenticated endpoint → per-IP throttle (salted fingerprint, never the
  // raw IP). Fails closed when REPORT_SALT is unset, like the report path.
  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  const rateFp = await throttleFingerprint(c.env, "appeal", `ip:${ip}`);
  if (!rateFp) {
    return c.json({ error: "report_salt_required", detail: "REPORT_SALT not configured" }, 503);
  }
  const now = Date.now();
  if (!(await throttleOk(c.env, rateFp, now, APPEAL_MAX_PER_WINDOW))) {
    return c.json({ error: "rate_limited", retryAfterMs: REPORT_WINDOW_MS }, 429);
  }
  await recordReportRate(c.env, rateFp, now);
  const handle = normalizeHandle(body.handle);
  const uid = body.userId ?? null;
  const cur = await findAccount(c.env, handle, uid);
  if (!cur) return c.json({ error: "not_found" }, 404);
  if (cur.status !== "human_confirmed") {
    return c.json({ ok: true, status: "not_listed", currentStatus: cur.status });
  }

  // Dedupe: one queued appeal per (handle, 24h). Repeat submissions still get
  // the same 202 so callers can't probe, but the review_log stays clean.
  const dup = await c.env.DB.prepare(
    `SELECT 1 AS one FROM review_log
      WHERE action='appeal_submitted' AND lower(handle)=lower(?) AND at>=?
      LIMIT 1`,
  )
    .bind(cur.handle, now - DAY_MS)
    .first<{ one: number }>()
    .catch(() => null);
  if (dup) return c.json({ ok: true, status: "appeal_queued", duplicate: true }, 202);

  const reasonHash = body.reason?.trim() ? ` reason_hash=${hash(body.reason.trim())}` : "";
  await c.env.DB.prepare(
    "INSERT INTO review_log (x_user_id,handle,action,actor,note,at) VALUES (?,?,?,?,?,?)",
  )
    .bind(
      cur.x_user_id,
      cur.handle,
      "appeal_submitted",
      "public",
      `queued for removal review${reasonHash}`,
      now,
    )
    .run();
  return c.json({ ok: true, status: "appeal_queued" }, 202);
});

// ---- Whitelist self-service applications ----
// An extension user asks the maintainer to whitelist their own X account.
// Same identity + anti-abuse stack as /v1/report: GitHub auth, HMAC reporter
// fingerprint (fail-closed on missing salt), reporter bans, rate_log throttle,
// plus a hard GH-account-age floor so throwaway accounts can't apply at all.
const WhitelistApplyBody = z.object({
  handle: z
    .string()
    .trim()
    .regex(/^@?[A-Za-z0-9_]{1,15}$/, "handle must be a valid X handle"),
  userId: z.string().regex(/^\d+$/).optional(),
  note: z.string().max(200).optional(),
});

app.post("/v1/whitelist/apply", async (c) => {
  const who = await requireReporter(c);
  if (!who) return c.json({ error: "github_login_required" }, 401);
  let body: z.infer<typeof WhitelistApplyBody>;
  try {
    body = WhitelistApplyBody.parse(await c.req.json());
  } catch (err) {
    return c.json({ error: "bad_request", detail: (err as Error).message }, 400);
  }
  // Hard age floor — unlike reports (stored but not counted), an underage
  // application is rejected outright: the whole point of the whitelist is
  // trust, and a fresh GH account carries none.
  if (who.ageDays < REPORTER_MIN_AGE_DAYS) {
    return c.json({ error: "gh_account_too_young", minAgeDays: REPORTER_MIN_AGE_DAYS }, 403);
  }
  const fp = await reporterFingerprint(c.env, who.id);
  // Fail closed like the report path: never store a raw gh:<id>.
  if (!fp) {
    return c.json({ error: "report_salt_required", detail: "REPORT_SALT not configured" }, 503);
  }
  const now = Date.now();
  const aliases = reporterAliases(fp, who.id);
  const ban = await activeReporterBan(c.env, aliases, now);
  if (ban) {
    return c.json({ error: "reporter_banned", reason: ban.reason ?? "banned" }, 403);
  }
  if (!(await throttleOk(c.env, fp, now, REPORT_MAX_PER_WINDOW))) {
    return c.json({ error: "rate_limited", retryAfterMs: REPORT_WINDOW_MS }, 429);
  }

  const handle = normalizeHandle(body.handle);
  const uid = body.userId ?? null;

  // Already whitelisted → nothing to apply for.
  const cur = await findAccount(c.env, handle, uid);
  if (cur?.status === "whitelisted") {
    return c.json({ ok: true, status: "already_whitelisted" });
  }

  // One pending application per fingerprint AND per target handle.
  const dup = await c.env.DB.prepare(
    `SELECT id FROM whitelist_requests
      WHERE status='pending' AND (reporter_fp=? OR lower(handle)=?)
      LIMIT 1`,
  )
    .bind(fp, handle)
    .first<{ id: number }>();
  if (dup) return c.json({ error: "already_pending" }, 409);

  await c.env.DB.prepare(
    `INSERT INTO whitelist_requests
       (x_user_id, handle, reporter_fp, gh_age_days, note, status, created_at)
     VALUES (?,?,?,?,?,'pending',?)`,
  )
    .bind(uid, handle, fp, who.ageDays, body.note?.trim() || null, now)
    .run();
  await c.env.DB.prepare(
    "INSERT INTO review_log (x_user_id,handle,action,actor,note,at) VALUES (?,?,?,?,?,?)",
  )
    .bind(uid, handle, "whitelist_apply", reporterActor(fp), `age=${who.ageDays}d`, now)
    .run();
  await recordReportRate(c.env, fp, now);
  return c.json({ ok: true, status: "pending" });
});

// Latest application status for the calling identity — the extension's
// options page polls this to show pending/approved/rejected.
app.get("/v1/whitelist/apply/status", async (c) => {
  const who = await requireReporter(c);
  if (!who) return c.json({ error: "github_login_required" }, 401);
  const fp = await reporterFingerprint(c.env, who.id);
  if (!fp) {
    return c.json({ error: "report_salt_required", detail: "REPORT_SALT not configured" }, 503);
  }
  const row = await c.env.DB.prepare(
    `SELECT status, handle, created_at FROM whitelist_requests
      WHERE reporter_fp=? ORDER BY id DESC LIMIT 1`,
  )
    .bind(fp)
    .first<{ status: string; handle: string; created_at: number }>();
  if (!row) return c.json({ status: "none" });
  return c.json({ status: row.status, handle: row.handle, created_at: row.created_at });
});

// ---- Admin (守门员) ----
// Constant-time string comparison: hash both sides so length and content
// differences can't be probed via timing. SHA-256 digests are fixed-width,
// and the XOR fold below never early-exits.
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const ua = new Uint8Array(da);
  const ub = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < ua.length; i++) diff |= (ua[i] ?? 0) ^ (ub[i] ?? 0);
  return diff === 0;
}

async function admin(c: Ctx): Promise<boolean> {
  const t = c.env.ADMIN_TOKEN;
  const got = c.req.raw.headers.get("x-admin-token") ?? "";
  return !!t && !!got && (await timingSafeEqual(got, t));
}

const ReporterBanBody = z
  .object({
    reporterFp: z.string().min(1).max(128).optional(),
    githubId: z.string().regex(/^\d+$/).optional(),
    reason: z.string().max(500).optional(),
    expiresAt: z.number().int().positive().nullable().optional(),
  })
  .refine((v) => !!v.reporterFp !== !!v.githubId, {
    message: "provide exactly one of reporterFp or githubId",
  });

async function reporterFpForAdmin(
  env: Bindings,
  body: z.infer<typeof ReporterBanBody>,
): Promise<string | null> {
  if (body.reporterFp) return body.reporterFp.trim();
  if (!body.githubId) return null;
  return reporterFingerprint(env, `gh:${body.githubId}`);
}

app.get("/v1/admin/reporter-bans", async (c) => {
  if (!(await admin(c))) return c.json({ error: "forbidden" }, 403);
  const rows = await c.env.DB.prepare(
    `SELECT id, reporter_fp, reason, created_by, created_at, expires_at
       FROM reporter_bans
      ORDER BY created_at DESC, id DESC
      LIMIT 500`,
  ).all();
  return c.json({ bans: rows.results ?? [] });
});

app.post("/v1/admin/reporter-bans", async (c) => {
  if (!(await admin(c))) return c.json({ error: "forbidden" }, 403);
  let body: z.infer<typeof ReporterBanBody>;
  try {
    body = ReporterBanBody.parse(await c.req.json());
  } catch (err) {
    return c.json({ error: "bad_request", detail: (err as Error).message }, 400);
  }
  const fp = await reporterFpForAdmin(c.env, body);
  if (!fp) return c.json({ error: "report_salt_required" }, 503);
  const now = Date.now();
  const res = await c.env.DB.prepare(
    `INSERT INTO reporter_bans (reporter_fp, reason, created_by, created_at, expires_at)
     VALUES (?, ?, 'admin', ?, ?)`,
  )
    .bind(fp, body.reason ?? null, now, body.expiresAt ?? null)
    .run();
  return c.json({ ok: true, id: res.meta.last_row_id, reporterFp: fp });
});

app.delete("/v1/admin/reporter-bans/:id", async (c) => {
  if (!(await admin(c))) return c.json({ error: "forbidden" }, 403);
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "bad_id" }, 400);
  const res = await c.env.DB.prepare("DELETE FROM reporter_bans WHERE id=?").bind(id).run();
  return c.json({ ok: true, deleted: res.meta.changes ?? 0 });
});

app.post("/v1/admin/reporter-fingerprints/backfill", async (c) => {
  if (!(await admin(c))) return c.json({ error: "forbidden" }, 403);
  if (!c.env.REPORT_SALT?.trim()) return c.json({ error: "report_salt_required" }, 503);
  const rows = await c.env.DB.prepare(
    `SELECT reporter_fp AS fp FROM reports WHERE reporter_fp LIKE 'gh:%'
     UNION
     SELECT fp FROM rate_log WHERE fp LIKE 'gh:%'
     UNION
     SELECT reporter_fp AS fp FROM reporter_bans WHERE reporter_fp LIKE 'gh:%'`,
  ).all<{ fp: string }>();

  let reports = 0;
  let rateLog = 0;
  let bans = 0;
  for (const row of rows.results ?? []) {
    const fp = row.fp;
    const next = await reporterFingerprint(c.env, fp);
    if (!next || next === fp) continue;
    const [r1, r2, r3] = await c.env.DB.batch([
      c.env.DB.prepare("UPDATE reports SET reporter_fp=? WHERE reporter_fp=?").bind(next, fp),
      c.env.DB.prepare("UPDATE rate_log SET fp=? WHERE fp=?").bind(next, fp),
      c.env.DB.prepare("UPDATE reporter_bans SET reporter_fp=? WHERE reporter_fp=?").bind(next, fp),
    ]);
    reports += r1.meta.changes ?? 0;
    rateLog += r2.meta.changes ?? 0;
    bans += r3.meta.changes ?? 0;
  }
  return c.json({
    ok: true,
    scanned: rows.results?.length ?? 0,
    updated: { reports, rateLog, bans },
  });
});

type AdminSort =
  | "time_desc"
  | "severity"
  | "conf_desc"
  | "conf_asc"
  | "rep_desc"
  | "rep_asc"
  | "created_desc"
  | "created_asc"
  | "followers_desc"
  | "followers_asc"
  | "following_desc"
  | "following_asc";

const ADMIN_SORTS = new Set<AdminSort>([
  "time_desc",
  "severity",
  "conf_desc",
  "conf_asc",
  "rep_desc",
  "rep_asc",
  "created_desc",
  "created_asc",
  "followers_desc",
  "followers_asc",
  "following_desc",
  "following_asc",
]);

// Whether a sort needs the per-handle reporter aggregate joined into the dedup
// CTE so it can ORDER BY reporter count across the *whole* queue (not just the
// loaded page). Only rep_* pays for the extra reports scan.
function needsReportAgg(sort: AdminSort): boolean {
  return sort === "rep_desc" || sort === "rep_asc";
}

// Maps verdict_label → a coarse risk rank (mirrors the admin UI's `sev` map).
// Combined with confidence into a single monotonic sort_value so the keyset
// cursor (one value + tie-breakers) keeps working for the "风险等级" sort.
function severityRankExpr(alias: string): string {
  return `(CASE ${alias}.verdict_label
      WHEN 'spam' THEN 4
      WHEN 'porn_bot' THEN 4
      WHEN 'likely_spam' THEN 3
      WHEN 'uncertain' THEN 1
      WHEN 'legit' THEN 0
      ELSE 0 END) * 1000 + CAST(${alias}.confidence * 100 AS INTEGER)`;
}

function adminSort(raw: string | undefined | null): AdminSort {
  return ADMIN_SORTS.has(raw as AdminSort) ? (raw as AdminSort) : "time_desc";
}

function createdSortExpr(alias: string, timeColumn: string): string {
  return `CASE
    WHEN ${alias}.account_created_at IS NOT NULL AND ${alias}.account_created_at <> ''
      THEN ${alias}.account_created_at
    WHEN ${alias}.account_age_days IS NOT NULL AND ${alias}.${timeColumn} IS NOT NULL
      THEN strftime(
        '%Y-%m-%dT%H:%M:%SZ',
        CAST((${alias}.${timeColumn} / 1000) - (${alias}.account_age_days * 86400) AS INTEGER),
        'unixepoch'
      )
    ELSE NULL
  END`;
}

function sortValueExpr(alias: string, sort: AdminSort, timeColumn: string): string {
  if (sort === "severity") return severityRankExpr(alias);
  if (sort === "conf_desc" || sort === "conf_asc") return `${alias}.confidence`;
  // rep_* sorts read the joined per-handle aggregate (rc.cnt); see the queue
  // handler where the LEFT JOIN is conditionally added.
  if (sort === "rep_desc" || sort === "rep_asc") return "coalesce(rc.cnt, 0)";
  if (sort === "created_desc" || sort === "created_asc") return createdSortExpr(alias, timeColumn);
  if (sort === "followers_desc" || sort === "followers_asc") return `${alias}.followers_count`;
  if (sort === "following_desc" || sort === "following_asc") return `${alias}.following_count`;
  return `${alias}.${timeColumn}`;
}

function sortDirection(sort: AdminSort): "ASC" | "DESC" {
  return sort.endsWith("_asc") ? "ASC" : "DESC";
}

function sortOrderSql(sort: AdminSort, timeColumn: string): string {
  return `a.sort_value IS NULL ASC, a.sort_value ${sortDirection(sort)}, a.${timeColumn} DESC, a.rid DESC`;
}

interface SortCursor {
  value: string | number | null;
  tie: number;
  rid: number;
}

// btoa()/atob() only handle latin-1, but sort_value can carry raw CJK strings
// (account_created_at keeps unparseable date strings verbatim — see
// normalizedAccountCreatedAt). Round-trip through UTF-8 bytes instead.
function b64EncodeUtf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] ?? 0);
  return btoa(bin);
}

function b64DecodeUtf8(s: string): string {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function encodeSortCursor(
  row: { sort_value: string | number | null; rid: number },
  time: number,
): string {
  return b64EncodeUtf8(JSON.stringify([row.sort_value ?? null, time, row.rid]));
}

function decodeSortCursor(raw: string | null): SortCursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(b64DecodeUtf8(raw));
    if (!Array.isArray(parsed) || parsed.length < 3) return null;
    const [value, tie, rid] = parsed;
    if (value !== null && typeof value !== "string" && typeof value !== "number") return null;
    if (typeof tie !== "number" || typeof rid !== "number") return null;
    return { value, tie, rid };
  } catch {
    return null;
  }
}

function sortCursorWhere(sort: AdminSort, timeColumn: string, cursor: SortCursor | null) {
  if (!cursor) return { sql: "1=1", binds: [] as unknown[] };
  const op = sortDirection(sort) === "DESC" ? "<" : ">";
  return {
    sql: `(
      (? IS NULL AND a.sort_value IS NULL AND (a.${timeColumn} < ? OR (a.${timeColumn} = ? AND a.rid < ?)))
      OR
      (? IS NOT NULL AND (
           a.sort_value IS NULL
        OR a.sort_value ${op} ?
        OR (a.sort_value = ? AND (a.${timeColumn} < ? OR (a.${timeColumn} = ? AND a.rid < ?)))
      ))
    )`,
    binds: [
      cursor.value,
      cursor.tie,
      cursor.tie,
      cursor.rid,
      cursor.value,
      cursor.value,
      cursor.value,
      cursor.tie,
      cursor.tie,
      cursor.rid,
    ] as unknown[],
  };
}

// ---- Free-text admin filters ----
// The `q` + per-field text half of the admin filter set, shared verbatim by
// /v1/admin/queue, /v1/admin/blacklist and /v1/admin/decide-by-filter. It
// lived as three hand-copied SQL blocks; the blacklist copy silently lacked
// the per-field filters entirely, so the same filter UI meant different things
// depending on which tab you were standing in. One builder = one behavior.
//
//   q             — multi-field fuzzy. Auto-routed: a purely numeric q with no
//                   explicit `uid` is treated as a uid prefix (that's someone
//                   pasting an X numeric id), otherwise a case-insensitive
//                   substring across handle / display_name / evidence_text /
//                   reasons.
//   uid           — x_user_id prefix (so '2056413' surfaces a whole
//                   batch-created cluster).
//   handle / evidence / display_name / reasons — case-insensitive substrings.
//
// SQLite LIKE is ASCII-case-insensitive by default; both sides are lower()ed
// so handles behave consistently with idx_accounts_handle_norm.
interface TextFilters {
  q: string | null;
  uid: string | null;
  handle: string | null;
  evidence: string | null;
  displayName: string | null;
  reasons: string | null;
}

function parseTextFilters(get: (k: string) => string | undefined): TextFilters {
  const str = (k: string) => (get(k) || "").trim() || null;
  let q = (get("q") || "").trim().replace(/^@+/, "") || null;
  let uid = str("uid");
  if (q && /^\d+$/.test(q) && !uid) {
    uid = q;
    q = null;
  }
  return {
    q,
    uid,
    handle: str("handle"),
    evidence: str("evidence"),
    displayName: str("display_name"),
    reasons: str("reasons"),
  };
}

function textFilterWhere(alias: string, f: TextFilters): { sql: string; binds: unknown[] } {
  const a = alias;
  return {
    sql: `
          AND (? IS NULL OR (
                 lower(${a}.handle) LIKE '%' || lower(?) || '%'
              OR ${a}.x_user_id LIKE ? || '%'
              OR lower(coalesce(${a}.display_name,'')) LIKE '%' || lower(?) || '%'
              OR lower(coalesce(${a}.evidence_text,'')) LIKE '%' || lower(?) || '%'
              OR lower(coalesce(${a}.reasons,'')) LIKE '%' || lower(?) || '%'
          ))
          AND (? IS NULL OR ${a}.x_user_id LIKE ? || '%')
          AND (? IS NULL OR lower(${a}.handle) LIKE '%' || lower(?) || '%')
          AND (? IS NULL OR lower(coalesce(${a}.evidence_text,'')) LIKE '%' || lower(?) || '%')
          AND (? IS NULL OR lower(coalesce(${a}.display_name,'')) LIKE '%' || lower(?) || '%')
          AND (? IS NULL OR lower(coalesce(${a}.reasons,'')) LIKE '%' || lower(?) || '%')`,
    binds: [
      f.q,
      f.q,
      f.q,
      f.q,
      f.q,
      f.q,
      f.uid,
      f.uid,
      f.handle,
      f.handle,
      f.evidence,
      f.evidence,
      f.displayName,
      f.displayName,
      f.reasons,
      f.reasons,
    ],
  };
}

function textFiltersEcho(f: TextFilters): Record<string, string | null> {
  return {
    q: f.q,
    uid: f.uid,
    handle: f.handle,
    evidence: f.evidence,
    display_name: f.displayName,
    reasons: f.reasons,
  };
}

// ---- Multi-dimension admin filters ----
// Structured, AND-combined dimensions shared by /v1/admin/queue,
// /v1/admin/blacklist and /v1/admin/decide-by-filter. Everything is bound
// (never interpolated); a missing/blank param disables that dimension via
// the `(? IS NULL OR …)` pattern so the statement shape stays constant.
interface DimFilters {
  followersMin: number | null;
  followersMax: number | null;
  followingMin: number | null;
  followingMax: number | null;
  createdAfter: string | null; // YYYY-MM-DD, inclusive
  createdBefore: string | null; // YYYY-MM-DD, inclusive
  category: string | null;
  verdict: string | null;
  source: string | null;
  tier: string | null; // published_tier (blacklist views)
}

function parseDimFilters(get: (k: string) => string | undefined): DimFilters {
  const num = (k: string): number | null => {
    const raw = (get(k) || "").trim();
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  const date = (k: string): string | null => {
    const raw = (get(k) || "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
  };
  const str = (k: string): string | null => (get(k) || "").trim() || null;
  return {
    followersMin: num("followers_min"),
    followersMax: num("followers_max"),
    followingMin: num("following_min"),
    followingMax: num("following_max"),
    createdAfter: date("created_after"),
    createdBefore: date("created_before"),
    category: str("category"),
    verdict: str("verdict"),
    source: str("source"),
    tier: str("tier"),
  };
}

function dimFiltersEcho(f: DimFilters): Record<string, string | number | null> {
  return {
    followers_min: f.followersMin,
    followers_max: f.followersMax,
    following_min: f.followingMin,
    following_max: f.followingMax,
    created_after: f.createdAfter,
    created_before: f.createdBefore,
    category: f.category,
    verdict: f.verdict,
    source: f.source,
    tier: f.tier,
  };
}

// Registration-date comparisons run against the same normalized expression
// the created_* sorts use (ISO string, or one derived from account_age_days),
// truncated to YYYY-MM-DD so lexicographic <=/>= equals date comparison.
// Rows with no observable registration date are excluded when a created_*
// bound is set — an unknown age must not pass an age filter.
function dimFilterWhere(
  alias: string,
  f: DimFilters,
  timeColumn: string,
): { sql: string; binds: unknown[] } {
  const created = `substr(${createdSortExpr(alias, timeColumn)}, 1, 10)`;
  return {
    sql: `
      AND (? IS NULL OR ${alias}.followers_count >= ?)
      AND (? IS NULL OR ${alias}.followers_count <= ?)
      AND (? IS NULL OR ${alias}.following_count >= ?)
      AND (? IS NULL OR ${alias}.following_count <= ?)
      AND (? IS NULL OR ${created} >= ?)
      AND (? IS NULL OR ${created} <= ?)
      AND (? IS NULL OR ${alias}.category = ?)
      AND (? IS NULL OR ${alias}.verdict_label = ?)
      AND (? IS NULL OR ${alias}.source = ?)
      AND (? IS NULL OR coalesce(${alias}.published_tier,'') = ?)`,
    binds: [
      f.followersMin,
      f.followersMin,
      f.followersMax,
      f.followersMax,
      f.followingMin,
      f.followingMin,
      f.followingMax,
      f.followingMax,
      f.createdAfter,
      f.createdAfter,
      f.createdBefore,
      f.createdBefore,
      f.category,
      f.category,
      f.verdict,
      f.verdict,
      f.source,
      f.source,
      f.tier,
      f.tier,
    ],
  };
}

// Count rows matching a list view's filter set, reusing that view's own CTE so
// "命中 N 条" can never disagree with what the list actually returns.
async function countMatches(
  env: Bindings,
  cte: string,
  binds: unknown[],
  fromWhere: string,
): Promise<number> {
  const row = await env.DB.prepare(`${cte} SELECT count(*) AS n ${fromWhere}`)
    .bind(...binds)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

app.get("/v1/admin/queue", async (c) => {
  if (!(await admin(c))) return c.json({ error: "forbidden" }, 403);
  // Keyset pagination on last_scored DESC. Same dedup-by-handle CTE as before;
  // the cursor is the last_scored of the last row in the previous page, so the
  // next page strictly less-than. Total queue size is exposed via /v1/admin/stats
  // (computed against the same deduped set) so the UI can show "N more" hints
  // without re-counting client-side.
  //
  // Filters (all optional, all AND-combined, all applied INSIDE the dedup CTE
  // so search returns one canonical row per handle, not all variants). The
  // text half is built by textFilterWhere and is byte-identical to the one
  // /v1/admin/blacklist and /v1/admin/decide-by-filter use.
  const sort = adminSort(c.req.query("sort"));
  const cursor = decodeSortCursor(c.req.query("before") || null);
  const limit = Math.min(200, Math.max(1, Number(c.req.query("limit")) || 100));
  // Page-number pagination. `offset` (rows to skip) wins over the keyset
  // cursor when present — the console needs "jump to page N", which a cursor
  // cannot express. The cursor path stays for callers that still use it.
  const offset = Math.max(0, Math.floor(Number(c.req.query("offset")) || 0));
  const cursorWhere = offset > 0 ? { sql: "1=1", binds: [] as unknown[] } : sortCursorWhere(sort, "last_scored", cursor);
  const text = parseTextFilters((k) => c.req.query(k));
  const textWhere = textFilterWhere("a", text);
  const dims = parseDimFilters((k) => c.req.query(k));
  const dimWhere = dimFilterWhere("a", dims, "last_scored");

  const sortExpr = sortValueExpr("a", sort, "last_scored");
  // For the "举报人数" sort we need the reporter count for *every* pending row
  // (so ORDER BY can rank the whole queue, not just the page). One indexed
  // GROUP BY scan of reports — joined in by normalized handle — backs the
  // sort_value. The displayed `reporters` column below stays the exact,
  // uid-aware correlated count; this aggregate is the (handle-level) ordering
  // key only, so it's cheap and added only when actually sorting by it.
  const repJoin = needsReportAgg(sort)
    ? `LEFT JOIN (
         SELECT lower(handle) AS h, count(DISTINCT reporter_fp) AS cnt
           FROM reports GROUP BY lower(handle)
       ) rc ON rc.h = lower(a.handle)`
    : "";
  const cte = `WITH ranked AS (
       SELECT a.rowid AS rid,
              a.*,
              ${sortExpr} AS sort_value,
              row_number() OVER (
                PARTITION BY lower(a.handle)
                ORDER BY CASE WHEN a.x_user_id IS NOT NULL THEN 0 ELSE 1 END,
                         a.last_scored DESC
              ) AS rn
         FROM accounts a
         ${repJoin}
        WHERE a.status='auto_pending_review'
          ${textWhere.sql}
          ${dimWhere.sql}
     )`;
  // `total=1` runs the matching COUNT over the same filter set. The UI asks for
  // it when the filters change and reuses it while paging, so a page turn never
  // re-scans the partition just to redraw the same number.
  const total = (await c.req.query("total")) === "1" ? await countMatches(c.env, cte, [...textWhere.binds, ...dimWhere.binds], "FROM ranked WHERE rn=1") : null;
  const rows = await c.env.DB.prepare(
    `${cte}
     SELECT a.rid, a.sort_value,
            a.x_user_id, a.handle, a.display_name, a.avatar_url, a.verdict_label, a.confidence,
            a.account_created_at, a.account_age_days, a.followers_count, a.following_count,
            a.reasons, a.evidence_text, a.last_scored, a.source, a.category,
            (SELECT count(DISTINCT reporter_fp) FROM reports r
              WHERE lower(r.handle)=lower(a.handle)
                AND (a.x_user_id IS NULL OR r.x_user_id IS NULL OR r.x_user_id=a.x_user_id)
            ) reporters
       FROM ranked a
      WHERE a.rn=1
        AND ${cursorWhere.sql}
      ORDER BY ${sortOrderSql(sort, "last_scored")} LIMIT ? OFFSET ?`,
  )
    .bind(...textWhere.binds, ...dimWhere.binds, ...cursorWhere.binds, limit, offset)
    .all<{ rid: number; sort_value: string | number | null; last_scored: number }>();
  const rawList = rows.results ?? [];
  const list = rawList.map(({ rid: _rid, sort_value: _sortValue, ...row }) => row);
  const last = rawList[rawList.length - 1];
  return c.json({
    queue: list,
    nextBefore: rawList.length === limit && last ? encodeSortCursor(last, last.last_scored) : null,
    total,
    offset,
    // Echo back the effective filter set so the UI can keep the inputs in
    // sync (especially after the smart `q` → `uid` rewrite above).
    appliedFilters: { ...textFiltersEcho(text), sort, ...dimFiltersEcho(dims) },
  });
});

// True per-table counts. Cheap GROUP BY across the accounts table + the dedup
// view that backs /v1/admin/queue. Lets the admin panel tab chips show the
// real total instead of "however many we've loaded into memory".
app.get("/v1/admin/stats", async (c) => {
  if (!(await admin(c))) return c.json({ error: "forbidden" }, 403);
  const statusRows = await c.env.DB.prepare(
    "SELECT status, count(*) AS n FROM accounts GROUP BY status",
  ).all<{ status: string; n: number }>();
  // Queue total mirrors the dedup-by-handle rule used in /v1/admin/queue so
  // "待审 N 条" matches what the maintainer can actually see + act on.
  const queueRow = await c.env.DB.prepare(
    `SELECT count(*) AS n FROM (
       SELECT 1 FROM accounts
        WHERE status='auto_pending_review'
        GROUP BY lower(handle)
     )`,
  ).first<{ n: number }>();
  const reportsRow = await c.env.DB.prepare("SELECT count(*) AS n FROM reports").first<{
    n: number;
  }>();
  // Pending self-service whitelist applications — the 白名单申请 tab had no
  // count chip, so a fresh application was invisible until someone opened it.
  const wlReqRow = await c.env.DB.prepare(
    "SELECT count(*) AS n FROM whitelist_requests WHERE status='pending'",
  ).first<{ n: number }>();
  const byStatus: Record<string, number> = {};
  for (const r of statusRows.results ?? []) byStatus[r.status] = r.n;
  return c.json({
    queue: queueRow?.n ?? 0,
    blacklist: byStatus.human_confirmed ?? 0,
    whitelist: byStatus.whitelisted ?? 0,
    rejected: byStatus.rejected ?? 0,
    removed: byStatus.removed ?? 0,
    auto_legit: byStatus.auto_legit ?? 0,
    pending_raw: byStatus.auto_pending_review ?? 0,
    reports: reportsRow?.n ?? 0,
    whitelist_requests: wlReqRow?.n ?? 0,
    // Agent staging buckets — populated by the side-channel agent pipeline
    // (see docs/AGENT.md). These rows are NOT on the public list yet; they
    // wait for a human (or governance auto-promotion) to flip them.
    agent_blacklist: byStatus.agent_blacklist ?? 0,
    agent_whitelist: byStatus.agent_whitelist ?? 0,
    agent_pending: byStatus.agent_pending ?? 0,
  });
});
type DecideAction = "approve" | "reject" | "remove" | "whitelist";

function statusForAction(action: DecideAction): string {
  return action === "approve"
    ? "human_confirmed"
    : action === "remove"
      ? "removed"
      : action === "whitelist"
        ? "whitelisted"
        : "rejected";
}

// Build the prepared-statement array for a single decide on one (handle, uid?)
// pair. Shared between /v1/admin/decide (single) and /v1/admin/decide-batch
// (D1 batch transaction) so the SQL stays in one place — no risk of the
// batch path drifting from the single path's behavior.
//
// Returns 2 statements when xUserId is given (target row + sibling-handle
// cleanup), 1 when handle-only. The last statement appended by the caller
// is always the review_log INSERT.
function buildDecideStatements(
  env: Bindings,
  handle: string,
  xUserId: string | undefined,
  action: DecideAction,
  now: number,
  category?: SpamCategory,
): D1PreparedStatement[] {
  const status = statusForAction(action);
  // COALESCE keeps whatever category the row already carries when the admin
  // didn't pick one; whitelist always clears it (legit accounts have no spam
  // category by definition).
  const cat = category ?? null;
  const stmts: D1PreparedStatement[] = [];
  if (xUserId) {
    if (action === "whitelist") {
      stmts.push(
        env.DB.prepare(
          `UPDATE accounts
              SET status='whitelisted',
                  source='admin_whitelist',
                  verdict_label='legit',
                  confidence=1.0,
                  reasons='["whitelisted by admin"]',
                  signals_hash=NULL,
                  category=NULL,
                  last_scored=?,
                  published_at=NULL
            WHERE lower(handle)=? AND x_user_id=?`,
        ).bind(now, handle, xUserId),
      );
    } else {
      stmts.push(
        env.DB.prepare(
          "UPDATE accounts SET status=?, published_at=?, published_tier=?, category=COALESCE(?, category) WHERE lower(handle)=? AND x_user_id=?",
        ).bind(
          status,
          action === "approve" ? now : null,
          action === "approve" ? "human" : null,
          cat,
          handle,
          xUserId,
        ),
      );
    }
    // Sibling cleanup: when a uid-bearing row was just promoted/demoted, also
    // sweep any handle-only auto_pending_review siblings (they're stale).
    stmts.push(
      env.DB.prepare(
        `UPDATE accounts SET status=?, published_at=NULL
          WHERE lower(handle)=? AND x_user_id IS NULL AND status='auto_pending_review'`,
      ).bind(action === "approve" || action === "whitelist" ? "removed" : status, handle),
    );
  } else {
    if (action === "whitelist") {
      stmts.push(
        env.DB.prepare(
          `UPDATE accounts
              SET status='whitelisted',
                  source='admin_whitelist',
                  verdict_label='legit',
                  confidence=1.0,
                  reasons='["whitelisted by admin"]',
                  signals_hash=NULL,
                  category=NULL,
                  last_scored=?,
                  published_at=NULL
            WHERE lower(handle)=? AND x_user_id IS NULL`,
        ).bind(now, handle),
      );
    } else {
      stmts.push(
        env.DB.prepare(
          "UPDATE accounts SET status=?, published_at=?, published_tier=?, category=COALESCE(?, category) WHERE lower(handle)=? AND x_user_id IS NULL",
        ).bind(
          status,
          action === "approve" ? now : null,
          action === "approve" ? "human" : null,
          cat,
          handle,
        ),
      );
    }
  }
  return stmts;
}

function reviewLogStmt(
  env: Bindings,
  xUserId: string | null,
  handle: string,
  action: string,
  note: string,
  now: number,
): D1PreparedStatement {
  return env.DB.prepare(
    "INSERT INTO review_log (x_user_id,handle,action,actor,note,at) VALUES (?,?,?,?,?,?)",
  ).bind(xUserId, handle, action, "admin", note, now);
}

// Run variable-length write lists through D1 in bounded batches and return the
// number of rows D1 says actually changed. Oversized batches have previously
// returned success without applying their statements, so no per-item admin
// write path may call DB.batch directly.
const D1_BATCH_MAX = 100;
async function batchAll(env: Bindings, stmts: D1PreparedStatement[]): Promise<number> {
  let changes = 0;
  for (let i = 0; i < stmts.length; i += D1_BATCH_MAX) {
    const results = await env.DB.batch(stmts.slice(i, i + D1_BATCH_MAX));
    for (const result of results) changes += result.meta?.changes ?? 0;
  }
  return changes;
}

// An optional numeric id (x_user_id / github id). Tolerates an explicit JSON
// null — clients commonly spread a possibly-null id field — by normalizing it
// to undefined so the rest of the pipeline sees `string | undefined`.
const optionalNumericId = z
  .string()
  .regex(/^\d+$/)
  .nullish()
  .transform((v) => v ?? undefined);

const DecideBody = z.object({
  handle: z.string().min(1),
  xUserId: optionalNumericId,
  // Unknown actions used to silently map to "rejected" via statusForAction —
  // they are an explicit 400 now.
  action: z.enum(["approve", "reject", "remove", "whitelist"]),
  // Optional human-assigned spam category, stamped alongside the decision so
  // the maintainer can approve-and-categorize in one step. Ignored for
  // whitelist (which clears category).
  category: z.enum(SPAM_CATEGORIES).optional(),
});

app.post("/v1/admin/decide", async (c) => {
  if (!(await admin(c))) return c.json({ error: "forbidden" }, 403);
  let body: z.infer<typeof DecideBody>;
  try {
    body = DecideBody.parse(await c.req.json());
  } catch (err) {
    return c.json({ error: "bad_request", detail: (err as Error).message }, 400);
  }
  const handle = normalizeHandle(body.handle);
  const xUserId = body.xUserId;
  const action = body.action;
  const now = Date.now();
  const stmts = buildDecideStatements(c.env, handle, xUserId, action, now, body.category);
  stmts.push(
    reviewLogStmt(
      c.env,
      xUserId ?? null,
      handle,
      action,
      body.category ? `panel category=${body.category}` : "panel",
      now,
    ),
  );
  await batchAll(c.env, stmts);
  return c.json({ ok: true, status: statusForAction(action) });
});

// Batch decide — accepts up to 100 items and one homogeneous action. The
// prepared statements are sent in bounded D1 transactions.
// Speeds up "拉黑这 80 条" from ~10s of sequential network round-trips to
// ~300ms in one shot, and removes the half-applied state risk on network
// hiccups mid-batch.
//
// Body: { action: "approve"|"reject"|"remove"|"whitelist",
//         category?: SpamCategory,
//         items: [{ handle: string, xUserId?: string }, ...] }
const DecideBatchBody = z.object({
  action: z.enum(["approve", "reject", "remove", "whitelist"]),
  category: z.enum(SPAM_CATEGORIES).optional(),
  items: z
    .array(
      z.object({
        handle: z.string().min(1),
        xUserId: optionalNumericId,
      }),
    )
    .min(1)
    .max(100),
});

app.post("/v1/admin/decide-batch", async (c) => {
  if (!(await admin(c))) return c.json({ error: "forbidden" }, 403);
  let body: z.infer<typeof DecideBatchBody>;
  try {
    body = DecideBatchBody.parse(await c.req.json());
  } catch (err) {
    return c.json({ error: "bad_request", detail: (err as Error).message }, 400);
  }
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  const batchNote = body.category ? `panel_batch category=${body.category}` : "panel_batch";
  for (const it of body.items) {
    const h = normalizeHandle(it.handle);
    stmts.push(...buildDecideStatements(c.env, h, it.xUserId, body.action, now, body.category));
    stmts.push(reviewLogStmt(c.env, it.xUserId ?? null, h, body.action, batchNote, now));
  }
  await batchAll(c.env, stmts);
  return c.json({
    ok: true,
    status: statusForAction(body.action),
    processed: body.items.length,
  });
});

// Filter-scoped batch decide — acts on EVERY queue row matching a filter set
// (the same text + dimension filters /v1/admin/queue accepts), not just the
// rows the UI happened to have loaded. Two-phase by design: the UI first
// calls dryRun:true to show the maintainer the exact row count, then executes
// after explicit confirmation. Capped per call; the response reports
// truncation so a huge sweep is several deliberate clicks, not one blind one.
const DECIDE_BY_FILTER_MAX = 2000;
const DecideByFilterBody = z.object({
  // 'categorize' stamps a spam category without touching status — the
  // "这一整批筛出来的都是博彩" flow on rows that are already on the public list.
  action: z.enum(["approve", "reject", "remove", "whitelist", "categorize"]),
  // Which partition the filters select from. 'queue' = 待审队列
  // (auto_pending_review, deduped by handle); 'blacklist' = 公榜
  // (human_confirmed). Same filter grammar either way.
  scope: z.enum(["queue", "blacklist"]).optional().default("queue"),
  category: z.enum(SPAM_CATEGORIES).optional(),
  dryRun: z.boolean().optional().default(false),
  filters: z.record(z.string(), z.string()).optional().default({}),
});

app.post("/v1/admin/decide-by-filter", async (c) => {
  if (!(await admin(c))) return c.json({ error: "forbidden" }, 403);
  let body: z.infer<typeof DecideByFilterBody>;
  try {
    body = DecideByFilterBody.parse(await c.req.json());
  } catch (err) {
    return c.json({ error: "bad_request", detail: (err as Error).message }, 400);
  }
  if (body.action === "categorize" && !body.category) {
    return c.json({ error: "bad_request", detail: "categorize requires a category" }, 400);
  }
  // 公榜行已经在榜上，再「拉黑」一次没有意义，还会重置 published_at —— 直接拒掉，
  // 避免 UI 误传一个看起来无害却会改写收录时间的动作。
  if (body.scope === "blacklist" && body.action === "approve") {
    return c.json({ error: "bad_request", detail: "approve is not valid on the blacklist" }, 400);
  }
  const get = (k: string) => body.filters[k];
  const text = parseTextFilters(get);
  const textWhere = textFilterWhere("a", text);
  const dims = parseDimFilters(get);
  const onQueue = body.scope !== "blacklist";
  const dimWhere = dimFilterWhere("a", dims, onQueue ? "last_scored" : "published_at");

  // Targets are selected exactly the way the matching list view selects them,
  // so "命中 N 条" here equals the N the maintainer is looking at: the queue
  // dedups by handle (one canonical row per handle), the blacklist does not.
  // Both shapes expose `rid/x_user_id/handle/rn` so everything downstream is
  // scope-agnostic.
  const cte = onQueue
    ? `WITH ranked AS (
       SELECT a.rowid AS rid,
              a.x_user_id, a.handle,
              row_number() OVER (
                PARTITION BY lower(a.handle)
                ORDER BY CASE WHEN a.x_user_id IS NOT NULL THEN 0 ELSE 1 END,
                         a.last_scored DESC
              ) AS rn
         FROM accounts a
        WHERE a.status='auto_pending_review'
          ${textWhere.sql}
          ${dimWhere.sql}
     )`
    : `WITH ranked AS (
       SELECT a.rowid AS rid, a.x_user_id, a.handle, 1 AS rn
         FROM accounts a
        WHERE a.status='human_confirmed'
          ${textWhere.sql}
          ${dimWhere.sql}
     )`;
  const binds = [...textWhere.binds, ...dimWhere.binds];
  const countRow = await c.env.DB.prepare(`${cte} SELECT count(*) AS n FROM ranked WHERE rn=1`)
    .bind(...binds)
    .first<{ n: number }>();
  const matched = countRow?.n ?? 0;
  if (body.dryRun) {
    return c.json({ ok: true, dryRun: true, matched, cap: DECIDE_BY_FILTER_MAX });
  }
  const rows = await c.env.DB.prepare(
    `${cte} SELECT rid, x_user_id, handle FROM ranked WHERE rn=1 ORDER BY rid LIMIT ?`,
  )
    .bind(...binds, DECIDE_BY_FILTER_MAX)
    .all<{ rid: number; x_user_id: string | null; handle: string }>();
  const targets = rows.results ?? [];
  const now = Date.now();
  // Compact filter fingerprint for the audit trail (dropped empties, ≤180 chars).
  const filterNote = JSON.stringify(
    Object.fromEntries(Object.entries(body.filters).filter(([, v]) => (v ?? "").trim())),
  ).slice(0, 180);
  const note = `filter_batch scope=${body.scope}${
    body.category ? ` category=${body.category}` : ""
  } filters=${filterNote}`;
  const stmts: D1PreparedStatement[] = [];
  for (const t of targets) {
    const h = normalizeHandle(t.handle);
    if (body.action === "categorize") {
      // Category only — status/published_at untouched. Addressed by rowid so a
      // handle collision can't drag a sibling row along.
      stmts.push(
        c.env.DB.prepare("UPDATE accounts SET category=? WHERE rowid=?").bind(body.category, t.rid),
      );
    } else {
      stmts.push(
        ...buildDecideStatements(c.env, h, t.x_user_id ?? undefined, body.action, now, body.category),
      );
    }
    stmts.push(reviewLogStmt(c.env, t.x_user_id, h, body.action, note, now));
  }
  const CHUNK = 100;
  for (let i = 0; i < stmts.length; i += CHUNK) {
    await c.env.DB.batch(stmts.slice(i, i + CHUNK));
  }
  return c.json({
    ok: true,
    status: body.action === "categorize" ? null : statusForAction(body.action),
    scope: body.scope,
    matched,
    processed: targets.length,
    truncated: matched > targets.length,
  });
});

// Batch categorize — stamps a human-assigned spam category onto a list of
// accounts WITHOUT touching status/published_at. This is the "这批都是博彩"
// flow on already-confirmed rows; queue rows can categorize at approve time
// via decide-batch's optional category instead. Same atomic-batch contract.
const CategoryBatchBody = z.object({
  category: z.enum(SPAM_CATEGORIES),
  items: z
    .array(
      z.object({
        handle: z.string().min(1),
        xUserId: optionalNumericId,
      }),
    )
    .min(1)
    .max(100),
});

app.post("/v1/admin/category-batch", async (c) => {
  if (!(await admin(c))) return c.json({ error: "forbidden" }, 403);
  let body: z.infer<typeof CategoryBatchBody>;
  try {
    body = CategoryBatchBody.parse(await c.req.json());
  } catch (err) {
    return c.json({ error: "bad_request", detail: (err as Error).message }, 400);
  }
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  for (const it of body.items) {
    const h = normalizeHandle(it.handle);
    const uid = it.xUserId ?? null;
    stmts.push(
      c.env.DB.prepare(
        "UPDATE accounts SET category=? WHERE lower(handle)=? AND (x_user_id IS ? OR x_user_id=?)",
      ).bind(body.category, h, uid, uid),
    );
    stmts.push(
      reviewLogStmt(c.env, uid, h, "categorize", `panel_batch category=${body.category}`, now),
    );
  }
  const changes = await batchAll(c.env, stmts);
  return c.json({
    ok: true,
    category: body.category,
    processed: body.items.length,
    updated: Math.max(0, changes - body.items.length),
  });
});

// Batch whitelist-remove — drops a list of accounts from the whitelist back
// to 'rejected'. Same atomic-batch contract as decide-batch.
const WhitelistBatchBody = z.object({
  items: z
    .array(
      z.object({
        handle: z.string().min(1),
        xUserId: optionalNumericId,
      }),
    )
    .min(1)
    .max(100),
});

app.delete("/v1/admin/whitelist-batch", async (c) => {
  if (!(await admin(c))) return c.json({ error: "forbidden" }, 403);
  let body: z.infer<typeof WhitelistBatchBody>;
  try {
    body = WhitelistBatchBody.parse(await c.req.json());
  } catch (err) {
    return c.json({ error: "bad_request", detail: (err as Error).message }, 400);
  }
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  for (const it of body.items) {
    const h = normalizeHandle(it.handle);
    const uid = it.xUserId ?? null;
    // Mirror the single DELETE endpoint: drop to 'rejected' (preserve audit),
    // keep the row, log the removal.
    stmts.push(
      c.env.DB.prepare(
        `UPDATE accounts SET status='rejected', source='admin_whitelist', last_scored=?
          WHERE lower(handle)=? AND (x_user_id IS ? OR x_user_id=?) AND status='whitelisted'`,
      ).bind(now, h, uid, uid),
    );
    stmts.push(reviewLogStmt(c.env, uid, h, "whitelist_remove", "panel_batch", now));
  }
  const changes = await batchAll(c.env, stmts);
  return c.json({
    ok: true,
    processed: body.items.length,
    updated: Math.max(0, changes - body.items.length),
  });
});

// Paginated AI/decision audit trail. Keyset pagination on the id PK
// (DESC) — O(limit), no OFFSET scan, cheap on D1 at any size.
app.get("/v1/admin/log", async (c) => {
  if (!(await admin(c))) return c.json({ error: "forbidden" }, 403);
  const before = Number(c.req.query("before")) || null;
  const limit = Math.min(100, Number(c.req.query("limit")) || 50);
  const rows = await c.env.DB.prepare(
    `SELECT id, x_user_id, handle, action, actor, note, at
       FROM review_log
       WHERE (?1 IS NULL OR id < ?1)
       ORDER BY id DESC LIMIT ?2`,
  )
    .bind(before, limit)
    .all();
  const list = rows.results ?? [];
  return c.json({
    log: list,
    nextCursor: list.length === limit ? (list[list.length - 1] as { id: number }).id : null,
  });
});

// ---- Keyword rules (Wave G) ---------------------------------------------
// Maintainer-curated rules that short-circuit the LLM in /v1/classify.
// CRUD + preview + apply-to-queue. Every mutation invalidates the in-memory
// rule cache so the next /v1/classify call sees the new state ≤30s later.

const KeywordRuleField = z.enum(["handle", "display_name", "bio", "tweet", "any"]);
const KeywordRuleAction = z.enum(["blacklist", "whitelist", "reject"]);
const KeywordVerdictLabel = z.enum(["spam", "porn_bot", "likely_spam", "uncertain", "legit"]);

const KeywordRuleCategory = z.enum(SPAM_CATEGORIES);

const KeywordRuleCreate = z.object({
  pattern: z.string().min(1).max(200),
  field: KeywordRuleField,
  action: KeywordRuleAction.default("blacklist"),
  verdict_label: KeywordVerdictLabel.default("spam"),
  category: KeywordRuleCategory.optional(),
  note: z.string().max(400).optional(),
});

const KeywordRulePatch = z.object({
  pattern: z.string().min(1).max(200).optional(),
  field: KeywordRuleField.optional(),
  action: KeywordRuleAction.optional(),
  verdict_label: KeywordVerdictLabel.optional(),
  category: KeywordRuleCategory.nullable().optional(),
  enabled: z.boolean().optional(),
  note: z.string().max(400).optional(),
});

app.get("/v1/admin/keyword-rules", async (c) => {
  if (!(await admin(c))) return c.json({ error: "forbidden" }, 403);
  const rows = await c.env.DB.prepare(
    "SELECT * FROM keyword_rules ORDER BY enabled DESC, hit_count DESC, id DESC",
  ).all<KeywordRule>();
  return c.json({ rules: rows.results ?? [] });
});

app.post("/v1/admin/keyword-rules", async (c) => {
  if (!(await admin(c))) return c.json({ error: "forbidden" }, 403);
  let body: z.infer<typeof KeywordRuleCreate>;
  try {
    body = KeywordRuleCreate.parse(await c.req.json());
  } catch (err) {
    return c.json({ error: "bad_request", detail: (err as Error).message }, 400);
  }
  const now = Date.now();
  const r = await c.env.DB.prepare(
    `INSERT INTO keyword_rules
       (pattern, field, action, verdict_label, category, enabled, note, created_at, hit_count)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, 0)`,
  )
    .bind(
      body.pattern,
      body.field,
      body.action,
      body.verdict_label,
      body.category ?? null,
      body.note ?? null,
      now,
    )
    .run();
  invalidateRuleCache();
  const id = r.meta.last_row_id;
  return c.json({ ok: true, id });
});

app.patch("/v1/admin/keyword-rules/:id", async (c) => {
  if (!(await admin(c))) return c.json({ error: "forbidden" }, 403);
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "bad_id" }, 400);
  let body: z.infer<typeof KeywordRulePatch>;
  try {
    body = KeywordRulePatch.parse(await c.req.json());
  } catch (err) {
    return c.json({ error: "bad_request", detail: (err as Error).message }, 400);
  }
  // Build the SET clause dynamically from provided keys; bind values in order.
  const setParts: string[] = [];
  const binds: unknown[] = [];
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined) continue;
    setParts.push(`${k}=?`);
    binds.push(k === "enabled" ? (v ? 1 : 0) : v);
  }
  if (!setParts.length) return c.json({ error: "empty_patch" }, 400);
  binds.push(id);
  await c.env.DB.prepare(`UPDATE keyword_rules SET ${setParts.join(", ")} WHERE id=?`)
    .bind(...binds)
    .run();
  invalidateRuleCache();
  return c.json({ ok: true });
});

app.delete("/v1/admin/keyword-rules/:id", async (c) => {
  if (!(await admin(c))) return c.json({ error: "forbidden" }, 403);
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "bad_id" }, 400);
  await c.env.DB.prepare("DELETE FROM keyword_rules WHERE id=?").bind(id).run();
  invalidateRuleCache();
  return c.json({ ok: true });
});

// Preview: how many *currently pending* queue rows would this rule catch?
// Doesn't write anything; doesn't bump hit_count. Used by the admin UI's
// "试一下" button before commit. Returns count + up-to-5 sample handles.
app.post("/v1/admin/keyword-rules/preview", async (c) => {
  if (!(await admin(c))) return c.json({ error: "forbidden" }, 403);
  const body = (await c.req.json()) as {
    pattern: string;
    field: "handle" | "display_name" | "bio" | "tweet" | "any";
  };
  const p = String(body.pattern || "").trim();
  if (!p) return c.json({ count: 0, samples: [] });
  // We match against fields stored on accounts: handle, display_name,
  // evidence_text (the closest proxy for "tweet" we persist), and reasons
  // (a JSON blob — not really bio, but useful catch-all). 'bio' isn't
  // stored on accounts directly so we approximate by including reasons.
  const fp = `%${p.toLowerCase()}%`;
  const where =
    body.field === "handle"
      ? "lower(handle) LIKE ?"
      : body.field === "display_name"
        ? "lower(coalesce(display_name,'')) LIKE ?"
        : body.field === "bio" || body.field === "tweet"
          ? "lower(coalesce(evidence_text,'')) LIKE ?"
          : // 'any'
            "(lower(handle) LIKE ?1 OR lower(coalesce(display_name,'')) LIKE ?1 OR lower(coalesce(evidence_text,'')) LIKE ?1 OR lower(coalesce(reasons,'')) LIKE ?1)";
  const sqlCount = `SELECT count(*) AS n FROM accounts WHERE status='auto_pending_review' AND ${where}`;
  const sqlSamples = `SELECT handle, display_name, evidence_text FROM accounts WHERE status='auto_pending_review' AND ${where} ORDER BY last_scored DESC LIMIT 5`;
  const [countRow, samplesRows] = await c.env.DB.batch([
    c.env.DB.prepare(sqlCount).bind(fp),
    c.env.DB.prepare(sqlSamples).bind(fp),
  ]);
  return c.json({
    count: (countRow.results?.[0] as { n: number } | undefined)?.n ?? 0,
    samples: samplesRows.results ?? [],
  });
});

// Apply all enabled rules to existing rows. Default sweeps
// status='auto_pending_review' only; body {scope:'all'} additionally rescans
// auto_legit rows (an account the AI once cleared never re-enters the live
// rule path until its 30d TTL lapses, so a new rule could otherwise never
// catch it). For each row that matches any rule, moves it to that rule's
// destination status, records a review_log audit, and bumps the rule's
// hit_count. Returns a summary so the maintainer can see how much the new
// rule cleaned up.
app.post("/v1/admin/keyword-rules/apply-to-queue", async (c) => {
  if (!(await admin(c))) return c.json({ error: "forbidden" }, 403);
  const body = (await c.req.json().catch(() => ({}))) as { scope?: string } | null;
  const scope = body?.scope === "all" ? "all" : "queue";
  const rules = await getKeywordRules(c.env);
  if (!rules.length) return c.json({ ok: true, matched: 0, perRule: [], scope });

  interface SweepRow {
    rowid: number;
    x_user_id: string | null;
    handle: string;
    display_name: string | null;
    evidence_text: string | null;
    reasons: string | null;
    status: string;
    followers_count: number | null;
  }

  // Candidate rows come from an instr() prefilter (substring, case-insensitive
  // — a strict superset of the word-boundary matcher applied in JS below), for
  // BOTH partitions. Two hard constraints shape this query:
  //
  //   1. D1 caps a statement at 100 bound parameters. The old prefilter bound
  //      each pattern three times (one per field), so at 66 enabled rules it
  //      bound 198 and every scope:'all' sweep died with
  //      "D1_ERROR: too many SQL variables" — the 全量扫描 button 500'd 100%
  //      of the time. Match one concatenated haystack instead: 1 bind/pattern,
  //      and chunk the patterns so any rule count stays under the cap.
  //   2. The queue is no longer the ~600 rows this endpoint was written for
  //      (102K as of 2026-07-28). Pulling it wholesale burned ~14s and tens of
  //      MB of Worker memory per sweep, so the queue gets the same prefilter.
  //
  // Both partitions are capped and report truncation rather than silently
  // covering a prefix.
  const CAND_MAX = 20_000; // per partition; ~10MB of rows at worst
  const PAGE = 500; // rows per statement — D1 caps a response at 10MB
  const DEADLINE = Date.now() + 40_000; // leave room to write before the client gives up
  const PAT_BINDS_PER_CHUNK = 90; // headroom under D1's 100-variable ceiling
  const RAW_HAYSTACK =
    "coalesce(handle,'')||' '||coalesce(display_name,'')||' '||coalesce(evidence_text,'')";
  const HAYSTACK = `lower(${RAW_HAYSTACK})`;

  // One prefilter term per pattern, each costing a single bind. SQLite's
  // lower() folds ASCII only, so a pattern in a cased non-ASCII script
  // (Cyrillic, Greek, full-width Latin) would never match the lowered
  // haystack even though the JS matcher — which lowercases with full Unicode
  // semantics — would hit it: a silent miss, the exact failure class that has
  // burned this sweep before. Those patterns get a second term matching the
  // un-lowered haystack against the pattern as the maintainer typed it.
  // Residual gap: text in such a script cased differently from BOTH the typed
  // form and its lowercase (e.g. rule "привет" vs. profile text "Привет").
  // CJK has no case and ASCII is fully covered by lower(), so today's rule set
  // adds zero extra terms.
  const terms: { sql: string; bind: string }[] = [];
  const seen = new Set<string>();
  for (const r of rules) {
    const raw = r.pattern;
    if (!raw) continue;
    const low = raw.toLowerCase();
    if (!seen.has(low)) {
      seen.add(low);
      terms.push({ sql: `instr(${HAYSTACK},?)>0`, bind: low });
    }
    // eslint-disable-next-line no-control-regex
    if (raw !== low && /[^\x00-\x7f]/.test(raw) && !seen.has(raw)) {
      seen.add(raw);
      terms.push({ sql: `instr(${RAW_HAYSTACK},?)>0`, bind: raw });
    }
  }

  // Walk a partition by rowid cursor. A plain `LIMIT n` would hand back the
  // same leading window on every run, so a sweep could never reach candidates
  // past that window no matter how many times it was clicked — "全量扫描"
  // would only ever cover the front of the table. Paging forward covers the
  // whole partition in one request for roughly the cost of one scan, and stops
  // on an explicit cap/deadline that is reported rather than hidden.
  //
  // `status` is a code-controlled literal (never user input) so it is inlined
  // rather than bound — one more bind slot for patterns, and the status stays
  // visible to the query planner's partial indexes.
  async function prefilter(status: "auto_pending_review" | "auto_legit") {
    const found = new Map<number, SweepRow>();
    let truncated = false;
    if (!terms.length) return { rows: [] as SweepRow[], truncated };
    chunks: for (let i = 0; i < terms.length; i += PAT_BINDS_PER_CHUNK) {
      const group = terms.slice(i, i + PAT_BINDS_PER_CHUNK);
      const cond = group.map((t) => t.sql).join(" OR ");
      let cursor = 0;
      for (;;) {
        const res = await c.env.DB.prepare(
          `SELECT rowid, x_user_id, handle, display_name, evidence_text, reasons, status, followers_count
             FROM accounts WHERE status='${status}' AND rowid>? AND (${cond})
            ORDER BY rowid LIMIT ?`,
        )
          .bind(cursor, ...group.map((t) => t.bind), PAGE)
          .all<SweepRow>();
        const page = res.results ?? [];
        for (const r of page) found.set(r.rowid, r);
        if (page.length < PAGE) break; // partition exhausted for this chunk
        cursor = page[page.length - 1].rowid;
        if (found.size >= CAND_MAX || Date.now() > DEADLINE) {
          truncated = true;
          break chunks;
        }
      }
    }
    return { rows: [...found.values()], truncated };
  }

  const queueScan = await prefilter("auto_pending_review");
  const candidates = queueScan.rows;
  const legitScan =
    scope === "all"
      ? await prefilter("auto_legit")
      : { rows: [] as SweepRow[], truncated: false };
  const legitCandidates = legitScan.rows;
  const legitTruncated = legitScan.truncated;
  const now = Date.now();

  // Per-rule hit count, returned to the UI so the maintainer can see which
  // rule did the heavy lifting.
  const perRule: Record<number, number> = {};
  for (const r of rules) perRule[r.id] = 0;

  // We can't reuse ruleMatchesText here because the row layout differs from
  // the Signals payload. Build a row-shaped matcher:
  function rowMatches(row: (typeof candidates)[number], rule: KeywordRule): boolean {
    if (!rule.pattern) return false;
    const has = (v: string | null) => keywordHit(rule.pattern, v);
    switch (rule.field) {
      case "handle":
        return has(row.handle);
      case "display_name":
        return has(row.display_name);
      case "bio":
      case "tweet":
        return has(row.evidence_text);
      case "any":
        // NB: never match row.reasons — that is the AI's own prose and would
        // fire on negated mentions ("no 约 solicitation found"). Mirror the
        // live ruleMatchesText field set as closely as the row layout allows.
        return has(row.handle) || has(row.display_name) || has(row.evidence_text);
      default:
        // Unknown field — do not silently widen to match everything.
        return false;
    }
  }

  const stmts: D1PreparedStatement[] = [];
  let totalHit = 0;
  let legitHit = 0;
  for (const row of [...candidates, ...legitCandidates]) {
    const hit = rules.find((r) => rowMatches(row, r));
    if (!hit) continue;
    const fromLegit = row.status === "auto_legit";
    // Same auto-publish gate as the live fast-path: a 'blacklist' rule can't
    // publish a non-spam-labeled or known-high-follower row from the sweep —
    // the row is already exactly where it should be (the queue), so skip it.
    if (
      !fromLegit &&
      statusForRuleAction(hit.action) === "human_confirmed" &&
      !autoPublishEligible(hit.verdict_label, row.followers_count)
    ) {
      continue;
    }
    totalHit++;
    if (fromLegit) legitHit++;
    perRule[hit.id] = (perRule[hit.id] ?? 0) + 1;
    // auto_legit + blacklist rule = the AI and the rule disagree, and the
    // sweep matches against a stored evidence snapshot (no translate guard,
    // no live signals) — park it in the queue for a human look instead of
    // publishing straight from a rescan.
    const status =
      fromLegit && statusForRuleAction(hit.action) === "human_confirmed"
        ? "auto_pending_review"
        : statusForRuleAction(hit.action);
    if (hit.action === "whitelist") {
      stmts.push(
        c.env.DB.prepare(
          `UPDATE accounts
              SET status='whitelisted', source='auto_keyword',
                  verdict_label='legit', confidence=1.0,
                  reasons=?, signals_hash=NULL, last_scored=?, published_at=NULL
            WHERE rowid=?`,
        ).bind(
          JSON.stringify([`matched keyword rule "${hit.pattern}" on ${hit.field}`]),
          now,
          row.rowid,
        ),
      );
    } else {
      stmts.push(
        c.env.DB.prepare(
          // category was missing here: the sweep rewrote the verdict but left
          // whatever category the LLM had guessed earlier, so a 色情 rule
          // hitting an account the LLM had filed under 网盘资源 published it as
          // porn_bot/资源 — the client then labelled the spam wrongly. Stamp the
          // rule's category (COALESCE so a rule without one keeps the old value
          // instead of blanking it).
          `UPDATE accounts
              SET status=?, source='auto_keyword',
                  verdict_label=?, confidence=1.0, reasons=?,
                  category=COALESCE(?, category),
                  last_scored=?, published_at=?, published_tier=?
            WHERE rowid=?`,
        ).bind(
          status,
          hit.verdict_label,
          JSON.stringify([`matched keyword rule "${hit.pattern}" on ${hit.field}`]),
          categoryForRule(hit),
          now,
          status === "human_confirmed" ? now : null,
          status === "human_confirmed" ? "rule" : null,
          row.rowid,
        ),
      );
    }
    stmts.push(
      c.env.DB.prepare(
        "INSERT INTO review_log (x_user_id, handle, action, actor, note, at) VALUES (?,?,?,?,?,?)",
      ).bind(
        row.x_user_id,
        row.handle,
        `keyword_${hit.action}`,
        `rule:${hit.id}`,
        `apply-to-queue matched "${hit.pattern}" on ${hit.field}${
          fromLegit ? " · rescanned auto_legit → queued for review" : ""
        }`,
        now,
      ),
    );
  }
  // Per-rule hit_count bump (batched alongside the row updates).
  for (const [ridStr, n] of Object.entries(perRule)) {
    if (!n) continue;
    stmts.push(
      c.env.DB.prepare(
        "UPDATE keyword_rules SET hit_count=hit_count+?, last_hit_at=? WHERE id=?",
      ).bind(n, now, Number(ridStr)),
    );
  }

  // D1 batch size cap — chunk if we collected a lot of statements. Each row
  // contributes 2 statements; cap each batch at ~100 statements to stay
  // comfortably within D1 limits.
  if (stmts.length) {
    const CHUNK = 100;
    for (let i = 0; i < stmts.length; i += CHUNK) {
      await c.env.DB.batch(stmts.slice(i, i + CHUNK));
    }
  }
  invalidateRuleCache();
  return c.json({
    ok: true,
    matched: totalHit,
    scope,
    // Candidate counts (rows the SQL prefilter surfaced), not partition sizes.
    scanned: { queue: candidates.length, legit: legitCandidates.length },
    legitMatched: legitHit,
    legitTruncated,
    queueTruncated: queueScan.truncated,
    perRule: Object.entries(perRule)
      .map(([id, n]) => ({ id: Number(id), hits: n }))
      .filter((x) => x.hits > 0),
  });
});

// ---- Whitelist ----
// status='whitelisted' acts as a permanent override:
//   - /v1/classify short-circuits without calling the LLM
//   - /v1/confirm and /v1/report no-op (whitelisted target absorbs noise)
//   - removable via DELETE /v1/admin/whitelist (drops back to 'rejected'
//     so it stays out of the published list but the audit is preserved)
const WhitelistAdd = z.object({
  handle: z.string().min(1).max(64),
  xUserId: optionalNumericId,
  displayName: z.string().max(120).default(""),
  avatarUrl: z.string().url().optional(),
  note: z.string().max(200).default(""),
});

// Upsert an account as whitelisted. If a row already exists
// (auto_pending_review, auto_legit, rejected, removed, even human_confirmed)
// the admin's explicit action wins. Shared by POST /v1/admin/whitelist and
// the whitelist-request approve endpoint so the SQL can't drift.
async function whitelistUpsert(
  env: Bindings,
  uid: string | null,
  handle: string,
  displayName: string,
  avatarUrl: string | null,
  reasons: string,
  now: number,
): Promise<void> {
  // D1 compares lower(handle) with the bound value verbatim, so every
  // identity lookup and write in this flow must share the same normalized key.
  handle = normalizeHandle(handle);
  // Resolve one canonical identity row before writing. With a uid, findAccount
  // prefers that immutable identity and falls back only to a handle-only row
  // that can safely absorb the uid. Without a uid it reuses the freshest
  // existing handle row instead of inserting another SQLite NULL-key sibling.
  let canonical = await findAccount(env, handle, uid);
  const updateCanonical = (rowid: number) =>
    env.DB.prepare(
      `UPDATE accounts SET
         x_user_id=COALESCE(x_user_id, ?),
         handle=?,
         status='whitelisted',
         source='admin_whitelist',
         verdict_label='legit',
         confidence=1.0,
         reasons=?,
         signals_hash=NULL,
         category=NULL,
         published_at=NULL,
         published_tier=NULL,
         last_scored=?,
         display_name=COALESCE(?, display_name),
         avatar_url=COALESCE(?, avatar_url)
       WHERE rowid=?`,
    )
      .bind(uid, handle, reasons, now, displayName || null, avatarUrl, rowid)
      .run();

  if (canonical) {
    try {
      await updateCanonical(canonical.rowid);
    } catch (err) {
      // A concurrent request may have inserted the uid row after findAccount
      // selected a handle-only row. Re-resolve once and update the winner.
      if (!uid) throw err;
      const raced = await findAccount(env, handle, uid);
      if (!raced || raced.rowid === canonical.rowid) throw err;
      canonical = raced;
      await updateCanonical(canonical.rowid);
    }
  } else {
    await env.DB.prepare(
      `INSERT INTO accounts
         (x_user_id,handle,display_name,avatar_url,verdict_label,confidence,reasons,
          status,source,signals_hash,first_seen,last_scored,published_at)
       VALUES (?,?,?,?,'legit',1.0,?, 'whitelisted','admin_whitelist', NULL, ?, ?, NULL)
       ON CONFLICT DO UPDATE SET
         handle=excluded.handle,
         status='whitelisted',
         source='admin_whitelist',
         verdict_label='legit',
         confidence=1.0,
         reasons=excluded.reasons,
         signals_hash=NULL,
         category=NULL,
         published_at=NULL,
         published_tier=NULL,
         last_scored=excluded.last_scored,
         display_name=COALESCE(excluded.display_name, accounts.display_name),
         avatar_url=COALESCE(excluded.avatar_url, accounts.avatar_url)`,
    )
      .bind(uid, handle, displayName, avatarUrl, reasons, now, now)
      .run();
  }

  canonical = await findAccount(env, handle, uid);
  if (!canonical) throw new Error("whitelist upsert did not produce a canonical account row");
  // Collapse only handle-only siblings. A different non-null uid sharing a
  // recycled handle is a different X account and must keep its own decision.
  await cleanupHandleOnlyAccountDuplicates(env, handle, canonical.rowid);
}

app.post("/v1/admin/whitelist", async (c) => {
  if (!(await admin(c))) return c.json({ error: "forbidden" }, 403);
  let body: z.infer<typeof WhitelistAdd>;
  try {
    body = WhitelistAdd.parse(await c.req.json());
  } catch (err) {
    return c.json({ error: "bad_request", detail: (err as Error).message }, 400);
  }
  const uid = body.xUserId ?? null;
  const now = Date.now();
  const reasons = JSON.stringify(["whitelisted by admin", body.note].filter(Boolean));
  await whitelistUpsert(c.env, uid, body.handle, body.displayName, body.avatarUrl ?? null, reasons, now);
  await c.env.DB.prepare(
    "INSERT INTO review_log (x_user_id,handle,action,actor,note,at) VALUES (?,?,?,?,?,?)",
  )
    .bind(uid, body.handle, "whitelist_add", "admin", body.note || "panel", now)
    .run();
  return c.json({ ok: true, handle: body.handle, status: "whitelisted" });
});

app.delete("/v1/admin/whitelist", async (c) => {
  if (!(await admin(c))) return c.json({ error: "forbidden" }, 403);
  const handle = c.req.query("handle") ?? "";
  const xUserId = c.req.query("xUserId") || null;
  if (!handle) return c.json({ error: "handle_required" }, 400);
  const now = Date.now();
  // Drop back to 'rejected' rather than deleting the row — keeps the audit
  // trail intact and prevents the account from immediately re-entering the
  // public list if it gets re-reported.
  const r = await c.env.DB.prepare(
    `UPDATE accounts SET status='rejected', source='admin_whitelist', last_scored=?
      WHERE lower(handle)=lower(?) AND status='whitelisted'`,
  )
    .bind(now, handle)
    .run();
  await c.env.DB.prepare(
    "INSERT INTO review_log (x_user_id,handle,action,actor,note,at) VALUES (?,?,?,?,?,?)",
  )
    .bind(xUserId, handle, "whitelist_remove", "admin", "panel", now)
    .run();
  return c.json({ ok: true, changed: r.meta.changes ?? 0 });
});

app.get("/v1/admin/whitelist", async (c) => {
  if (!(await admin(c))) return c.json({ error: "forbidden" }, 403);
  const sort = adminSort(c.req.query("sort"));
  const cursor = decodeSortCursor(c.req.query("before") || null);
  const cursorWhere = sortCursorWhere(sort, "last_scored", cursor);
  const limit = Math.min(200, Math.max(1, Number(c.req.query("limit")) || 100));
  const q = (c.req.query("q") || "").trim().replace(/^@+/, "") || null;
  const sortExpr = sortValueExpr("a", sort, "last_scored");
  const rows = await c.env.DB.prepare(
    `WITH base AS (
       SELECT a.rowid AS rid,
              a.*,
              ${sortExpr} AS sort_value
         FROM accounts a
        WHERE a.status='whitelisted'
          AND (? IS NULL OR (
               lower(a.handle) LIKE '%' || lower(?) || '%'
            OR a.x_user_id LIKE ? || '%'
            OR lower(coalesce(a.display_name,'')) LIKE '%' || lower(?) || '%'
            OR lower(coalesce(a.reasons,'')) LIKE '%' || lower(?) || '%'
          ))
     )
     SELECT a.rid, a.sort_value,
            a.x_user_id, a.handle, a.display_name, a.avatar_url,
            account_created_at, account_age_days, followers_count, following_count,
            reasons, last_scored,
            last_decided_by, last_decided_at
       FROM base a
      WHERE ${cursorWhere.sql}
      ORDER BY ${sortOrderSql(sort, "last_scored")} LIMIT ?`,
  )
    .bind(q, q, q, q, q, ...cursorWhere.binds, limit)
    .all<{
      rid: number;
      sort_value: string | number | null;
      x_user_id: string | null;
      handle: string;
      display_name: string | null;
      avatar_url: string | null;
      account_created_at: string | null;
      account_age_days: number | null;
      followers_count: number | null;
      following_count: number | null;
      reasons: string;
      last_scored: number;
      last_decided_by: string | null;
      last_decided_at: number | null;
    }>();
  const rawList = rows.results ?? [];
  const list = rawList.map(({ rid: _rid, sort_value: _sortValue, ...row }) => row);
  const last = rawList[rawList.length - 1];
  return c.json({
    list,
    nextBefore: rawList.length === limit && last ? encodeSortCursor(last, last.last_scored) : null,
    appliedFilters: { q, sort },
  });
});

// ---- Whitelist request moderation ----
// List self-service applications. Each row is JOINed with the applicant
// handle/uid's CURRENT accounts row so the panel can flag "this account is
// already on the public blacklist" before the maintainer approves.
app.get("/v1/admin/whitelist-requests", async (c) => {
  if (!(await admin(c))) return c.json({ error: "forbidden" }, 403);
  const status = (c.req.query("status") || "pending").trim();
  const limit = Math.min(500, Math.max(1, Number(c.req.query("limit")) || 200));
  // Plain fetch first, enrich second. The original single query correlated
  // the outer `wr` alias inside a subquery ORDER BY — D1's SQLite rejects
  // that ("no such column: wr.x_user_id"), which 500'd this endpoint on
  // every load (the admin page's 加载失败). MockDB tests never caught it.
  const rows = await c.env.DB.prepare(
    `SELECT id, x_user_id, handle, gh_age_days, note, status, created_at, decided_at
       FROM whitelist_requests
      WHERE (? = 'all' OR status = ?)
      ORDER BY id DESC
      LIMIT ?`,
  )
    .bind(status, status, limit)
    .all<{
      id: number;
      x_user_id: string | null;
      handle: string;
      gh_age_days: number | null;
      note: string | null;
      status: string;
      created_at: number;
      decided_at: number | null;
    }>();
  const reqs = rows.results ?? [];
  // One bounded lookup over the requested handles (idx_accounts_handle_norm);
  // prefer the uid-matching account row, else the freshest same-handle row.
  // Chunked at 90 handles per statement — D1 rejects a statement with >100
  // bound parameters, and `limit` here goes up to 500.
  interface AccRow {
    x_user_id: string | null;
    h: string;
    status: string;
    verdict_label: string;
    category: string | null;
    avatar_url: string | null;
    last_scored: number;
  }
  const accountByReq = new Map<number, AccRow>();
  if (reqs.length) {
    const handles = [...new Set(reqs.map((r) => r.handle.toLowerCase()))];
    const byHandle = new Map<string, AccRow[]>();
    for (let i = 0; i < handles.length; i += 90) {
      const group = handles.slice(i, i + 90);
      const accs = await c.env.DB.prepare(
        `SELECT x_user_id, lower(handle) AS h, status, verdict_label, category, avatar_url, last_scored
           FROM accounts WHERE lower(handle) IN (${group.map(() => "?").join(",")})`,
      )
        .bind(...group)
        .all<AccRow>();
      for (const a of accs.results ?? []) {
        const arr = byHandle.get(a.h) ?? [];
        arr.push(a);
        byHandle.set(a.h, arr);
      }
    }
    for (const r of reqs) {
      const cands = byHandle.get(r.handle.toLowerCase()) ?? [];
      const best =
        (r.x_user_id && cands.find((a) => a.x_user_id === r.x_user_id)) ||
        [...cands].sort((x, y) => y.last_scored - x.last_scored)[0];
      if (best) accountByReq.set(r.id, best);
    }
  }
  return c.json({
    list: reqs.map((r) => ({
      ...r,
      account_status: accountByReq.get(r.id)?.status ?? null,
      account_verdict_label: accountByReq.get(r.id)?.verdict_label ?? null,
      account_category: accountByReq.get(r.id)?.category ?? null,
      // Avatar for the review row. Null when the applicant has no accounts row
      // at all (never scanned) — the panel falls back to unavatar by handle.
      avatar_url: accountByReq.get(r.id)?.avatar_url ?? null,
    })),
  });
});

async function pendingWhitelistRequest(
  env: Bindings,
  id: number,
): Promise<
  | { row: { id: number; x_user_id: string | null; handle: string; note: string | null; status: string } }
  | { error: Response }
> {
  const row = await env.DB.prepare(
    "SELECT id, x_user_id, handle, note, status FROM whitelist_requests WHERE id=?",
  )
    .bind(id)
    .first<{ id: number; x_user_id: string | null; handle: string; note: string | null; status: string }>();
  if (!row) return { error: Response.json({ error: "not_found" }, { status: 404 }) };
  if (row.status !== "pending") {
    return { error: Response.json({ error: "not_pending", status: row.status }, { status: 409 }) };
  }
  return { row };
}

app.post("/v1/admin/whitelist-requests/:id/approve", async (c) => {
  if (!(await admin(c))) return c.json({ error: "forbidden" }, 403);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "bad_request" }, 400);
  const got = await pendingWhitelistRequest(c.env, id);
  if ("error" in got) return got.error;
  const { row } = got;
  const now = Date.now();
  const handle = normalizeHandle(row.handle);
  const reasons = JSON.stringify(
    ["whitelisted by admin", `self-service request #${row.id}`, row.note ?? ""].filter(Boolean),
  );
  await whitelistUpsert(c.env, row.x_user_id, handle, "", null, reasons, now);
  await c.env.DB.prepare(
    "UPDATE whitelist_requests SET status='approved', decided_at=? WHERE id=?",
  )
    .bind(now, id)
    .run();
  await c.env.DB.prepare(
    "INSERT INTO review_log (x_user_id,handle,action,actor,note,at) VALUES (?,?,?,?,?,?)",
  )
    .bind(row.x_user_id, handle, "whitelist_request_approve", "admin", `request #${id}`, now)
    .run();
  return c.json({ ok: true, status: "approved" });
});

app.post("/v1/admin/whitelist-requests/:id/reject", async (c) => {
  if (!(await admin(c))) return c.json({ error: "forbidden" }, 403);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "bad_request" }, 400);
  const got = await pendingWhitelistRequest(c.env, id);
  if ("error" in got) return got.error;
  const { row } = got;
  const now = Date.now();
  await c.env.DB.prepare(
    "UPDATE whitelist_requests SET status='rejected', decided_at=? WHERE id=?",
  )
    .bind(now, id)
    .run();
  await c.env.DB.prepare(
    "INSERT INTO review_log (x_user_id,handle,action,actor,note,at) VALUES (?,?,?,?,?,?)",
  )
    .bind(row.x_user_id, normalizeHandle(row.handle), "whitelist_request_reject", "admin", `request #${id}`, now)
    .run();
  return c.json({ ok: true, status: "rejected" });
});

// Maintainer view of the public blacklist (status='human_confirmed'). Like
// /v1/list but admin-scoped (returns more columns + uncacheable) so the
// /admin panel can iterate it for "moved here by mistake" cleanup.
app.get("/v1/admin/blacklist", async (c) => {
  if (!(await admin(c))) return c.json({ error: "forbidden" }, 403);
  const sort = adminSort(c.req.query("sort"));
  const cursor = decodeSortCursor(c.req.query("before") || null);
  const limit = Math.min(200, Math.max(1, Number(c.req.query("limit")) || 100));
  const offset = Math.max(0, Math.floor(Number(c.req.query("offset")) || 0));
  const cursorWhere =
    offset > 0
      ? { sql: "1=1", binds: [] as unknown[] }
      : sortCursorWhere(sort, "published_at", cursor);
  const text = parseTextFilters((k) => c.req.query(k));
  const textWhere = textFilterWhere("a", text);
  const dims = parseDimFilters((k) => c.req.query(k));
  const dimWhere = dimFilterWhere("a", dims, "published_at");
  const sortExpr = sortValueExpr("a", sort, "published_at");
  const cte = `WITH base AS (
       SELECT a.rowid AS rid,
              a.*,
              ${sortExpr} AS sort_value
         FROM accounts a
        WHERE a.status='human_confirmed'
          ${textWhere.sql}
          ${dimWhere.sql}
     )`;
  const total =
    c.req.query("total") === "1"
      ? await countMatches(c.env, cte, [...textWhere.binds, ...dimWhere.binds], "FROM base")
      : null;
  const rows = await c.env.DB.prepare(
    `${cte}
     SELECT a.rid, a.sort_value,
            a.x_user_id, a.handle, a.display_name, a.avatar_url,
            a.account_created_at, a.account_age_days, a.followers_count, a.following_count,
            a.verdict_label, a.confidence, a.category, a.reasons, a.evidence_text, a.last_scored,
            a.source, a.agent_id, a.agent_label,
            a.published_at, a.published_tier,
            a.last_decided_by, a.last_decided_at,
            (SELECT count(DISTINCT r.reporter_fp) FROM reports r
              WHERE r.handle=a.handle
                AND ifnull(r.x_user_id,'')=ifnull(a.x_user_id,'')) reporters
       FROM base a
      WHERE ${cursorWhere.sql}
      ORDER BY ${sortOrderSql(sort, "published_at")} LIMIT ? OFFSET ?`,
  )
    .bind(...textWhere.binds, ...dimWhere.binds, ...cursorWhere.binds, limit, offset)
    .all<{
      rid: number;
      sort_value: string | number | null;
      x_user_id: string | null;
      handle: string;
      display_name: string | null;
      avatar_url: string | null;
      account_created_at: string | null;
      account_age_days: number | null;
      followers_count: number | null;
      following_count: number | null;
      verdict_label: string;
      confidence: number;
      category: string | null;
      reasons: string;
      last_scored: number;
      source: string;
      agent_id: string | null;
      agent_label: string | null;
      published_at: number;
      published_tier: string | null;
      last_decided_by: string | null;
      last_decided_at: number | null;
      reporters: number;
    }>();
  const rawList = rows.results ?? [];
  const list = rawList.map(({ rid: _rid, sort_value: _sortValue, ...row }) => row);
  const last = rawList[rawList.length - 1];
  return c.json({
    list,
    nextBefore: rawList.length === limit && last ? encodeSortCursor(last, last.published_at) : null,
    total,
    offset,
    appliedFilters: { ...textFiltersEcho(text), sort, ...dimFiltersEcho(dims) },
  });
});

// Public read-only mirror for the (future) extension L0a cache. No PII,
// no avatars — just (handle, xUserId, sinceMs). Cached at the edge.
app.get("/v1/whitelist", async (c) => {
  const since = Number(c.req.query("since")) || 0;
  const limit = Math.min(2000, Math.max(1, Number(c.req.query("limit")) || 500));
  const rows = await c.env.DB.prepare(
    `SELECT x_user_id, handle, last_scored
       FROM accounts WHERE status='whitelisted' AND last_scored > ?
       ORDER BY last_scored ASC LIMIT ?`,
  )
    .bind(since, limit)
    .all<{ x_user_id: string | null; handle: string; last_scored: number }>();
  const list = rows.results ?? [];
  const latestAt = list.length ? list[list.length - 1].last_scored : since;
  c.header("Cache-Control", "public, max-age=300, s-maxage=600");
  return c.json({ list, latestAt, count: list.length });
});

app.get("/v1/artifacts/:key", async (c) => {
  const key = c.req.param("key");
  if (!key || key.includes("..") || key.includes("/")) return c.json({ error: "invalid_key" }, 400);

  // Artifacts are immutable per version key — Workers on custom domains don't
  // auto-cache, so use the Cache API explicitly (same pattern as /v1/check).
  const cacheKey = new URL(c.req.url);
  cacheKey.search = "";
  const cached = await caches.default.match(cacheKey.toString());
  if (cached) return cached;

  const obj = await c.env.ARTIFACTS.get(key);
  if (!obj) return c.json({ error: "not_found" }, 404);

  const resp = new Response(obj.body, {
    headers: {
      "Content-Type": key.endsWith(".json") ? "application/json" : "application/octet-stream",
      "Cache-Control": "public, max-age=300, s-maxage=600",
    },
  });
  c.executionCtx.waitUntil(caches.default.put(cacheKey.toString(), resp.clone()));
  return resp;
});

app.get("/v1/list/meta", async (c) => {
  const cacheKey = "https://x.zuoluo.tv/v1/list/meta";
  const cached = await caches.default.match(cacheKey);
  if (cached) return cached;

  const now = Date.now();
  // `count` and `pending` come from the 24-row publications ledger (snapshotted
  // by the 10-min publish cron) instead of full-partition COUNTs — this endpoint
  // used to scan ~185K rows per cache miss, the same failure class as the D1
  // rows-read incident. `day`/`week`/`latest` still need live values but ride
  // idx_accounts_status_published_at: the range is bounded to the last 7 days
  // (a few thousand rows) and `latest` is a single-row index seek.
  const r = await c.env.DB.prepare(
    `SELECT
       (SELECT published_at FROM accounts
          WHERE status='human_confirmed' AND published_at IS NOT NULL
          ORDER BY published_at DESC LIMIT 1) AS latest,
       count(*) AS week,
       sum(CASE WHEN published_at >= ? THEN 1 ELSE 0 END) AS day
     FROM accounts
    WHERE status='human_confirmed' AND published_at >= ?`,
  )
    .bind(now - DAY_MS, now - 7 * DAY_MS)
    .first<{ latest: number | null; week: number; day: number }>();

  // The publication row is OPTIONAL — the payload already degrades to
  // `artifacts: null` when there isn't one. Treat any failure here (e.g. a
  // freshly-migrated DB that is missing the table) as "no publication yet"
  // rather than letting it 500 the whole public endpoint.
  const pub = await c.env.DB.prepare(
    "SELECT version, bloom_key, json_key, meta_key, lite_key, count, pending_count, published_at FROM publications ORDER BY published_at DESC LIMIT 1",
  )
    .first<{
      version: string;
      bloom_key: string;
      json_key: string;
      meta_key: string;
      lite_key: string | null;
      count: number;
      pending_count: number | null;
      published_at: number;
    }>()
    .catch((err) => {
      logError("list_meta.publications_lookup_failed", err);
      return null;
    });

  const payload = {
    count: pub?.count ?? 0,
    day: r?.day ?? 0,
    week: r?.week ?? 0,
    pending: pub?.pending_count ?? 0,
    // `generatedAt` is the artifact sync time (landing's "刚刚同步"); `latestAt`
    // is the newest confirmed entry, which is what the list's "最近一条" reflects
    // and what `/v1/list` sorts by. They diverge when accounts are confirmed
    // after the last publication artifact was regenerated.
    generatedAt: pub?.published_at ?? r?.latest ?? null,
    latestAt: r?.latest ?? null,
    version: pub?.version ?? `d1-${pub?.count ?? 0}`,
    artifacts: pub
      ? {
          bloom: `/v1/artifacts/${pub.bloom_key}`,
          shards: `/v1/artifacts/${pub.json_key}`,
          meta: `/v1/artifacts/${pub.meta_key}`,
          ...(pub.lite_key ? { lite: `/v1/artifacts/${pub.lite_key}` } : {}),
        }
      : null,
  };
  const resp = Response.json(payload, {
    headers: {
      "Cache-Control": "public, max-age=30, s-maxage=60",
    },
  });
  c.executionCtx.waitUntil(caches.default.put(cacheKey, resp.clone()));
  return resp;
});

// Public trend data for the landing page. The server returns 48 hourly buckets
// so the UI can show the latest 24h while still having enough data for future
// "past 48h" charts without changing the API.
app.get("/v1/list/trends", async (c) => {
  const now = Date.now();
  const hourStart = Math.floor(now / HOUR_MS) * HOUR_MS;
  const hourlyStart = hourStart - 47 * HOUR_MS;
  const hourlyEnd = hourStart + HOUR_MS;
  const hourly = Array.from({ length: 48 }, (_, i) => ({
    at: hourlyStart + i * HOUR_MS,
    count: 0,
  }));

  const hourlyRows = await c.env.DB.prepare(
    `SELECT CAST(published_at / ? AS INTEGER) * ? AS bucket,
            count(*) AS n
       FROM accounts
      WHERE status='human_confirmed'
        AND published_at IS NOT NULL
        AND published_at >= ?
        AND published_at < ?
      GROUP BY bucket
      ORDER BY bucket ASC`,
  )
    .bind(HOUR_MS, HOUR_MS, hourlyStart, hourlyEnd)
    .all<{ bucket: number; n: number }>();
  const hourlyIndex = new Map(hourly.map((point, index) => [point.at, index]));
  for (const row of hourlyRows.results ?? []) {
    const index = hourlyIndex.get(row.bucket);
    if (index !== undefined) hourly[index].count = row.n;
  }

  const rawTz = Number(c.req.query("tz"));
  const timezoneOffsetMinutes =
    Number.isFinite(rawTz) && Math.abs(rawTz) <= 14 * 60 ? Math.trunc(rawTz) : 0;
  const offsetMs = timezoneOffsetMinutes * 60_000;
  const currentLocalDay = Math.floor((now - offsetMs) / DAY_MS);
  const dailyStart = (currentLocalDay - 6) * DAY_MS + offsetMs;
  const dailyEnd = (currentLocalDay + 1) * DAY_MS + offsetMs;
  const daily = Array.from({ length: 7 }, (_, i) => ({
    at: dailyStart + i * DAY_MS,
    count: 0,
  }));

  const dailyRows = await c.env.DB.prepare(
    `SELECT CAST((published_at - ?) / ? AS INTEGER) * ? + ? AS bucket,
            count(*) AS n
       FROM accounts
      WHERE status='human_confirmed'
        AND published_at IS NOT NULL
        AND published_at >= ?
        AND published_at < ?
      GROUP BY bucket
      ORDER BY bucket ASC`,
  )
    .bind(offsetMs, DAY_MS, DAY_MS, offsetMs, dailyStart, dailyEnd)
    .all<{ bucket: number; n: number }>();
  const dailyIndex = new Map(daily.map((point, index) => [point.at, index]));
  for (const row of dailyRows.results ?? []) {
    const index = dailyIndex.get(row.bucket);
    if (index !== undefined) daily[index].count = row.n;
  }

  c.header("Cache-Control", "public, max-age=30, s-maxage=60");
  return c.json({ now, timezoneOffsetMinutes, hourly, daily });
});

// Public paginated spam list — backs the /list page and any external mirror.
// Returns only human_confirmed (the published set). Keyset-paginates on
// published_at (DESC) — O(limit), no OFFSET. Edge-cached so polling clients
// don't hammer D1; weak ETag lets the page short-circuit when nothing changed.
//
//   GET /v1/list?limit=100               → latest 100
//   GET /v1/list?limit=100&before=<ms>   → 100 strictly older than <ms>
//   GET /v1/list?limit=100&since=<ms>    → up to 100 strictly newer than <ms> (poll)
//
// reporters = count of distinct GitHub reporters per target, joined from
// `reports`. At the data sizes we expect this WITH ... LEFT JOIN is fine;
// if it ever gets hot, denormalize a column.
app.get("/v1/list", async (c) => {
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit")) || 100));
  const before = Number(c.req.query("before")) || null;
  const since = Number(c.req.query("since")) || null;

  // Workers on custom domains don't auto-cache despite s-maxage — wrap with
  // the Cache API like /v1/check, keyed on the canonicalized query so
  // equivalent URLs share a slot. Short TTL (30s) keeps the board fresh.
  const cacheUrl = new URL(c.req.url);
  cacheUrl.search = new URLSearchParams({
    limit: String(limit),
    before: String(before ?? ""),
    since: String(since ?? ""),
  }).toString();
  const cacheKey = cacheUrl.toString();
  const cached = await caches.default.match(cacheKey);
  if (cached) {
    const cachedEtag = cached.headers.get("etag");
    if (cachedEtag && c.req.header("if-none-match") === cachedEtag) {
      return new Response(null, { status: 304, headers: { ETag: cachedEtag } });
    }
    return cached;
  }

  // reporters via a correlated subquery (NOT a CTE + LEFT JOIN). The old
  // `WITH rep AS (... GROUP BY ...)` materialized the full reports table and
  // nested-loop-joined it against the page, reading ~200K rows to return 100
  // — at the live data sizes that single query was responsible for billions
  // of D1 rows-read/week. The correlated form rides idx_reports_unique's
  // leading `handle` column and reads ~the page size (matches the indexed
  // pattern already used by /v1/admin/blacklist and /v1/admin/queue).
  const rows = await c.env.DB.prepare(
    `SELECT a.x_user_id, a.handle, a.display_name, a.avatar_url,
            a.verdict_label, a.confidence, a.category, a.reasons, a.evidence_text, a.published_at,
            (SELECT count(DISTINCT r.reporter_fp)
               FROM reports r
              WHERE r.handle = a.handle
                AND ifnull(r.x_user_id,'') = ifnull(a.x_user_id,'')
                AND r.reporter_fp IS NOT NULL) AS reporters
       FROM accounts a
      WHERE a.status='human_confirmed'
        AND a.published_at IS NOT NULL
        AND (?1 IS NULL OR a.published_at < ?1)
        AND (?2 IS NULL OR a.published_at > ?2)
      ORDER BY a.published_at DESC
      LIMIT ?3`,
  )
    .bind(before, since, limit)
    .all<{
      x_user_id: string | null;
      handle: string;
      display_name: string | null;
      avatar_url: string | null;
      verdict_label: string;
      confidence: number;
      category: string | null;
      reasons: string | null;
      evidence_text: string | null;
      published_at: number;
      reporters: number;
    }>();
  const list = rows.results ?? [];
  const nextBefore = list.length === limit ? list[list.length - 1].published_at : null;
  const latestAt = list[0]?.published_at ?? null;
  const etag = `W/"l${latestAt ?? 0}-n${list.length}-b${before ?? 0}-s${since ?? 0}"`;
  const resp = Response.json(
    { list, nextBefore, latestAt },
    { headers: { "Cache-Control": "public, max-age=10, s-maxage=30", ETag: etag } },
  );
  c.executionCtx.waitUntil(caches.default.put(cacheKey, resp.clone()));
  if (c.req.header("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }
  return resp;
});

// CSP for the SSR HTML pages — strict by default, with X's avatar CDN +
// unavatar.io allow-listed for the public board. Inline style/script are
// Public pages are still single-document HTML. GA4 is the only third-party
// script and its domains are centralized in analytics.ts.
const PAGE_CSP = `default-src 'self'; img-src 'self' data: https://pbs.twimg.com https://*.twimg.com https://unavatar.io ${ANALYTICS_CSP.imgSrc}; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' ${ANALYTICS_CSP.scriptSrc}; connect-src 'self' ${ANALYTICS_CSP.connectSrc}; frame-ancestors 'none'; base-uri 'none'`;

function pageHeaders(c: Ctx, cacheSeconds: number): void {
  c.header("Content-Security-Policy", PAGE_CSP);
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Cache-Control", `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds * 2}`);
}

// All three pages are now the React/shadcn SPA (services/edge/app, built to
// static/app/*). The Worker fetches the shell from the ASSETS binding and
// injects a per-route <head> (title + crawler meta + analytics) before
// returning it — crawlers see real OG tags even though the body is client
// rendered. The legacy string renderers stay at *.legacy as a rollback.
const OG_BASE = BRAND.edgeBase;
function landingHead(): string {
  return (
    `<title>${BRAND.name} · ${BRAND.tagline}</title><meta name="description" content="MXGA 是开源 X 扩展：标出广告号和色情引流号，拉黑由你确认。Chrome / Firefox 已上架，TestFlight 开放测试。"><meta property="og:title" content="${BRAND.name} · ${BRAND.tagline}"><meta property="og:description" content="社区共建的公开黑名单，帮你把 X 上的广告号和色情 bot 标出来。"><meta property="og:type" content="website"><meta property="og:url" content="${OG_BASE}/"><meta property="og:image" content="${OG_BASE}/og.png"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${OG_BASE}/og.png">${googleAnalyticsHead()}`
  );
}
function listHead(): string {
  return (
    `<title>公开名单 · ${BRAND.acronym}</title><meta name="robots" content="noindex,follow"><meta name="description" content="MXGA 已确认的垃圾号公开名单 · AI 初筛，维护者复核。">${googleAnalyticsHead()}`
  );
}

/** Fetch the built SPA shell and splice a per-route <head> into it. */
async function serveAppShell(
  c: Context,
  opts: { head?: string; robots?: string; cache: string },
): Promise<Response> {
  const res = await c.env.ASSETS.fetch(new URL("/app/index.html", c.req.url));
  let html = await res.text();
  if (opts.head) html = html.replace("<title>MXGA</title>", opts.head);
  c.header("Content-Type", "text/html; charset=utf-8");
  c.header("Cache-Control", opts.cache);
  if (opts.robots) c.header("X-Robots-Tag", opts.robots);
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Content-Type-Options", "nosniff");
  return c.body(html);
}

app.get("/", (c) => serveAppShell(c, { head: landingHead(), cache: "public, max-age=60, s-maxage=120" }));
app.get("/list", (c) =>
  serveAppShell(c, { head: listHead(), robots: "noindex, follow", cache: "public, max-age=30, s-maxage=60" }),
);
app.get("/admin", (c) => serveAppShell(c, { robots: "noindex, nofollow", cache: "no-store" }));

// Legacy string-rendered pages, kept as a rollback during the React rollout.
// Remove (along with src/pages/*.ts + styles.css) once the SPA is proven.
app.get("/index.legacy", (c) => {
  pageHeaders(c, 60);
  return c.html(landingHtml());
});
app.get("/list.legacy", (c) => {
  pageHeaders(c, 30);
  return c.html(listHtml());
});
app.get("/admin.legacy", (c) => {
  pageHeaders(c, 0);
  c.header("Cache-Control", "no-store");
  c.header("X-Robots-Tag", "noindex, nofollow");
  return c.html(adminHtml());
});

// Scheduled mirror of the curated whitelist/blacklist into the upstream
// GitHub repo as data/whitelist/v1.json and data/blacklist/v1.json.
// The repo itself becomes the audit log: anyone can clone and verify
// "which accounts were on the list at any past timestamp" via git history.
//
// Disabled (no-op) when WHITELIST_SYNC_TOKEN is unset — the rest of the
// system works fine without it; this is purely a transparency + audit
// enhancement. Cron trigger in wrangler.toml.
type MirrorPublishResult = "skipped" | "committed" | "failed" | "disabled";

function mirrorBranch(env: Bindings): string | null {
  const branch = env.WHITELIST_SYNC_BRANCH?.trim() ?? "";
  // A conservative subset of git-check-ref-format. In particular, disallow
  // traversal-like and ambiguous forms before interpolating a ref into a URL.
  if (
    !branch ||
    branch.length > 255 ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) ||
    branch.includes("..") ||
    branch.includes("//") ||
    branch.endsWith("/") ||
    branch.endsWith(".")
  ) {
    return null;
  }
  return branch;
}

async function mirrorToGitHub(
  env: Bindings,
): Promise<{
  whitelist: MirrorPublishResult;
  blacklist: MirrorPublishResult;
  lite: MirrorPublishResult;
}> {
  const token = env.WHITELIST_SYNC_TOKEN;
  // PAT not provided yet — mirror disabled.
  if (!token) return { whitelist: "disabled", blacklist: "disabled", lite: "disabled" };
  const repo = env.WHITELIST_SYNC_REPO ?? "foru17/make-x-great-again";
  const branch = mirrorBranch(env);
  const failed = { whitelist: "failed", blacklist: "failed", lite: "failed" } as const;
  if (!branch) {
    logWarn("mirror.branch_not_configured", { repo });
    return failed;
  }
  const dataBranch = branch;
  const githubHeaders = {
    authorization: `Bearer ${token}`,
    "user-agent": "mxga-worker",
    accept: "application/vnd.github+json",
  };

  // Fail closed before reading D1 or producing payloads. GitHub's Contents API
  // defaults to the repository's default branch when `branch` is omitted, so
  // verify both that our explicit data branch exists and that it is not the
  // default branch. A deleted/misnamed data branch becomes an observable sync
  // failure instead of silently falling back to main.
  const repoMeta = await fetch(`https://api.github.com/repos/${repo}`, {
    headers: githubHeaders,
  });
  if (!repoMeta.ok) {
    logWarn("mirror.repo_unavailable", { repo, status: repoMeta.status });
    return failed;
  }
  const defaultBranch = ((await repoMeta.json()) as { default_branch?: string }).default_branch;
  if (!defaultBranch || dataBranch === defaultBranch) {
    logWarn("mirror.branch_not_isolated", {
      repo,
      branch: dataBranch,
      defaultBranch: defaultBranch ?? null,
    });
    return failed;
  }
  const encodedBranch = dataBranch.split("/").map(encodeURIComponent).join("/");
  const branchHead = await fetch(
    `https://api.github.com/repos/${repo}/git/ref/heads/${encodedBranch}`,
    { headers: githubHeaders },
  );
  if (!branchHead.ok) {
    logWarn("mirror.branch_unavailable", { repo, branch: dataBranch, status: branchHead.status });
    return failed;
  }
  const branchRef = ((await branchHead.json()) as { ref?: string }).ref;
  if (branchRef !== `refs/heads/${dataBranch}`) {
    logWarn("mirror.branch_ref_mismatch", {
      repo,
      branch: dataBranch,
      branchRef: branchRef ?? null,
    });
    return failed;
  }

  /** UTF-8 safe base64 (btoa() only handles latin-1). Uses TextEncoder rather
   *  than unescape(encodeURIComponent()): the latter expands every CJK byte to
   *  "%XX" (~3x), which blows up Worker memory on large Chinese-heavy payloads.
   *  We walk the UTF-8 bytes in 32K chunks to stay under String.fromCharCode's
   *  argument cap. */
  function b64utf8(s: string): string {
    const bytes = new TextEncoder().encode(s);
    let bin = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }
  /** Tiny stable hash for "content already up-to-date?" checks. */
  function contentHash(s: string): string {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  /** Hash-stable view of the payload with `generatedAt` stripped. Without
   *  this, the diff-aware check fires every run (timestamp always changes)
   *  and we PUT on every cron tick — exactly what we wanted to avoid. */
  function stableJson(payload: Record<string, unknown>): string {
    const { generatedAt: _ts, ...rest } = payload;
    return JSON.stringify(rest, null, 2);
  }

  /**
   * PUT a file to GitHub. Skips the write entirely if the existing file's
   * content already matches (compared with `generatedAt` excluded, so a
   * fresh timestamp alone doesn't force a commit).
   */
  async function publish(
    path: string,
    payload: Record<string, unknown>,
    commitMessage: string,
  ): Promise<"skipped" | "committed" | "failed"> {
    const url = `https://api.github.com/repos/${repo}/contents/${path}`;
    const nextBody = `${JSON.stringify(payload, null, 2)}\n`;
    const nextStableHash = contentHash(stableJson(payload));

    // GET current file (if any) — need both sha (for upsert) and content
    // (for diff-aware skip).
    let sha: string | undefined;
    let unchanged = false;
    const readUrl = new URL(url);
    readUrl.searchParams.set("ref", dataBranch);
    const head = await fetch(readUrl, {
      headers: githubHeaders,
    });
    if (head.ok) {
      const j = (await head.json()) as { sha?: string; content?: string };
      sha = j.sha;
      if (j.content) {
        try {
          const decoded = decodeURIComponent(escape(atob(j.content.replace(/\n/g, ""))));
          const prevPayload = JSON.parse(decoded) as Record<string, unknown>;
          if (contentHash(stableJson(prevPayload)) === nextStableHash) unchanged = true;
        } catch {
          /* ignore parse/decode errors — treat as changed */
        }
      }
    }
    if (unchanged) return "skipped";

    const put = await fetch(url, {
      method: "PUT",
      headers: {
        ...githubHeaders,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        message: commitMessage,
        content: b64utf8(nextBody),
        branch: dataBranch,
        ...(sha ? { sha } : {}),
      }),
    });
    if (!put.ok) {
      logWarn("mirror.put_failed", {
        path,
        status: put.status,
        response: (await put.text()).slice(0, 200),
      });
      return "failed";
    }
    return "committed";
  }

  const wl = await env.DB.prepare(
    `SELECT x_user_id, handle, last_scored FROM accounts
      WHERE status='whitelisted' ORDER BY last_scored DESC LIMIT 5000`,
  ).all<{ x_user_id: string | null; handle: string; last_scored: number }>();

  // Blacklist export carries the FULL audit fields — reasons + evidence_text +
  // reporter count — so a third party reading data/blacklist/v1.json can
  // verify "why was this account flagged" without trusting our server.
  //
  // Export cap: a safety bound, NOT a product limit. At ~404 bytes/entry the
  // pretty-printed file is ~20MB at this cap; base64 + the GitHub PUT body fit
  // within the Worker's 128MB. Beyond ~50K we must paginate the file
  // (data/blacklist/v1-partN.json) or switch to the Git Data API — see the
  // warn below, which fires before we ever silently truncate again.
  const BL_EXPORT_LIMIT = 50000;
  const bl = await env.DB.prepare(
    `SELECT a.x_user_id, a.handle, a.verdict_label, a.confidence, a.category,
            a.reasons, a.evidence_text, a.published_at, a.published_tier,
            (SELECT count(DISTINCT r.reporter_fp)
               FROM reports r
              WHERE r.handle = a.handle
                AND ifnull(r.x_user_id,'') = ifnull(a.x_user_id,'')
                AND r.reporter_fp IS NOT NULL) AS reporters
       FROM accounts a
      WHERE a.status='human_confirmed' AND a.published_at IS NOT NULL
      ORDER BY a.published_at DESC LIMIT ${BL_EXPORT_LIMIT}`,
  ).all<{
    x_user_id: string | null;
    handle: string;
    verdict_label: string;
    confidence: number;
    category: string | null;
    reasons: string | null;
    evidence_text: string | null;
    published_at: number;
    published_tier: string | null;
    reporters: number;
  }>();

  // Lite export (schema v2): the FULL confirmed set (no audit fields, so no
  // 50K size cap needed) in the same compact row shape as the R2 lite
  // artifact. This is what the extension build pipeline bundles — small
  // enough to ship every entry, and it carries the category the client's
  // per-category action policy needs. v1.json keeps the audit role
  // (reasons/evidence/reporters) unchanged.
  const liteRows = await env.DB.prepare(
    `SELECT x_user_id, handle, verdict_label, category, published_tier
       FROM accounts
      WHERE status='human_confirmed' AND published_at IS NOT NULL
      ORDER BY published_at DESC`,
  ).all<{
    x_user_id: string | null;
    handle: string;
    verdict_label: string;
    category: string | null;
    published_tier: string | null;
  }>();

  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10); // YYYY-MM-DD
  const wlCount = wl.results?.length ?? 0;
  const blCount = bl.results?.length ?? 0;
  if (blCount >= BL_EXPORT_LIMIT) {
    // Don't silently cap: the published `count` would understate reality, which
    // is exactly the bug this guard prevents. Paginate or move to the Git Data
    // API when this fires.
    logWarn("mirror.blacklist_truncated", { limit: BL_EXPORT_LIMIT });
  }

  const whitelist = await publish(
    "data/whitelist/v1.json",
    {
      schema: 1,
      generatedAt: now,
      count: wlCount,
      list: (wl.results ?? []).map((r) => ({
        handle: r.handle,
        x_user_id: r.x_user_id,
        last_scored: r.last_scored,
      })),
    },
    `data(whitelist): sync · ${wlCount} total · ${today}`,
  );

  const blacklist = await publish(
    "data/blacklist/v1.json",
    {
      schema: 1,
      generatedAt: now,
      count: blCount,
      list: (bl.results ?? []).map((r) => ({
        handle: r.handle,
        x_user_id: r.x_user_id,
        verdict_label: r.verdict_label,
        confidence: r.confidence,
        category: r.category,
        reasons: safeReasons(r.reasons),
        evidence_text: r.evidence_text,
        reporters: r.reporters,
        published_at: r.published_at,
        published_tier: r.published_tier === "human" ? "human" : "auto",
      })),
    },
    `data(blacklist): sync · ${blCount} total · ${today}`,
  );

  const liteList = liteRows.results ?? [];
  const mirrorRuleField: Record<string, string> = {
    handle: "h",
    display_name: "d",
    bio: "b",
    tweet: "t",
    any: "a",
  };
  const mirrorRules = (await getKeywordRules(env))
    .filter((r) => r.action === "blacklist")
    .map((r) => [
      r.pattern,
      mirrorRuleField[r.field] ?? "a",
      (r.verdict_label === "porn_bot" ? "p" : "s") +
        (CATEGORY_CODE[(categoryForRule(r) ?? "other") as SpamCategory] ?? "o"),
    ]);
  const lite = await publish(
    "data/blacklist/v2-lite.json",
    {
      schema: 2,
      generatedAt: now,
      count: liteList.length,
      labels: { p: "porn_bot", s: "spam" },
      tiers: { h: "human", a: "auto" },
      categories: Object.fromEntries(
        (Object.entries(CATEGORY_CODE) as [SpamCategory, string][]).map(([k, v]) => [v, k]),
      ),
      rules: mirrorRules,
      entries: liteList.map((r) => [
        r.x_user_id ?? "",
        r.handle,
        (r.verdict_label === "porn_bot" ? "p" : "s") +
          (CATEGORY_CODE[(r.category ?? "other") as SpamCategory] ?? "o") +
          (r.published_tier === "human" ? "h" : "a"),
      ]),
    },
    `data(blacklist): lite sync · ${liteList.length} total · ${today}`,
  );

  return { whitelist, blacklist, lite };
}

// =========================================================================
// Side-channel AGENT pipeline (see docs/AGENT.md)
// =========================================================================
// A side-channel "second-opinion" agent (Hermes on a mac mini being the
// reference impl) polls /v1/agent/queue, runs deeper analysis with X data
// access, and POSTs decisions back via /v1/agent/decide.
//
// Governance hard line: agents can write the three staging statuses
// (agent_blacklist / agent_whitelist / agent_pending) but CANNOT write
// human_confirmed / whitelisted directly. The existing AI≥0.9 + ≥3 GH
// reporters rule and human admin actions remain the only paths to the
// public list and the official whitelist.
//
// Auth: Bearer <AGENT_TOKEN> (independent secret from ADMIN_TOKEN — easier
// to rotate, smaller blast radius).
async function agent(c: Ctx): Promise<{ ok: true; agentId: string } | { ok: false }> {
  const t = c.env.AGENT_TOKEN;
  if (!t) return { ok: false };
  const auth = c.req.raw.headers.get("authorization") ?? "";
  const tok = auth.replace(/^Bearer\s+/i, "").trim();
  if (!tok || !(await timingSafeEqual(tok, t))) return { ok: false };
  // X-Agent-Id is a self-identifier (e.g. "hermes", "claude-luolei-laptop").
  // Used for audit + per-agent throttling later; doesn't grant authority.
  const id = (c.req.raw.headers.get("x-agent-id") ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_:-]{0,63}$/.test(id)) return { ok: false };
  return { ok: true, agentId: id };
}

type AgentQueueRow = {
  x_user_id: string | null;
  handle: string;
  display_name: string | null;
  avatar_url: string | null;
  verdict_label: string;
  confidence: number;
  account_created_at: string | null;
  account_age_days: number | null;
  followers_count: number | null;
  following_count: number | null;
  reasons: string | null;
  evidence_text: string | null;
  last_scored: number;
  signals_hash: string | null;
  agent_id: string | null;
  agent_at: number | null;
  agent_signals_hash: string | null;
  agent_attempts: number;
};

const AGENT_QUEUE_COLUMNS =
  `x_user_id, handle, display_name, avatar_url, verdict_label, confidence,
   account_created_at, account_age_days, followers_count, following_count,
   reasons, evidence_text, last_scored, signals_hash,
   agent_id, agent_at, agent_signals_hash, agent_attempts`;

const AGENT_QUEUE_BUCKETS = [
  {
    where: "following_count > 100000",
    orderBy: "following_count DESC, last_scored DESC",
  },
  {
    where:
      "(following_count IS NULL OR following_count <= 100000) AND verdict_label = 'porn_bot'",
    orderBy: "confidence DESC, last_scored DESC",
  },
  {
    where:
      "(following_count IS NULL OR following_count <= 100000) AND verdict_label = 'spam'",
    orderBy: "confidence DESC, last_scored DESC",
  },
  {
    where:
      "(following_count IS NULL OR following_count <= 100000) AND verdict_label = 'likely_spam'",
    orderBy: "confidence DESC, last_scored DESC",
  },
  {
    where:
      "(following_count IS NULL OR following_count <= 100000) AND verdict_label NOT IN ('porn_bot','spam','likely_spam')",
    orderBy: "last_scored DESC",
  },
] as const;

export async function loadAgentQueue(
  db: D1Database,
  agentId: string,
  limit: number,
): Promise<AgentQueueRow[]> {
  const queue: AgentQueueRow[] = [];
  for (const bucket of AGENT_QUEUE_BUCKETS) {
    const remaining = limit - queue.length;
    if (remaining <= 0) break;
    const rows = await db.prepare(
      `SELECT ${AGENT_QUEUE_COLUMNS}
         FROM accounts
        WHERE status = 'auto_pending_review'
          AND (
            agent_id IS NULL
            OR agent_id != ?
            OR (
              agent_attempts < 3
              AND (
                agent_at IS NULL
                OR agent_signals_hash IS NULL
                OR agent_signals_hash != signals_hash
              )
            )
          )
          AND ${bucket.where}
        ORDER BY ${bucket.orderBy}
        LIMIT ?`,
    )
      .bind(agentId, remaining)
      .all<AgentQueueRow>();
    queue.push(...(rows.results ?? []));
  }
  return queue;
}

// GET /v1/agent/queue — items the agent should look at next.
// A reviewer can re-check rows last handled by a different agent, while its
// own fresh annotations stay idempotent. High-following rows and first-pass
// porn/spam labels are returned before ambiguous accounts so the fixed token
// budget reaches the most actionable queue segments first. Capped at 100.
app.get("/v1/agent/queue", async (c) => {
  const a = await agent(c);
  if (!a.ok) return c.json({ error: "forbidden" }, 403);
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit")) || 30));
  const queue = await loadAgentQueue(c.env.DB, a.agentId, limit);
  return c.json({
    agent_id: a.agentId,
    queue,
  });
});

// POST /v1/agent/decide — agent writes its verdict + (optionally) transitions
// the row to an agent-tier staging status. Idempotent on (x_user_id|handle).
//
// Body shape (Zod-validated below). The `decision` field is what the agent
// recommends:
//   "blacklist" → status becomes 'agent_blacklist' (NOT public)
//   "whitelist" → status becomes 'agent_whitelist' (NOT official WL)
//   "pending"   → status becomes 'agent_pending'   (待定, surface to human)
//   "annotate"  → status untouched, agent_* columns updated only
//
// We always write the agent_* annotations and append a review_log row with
// actor='agent:<agent_id>' only when the row is still in the fresh agent queue.
// We never touch status=human_confirmed or status=whitelisted — stale agent
// decisions lose the race and return 409 without changing audit state.
const AgentDecideBody = z.object({
  x_user_id: optionalNumericId,
  handle: z.string().min(1).max(64),
  decision: z.enum(["blacklist", "whitelist", "pending", "annotate"]),
  label: z.enum(["spam", "porn_bot", "likely_spam", "uncertain", "legit"]),
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.string().max(200)).max(20).default([]),
  signals: z.array(z.string().max(20)).max(30).default([]),
  evidence: z.record(z.unknown()).optional(),
  action: z.enum(["approve_block", "reject_legit", "needs_human"]),
  model: z.string().max(80).optional(),
  signals_hash: z.string().max(64).optional(),
  error: z.string().max(1000).optional(),
  notes: z.string().max(2000).optional(),
});

function statusForAgentDecision(d: z.infer<typeof AgentDecideBody>["decision"]): string | null {
  if (d === "blacklist") return "agent_blacklist";
  if (d === "whitelist") return "agent_whitelist";
  if (d === "pending") return "agent_pending";
  return null; // annotate-only
}

function isAgentFailureAttempt(body: z.infer<typeof AgentDecideBody>): boolean {
  if (body.decision !== "annotate" || body.action !== "needs_human") return false;
  if (body.error) return true;
  return body.label === "uncertain" && body.confidence === 0
    ? body.reasons.some((r) => /fail|timeout|parse/i.test(r))
    : false;
}

app.post("/v1/agent/decide", async (c) => {
  const a = await agent(c);
  if (!a.ok) return c.json({ error: "forbidden" }, 403);
  let body: z.infer<typeof AgentDecideBody>;
  try {
    body = AgentDecideBody.parse(await c.req.json());
  } catch (err) {
    return c.json({ error: "bad_request", detail: (err as Error).message }, 400);
  }
  const handle = normalizeHandle(body.handle);
  const uid = body.x_user_id ?? null;
  const now = Date.now();
  const nextStatus = statusForAgentDecision(body.decision);
  const evidenceJson = body.evidence ? JSON.stringify(body.evidence) : null;
  const reasonsJson = JSON.stringify(body.reasons);
  const signalsJson = JSON.stringify(body.signals);
  const decidedBy = `agent:${a.agentId}`;
  const failedAttempt = isAgentFailureAttempt(body);
  const noteShort = (body.notes ?? "").slice(0, 400);
  const agentError = body.error
    ? body.error.slice(0, 1000)
    : failedAttempt
      ? (body.notes || body.reasons.join(" · ") || "agent_failed").slice(0, 1000)
      : null;
  const signalGuard = body.signals_hash ? " AND (signals_hash IS NULL OR signals_hash=?)" : "";

  // Write annotation columns. Update statement targets the canonical row;
  // matches by uid when present (preferred), else by normalized handle.
  // The status guard prevents a stale agent decision from downgrading a row
  // already handled by admin or another stronger path.
  const annotateSql = uid
    ? `UPDATE accounts
          SET agent_id=?, agent_label=?, agent_confidence=?, agent_reasons=?,
              agent_signals=?, agent_evidence=?, agent_action=?, agent_model=?,
              agent_at=?, agent_signals_hash=?,
              agent_attempts=CASE WHEN ?=1 THEN agent_attempts+1 ELSE 0 END,
              agent_error=?,
              last_decided_by=?, last_decided_at=?
              ${nextStatus ? ", status=?" : ""}
        WHERE lower(handle)=? AND x_user_id=? AND status='auto_pending_review'${signalGuard}`
    : `UPDATE accounts
          SET agent_id=?, agent_label=?, agent_confidence=?, agent_reasons=?,
              agent_signals=?, agent_evidence=?, agent_action=?, agent_model=?,
              agent_at=?, agent_signals_hash=?,
              agent_attempts=CASE WHEN ?=1 THEN agent_attempts+1 ELSE 0 END,
              agent_error=?,
              last_decided_by=?, last_decided_at=?
              ${nextStatus ? ", status=?" : ""}
        WHERE lower(handle)=? AND x_user_id IS NULL AND status='auto_pending_review'${signalGuard}`;
  const annotateBinds: unknown[] = [
    a.agentId,
    body.label,
    body.confidence,
    reasonsJson,
    signalsJson,
    evidenceJson,
    body.action,
    body.model ?? null,
    now,
    body.signals_hash ?? null,
    failedAttempt ? 1 : 0,
    agentError,
    decidedBy,
    now,
  ];
  if (nextStatus) annotateBinds.push(nextStatus);
  annotateBinds.push(handle);
  if (uid) annotateBinds.push(uid);
  if (body.signals_hash) annotateBinds.push(body.signals_hash);

  const updated = await c.env.DB.prepare(annotateSql)
    .bind(...annotateBinds)
    .run();
  const changes = Number(updated.meta?.changes ?? 0);
  if (changes === 0) {
    return c.json(
      {
        ok: false,
        error: "stale_agent_decision",
        detail: "row is no longer in the fresh agent queue",
      },
      409,
    );
  }

  // Audit: every agent decision lands in review_log so the maintainer
  // panel and the public audit log can show "decided by agent:hermes" with
  // a click-through to the reasons.
  const logAction = nextStatus ? `agent_${body.decision}` : "agent_annotate";
  await c.env.DB.prepare(
    "INSERT INTO review_log (x_user_id,handle,action,actor,note,at) VALUES (?,?,?,?,?,?)",
  )
    .bind(uid, handle, logAction, decidedBy, noteShort, now)
    .run();
  return c.json({
    ok: true,
    agent_id: a.agentId,
    status: nextStatus ?? "(annotate-only)",
  });
});

// GET /v1/agent/stats — quick "what has the agent been doing" health check.
// Useful for the dashboard, the cron's startup self-check, and ops.
app.get("/v1/agent/stats", async (c) => {
  const a = await agent(c);
  if (!a.ok) return c.json({ error: "forbidden" }, 403);
  const byStatus = await c.env.DB.prepare(
    `SELECT status, COUNT(*) n FROM accounts
      WHERE status IN ('agent_blacklist','agent_whitelist','agent_pending')
      GROUP BY status`,
  ).all<{ status: string; n: number }>();
  const byDecidedBy = await c.env.DB.prepare(
    `SELECT last_decided_by, COUNT(*) n FROM accounts
      WHERE last_decided_by IS NOT NULL
      GROUP BY last_decided_by
      ORDER BY n DESC LIMIT 20`,
  ).all<{ last_decided_by: string; n: number }>();
  const last24 = await c.env.DB.prepare(
    `SELECT COUNT(*) n FROM accounts
      WHERE agent_at IS NOT NULL AND agent_at >= ?`,
  )
    .bind(Date.now() - 24 * 3600_000)
    .first<{ n: number }>();
  return c.json({
    agent_id: a.agentId,
    by_status: byStatus.results ?? [],
    by_decided_by: byDecidedBy.results ?? [],
    decisions_last_24h: last24?.n ?? 0,
  });
});

// =========================================================================
// Admin-side surface for the agent pipeline
// =========================================================================
// The agent decision endpoint lives at /v1/agent/decide (Bearer AGENT_TOKEN),
// but the admin /admin UI needs its own surface to review those agent
// verdicts — using the maintainer's ADMIN_TOKEN, not the agent token. The
// two endpoints below serve the three agent-curated staging buckets and
// let the maintainer 1-click promote / reject / move them.

// GET /v1/admin/agent-list?bucket=blacklist|whitelist|pending&limit=&before=
// Returns the agent-staged rows so /admin can render them with full
// agent reasoning (label, confidence, fired_signals, evidence, notes).
app.get("/v1/admin/agent-list", async (c) => {
  if (!(await admin(c))) return c.json({ error: "forbidden" }, 403);
  const bucket = (c.req.query("bucket") || "").trim();
  const map: Record<string, string> = {
    blacklist: "agent_blacklist",
    whitelist: "agent_whitelist",
    pending: "agent_pending",
  };
  const status = map[bucket];
  if (!status) return c.json({ error: "bad_bucket" }, 400);
  const before = Number(c.req.query("before")) || null;
  const limit = Math.min(200, Math.max(1, Number(c.req.query("limit")) || 100));
  const rows = await c.env.DB.prepare(
    `SELECT x_user_id, handle, display_name, avatar_url,
            account_created_at, account_age_days, followers_count, following_count,
            verdict_label, confidence, reasons, evidence_text,
            agent_id, agent_label, agent_confidence, agent_reasons,
            agent_signals, agent_evidence, agent_action, agent_model,
            agent_at, last_decided_by, last_decided_at, last_scored
       FROM accounts
      WHERE status=?
        AND (?2 IS NULL OR agent_at < ?2)
      ORDER BY agent_at DESC LIMIT ?3`,
  )
    .bind(status, before, limit)
    .all<{ agent_at: number }>();
  const list = rows.results ?? [];
  return c.json({
    bucket,
    list,
    nextBefore: list.length === limit ? list[list.length - 1].agent_at : null,
  });
});

// POST /v1/admin/agent-promote
// Maintainer reviews an agent-staged row and decides what really happens.
// target: "blacklist" → human_confirmed (public list)
//         "whitelist" → whitelisted (official whitelist)
//         "reject"    → rejected (drop, keep audit)
//         "requeue"   → auto_pending_review (kick back to LLM-fresh queue)
// Reuses buildDecideStatements where possible so the existing decide path
// and this promotion path can't drift behaviorally.
const AgentPromoteBody = z.object({
  handle: z.string().min(1),
  x_user_id: optionalNumericId,
  target: z.enum(["blacklist", "whitelist", "reject", "requeue"]),
});
const AgentPromoteBatch = z.object({
  target: z.enum(["blacklist", "whitelist", "reject", "requeue"]),
  items: z
    .array(
      z.object({
        handle: z.string().min(1),
        x_user_id: optionalNumericId,
      }),
    )
    .min(1)
    .max(100),
});

function agentPromoteStmts(
  env: Bindings,
  handle: string,
  xUserId: string | undefined,
  target: z.infer<typeof AgentPromoteBody>["target"],
  now: number,
): D1PreparedStatement[] {
  if (target === "requeue") {
    // Wipe the agent annotation and put the row back on the LLM-fresh queue.
    const sql = xUserId
      ? `UPDATE accounts
            SET status='auto_pending_review',
                agent_id=NULL,
                agent_label=NULL,
                agent_confidence=NULL,
                agent_reasons=NULL,
                agent_signals=NULL,
                agent_evidence=NULL,
                agent_action=NULL,
                agent_model=NULL,
                agent_at=NULL,
                agent_signals_hash=NULL,
                agent_attempts=0,
                agent_error=NULL,
                last_decided_by=NULL, last_decided_at=NULL
          WHERE lower(handle)=? AND x_user_id=?`
      : `UPDATE accounts
            SET status='auto_pending_review',
                agent_id=NULL,
                agent_label=NULL,
                agent_confidence=NULL,
                agent_reasons=NULL,
                agent_signals=NULL,
                agent_evidence=NULL,
                agent_action=NULL,
                agent_model=NULL,
                agent_at=NULL,
                agent_signals_hash=NULL,
                agent_attempts=0,
                agent_error=NULL,
                last_decided_by=NULL, last_decided_at=NULL
          WHERE lower(handle)=? AND x_user_id IS NULL`;
    const stmt = env.DB.prepare(sql);
    return xUserId ? [stmt.bind(handle, xUserId)] : [stmt.bind(handle)];
  }
  // approve / whitelist / reject reuse the existing buildDecideStatements
  // contract so the published_at and sibling-cleanup logic stays single-source.
  const action: DecideAction =
    target === "blacklist" ? "approve" : target === "whitelist" ? "whitelist" : "reject";
  return buildDecideStatements(env, handle, xUserId, action, now);
}

app.post("/v1/admin/agent-promote", async (c) => {
  if (!(await admin(c))) return c.json({ error: "forbidden" }, 403);
  let body: z.infer<typeof AgentPromoteBody>;
  try {
    body = AgentPromoteBody.parse(await c.req.json());
  } catch (err) {
    return c.json({ error: "bad_request", detail: (err as Error).message }, 400);
  }
  const handle = normalizeHandle(body.handle);
  const now = Date.now();
  const stmts = agentPromoteStmts(c.env, handle, body.x_user_id, body.target, now);
  // Audit: log who promoted the agent decision and to what.
  stmts.push(
    c.env.DB.prepare(
      "INSERT INTO review_log (x_user_id,handle,action,actor,note,at) VALUES (?,?,?,?,?,?)",
    ).bind(
      body.x_user_id ?? null,
      handle,
      `agent_promote_${body.target}`,
      "admin",
      "promoted from agent staging",
      now,
    ),
  );
  // Mark this as a human decision now, overriding the prior agent stamp on
  // last_decided_by — useful for the BL/WL panel chips.
  if (body.target !== "requeue") {
    stmts.push(
      c.env.DB.prepare(
        body.x_user_id
          ? "UPDATE accounts SET last_decided_by='human:admin', last_decided_at=? WHERE lower(handle)=? AND x_user_id=?"
          : "UPDATE accounts SET last_decided_by='human:admin', last_decided_at=? WHERE lower(handle)=? AND x_user_id IS NULL",
      ).bind(...(body.x_user_id ? [now, handle, body.x_user_id] : [now, handle])),
    );
  }
  await batchAll(c.env, stmts);
  return c.json({ ok: true, target: body.target });
});

app.post("/v1/admin/agent-promote-batch", async (c) => {
  if (!(await admin(c))) return c.json({ error: "forbidden" }, 403);
  let body: z.infer<typeof AgentPromoteBatch>;
  try {
    body = AgentPromoteBatch.parse(await c.req.json());
  } catch (err) {
    return c.json({ error: "bad_request", detail: (err as Error).message }, 400);
  }
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  for (const it of body.items) {
    const h = normalizeHandle(it.handle);
    stmts.push(...agentPromoteStmts(c.env, h, it.x_user_id, body.target, now));
    stmts.push(
      c.env.DB.prepare(
        "INSERT INTO review_log (x_user_id,handle,action,actor,note,at) VALUES (?,?,?,?,?,?)",
      ).bind(
        it.x_user_id ?? null,
        h,
        `agent_promote_${body.target}`,
        "admin",
        "promoted from agent staging (batch)",
        now,
      ),
    );
    if (body.target !== "requeue") {
      stmts.push(
        c.env.DB.prepare(
          it.x_user_id
            ? "UPDATE accounts SET last_decided_by='human:admin', last_decided_at=? WHERE lower(handle)=? AND x_user_id=?"
            : "UPDATE accounts SET last_decided_by='human:admin', last_decided_at=? WHERE lower(handle)=? AND x_user_id IS NULL",
        ).bind(...(it.x_user_id ? [now, h, it.x_user_id] : [now, h])),
      );
    }
  }
  await batchAll(c.env, stmts);
  return c.json({ ok: true, target: body.target, processed: body.items.length });
});

/** Admin-only manual trigger — handy after a batch of admin decisions when
 *  you don't want to wait for the next 6h cron tick. Same code path as the
 *  scheduled handler; cron just calls mirrorToGitHub directly. */
app.post("/v1/admin/sync-mirror", async (c) => {
  if (!(await admin(c))) return c.json({ error: "forbidden" }, 403);
  if (!c.env.WHITELIST_SYNC_TOKEN) {
    return c.json({ error: "mirror_disabled", reason: "WHITELIST_SYNC_TOKEN not set" }, 503);
  }
  if (!mirrorBranch(c.env)) {
    return c.json(
      {
        error: "mirror_branch_not_configured",
        reason: "WHITELIST_SYNC_BRANCH must name a valid, non-default data branch",
      },
      503,
    );
  }
  const results = await mirrorToGitHub(c.env);
  const failed =
    results.whitelist === "failed" || results.blacklist === "failed" || results.lite === "failed";
  if (failed) return c.json({ ok: false, error: "mirror_failed", results }, 502);
  return c.json({ ok: true, results });
});

async function publishArtifacts(env: Bindings): Promise<void> {
  const rows = await env.DB.prepare(
    "SELECT x_user_id, handle, verdict_label, confidence, category, published_at, published_tier FROM accounts WHERE status='human_confirmed' ORDER BY published_at DESC",
  ).all<{
    x_user_id: string | null;
    handle: string;
    verdict_label: string;
    confidence: number;
    category: string | null;
    published_at: number;
    published_tier: string | null;
  }>();

  const rawAccounts = rows.results ?? [];
  const accounts = rawAccounts.filter((account) =>
    isArtifactIdentityValid(account.x_user_id, account.handle),
  );
  const droppedInvalidIdentities = rawAccounts.length - accounts.length;
  if (droppedInvalidIdentities > 0) {
    logWarn("artifact_invalid_identities_dropped", {
      dropped: droppedInvalidIdentities,
      total: rawAccounts.length,
    });
  }
  // NULL tier = written between the migration and this deploy; treat as
  // 'auto' (fail-safe: never auto-block an entry of unknown provenance).
  const tierCode = (t: string | null) => (t === "human" ? "h" : "a");
  if (!accounts.length) return;

  // Snapshot the pending-review count here (one bounded scan per 10-min run) so
  // /v1/list/meta can read it from the ledger instead of scanning the whole
  // auto_pending_review partition on every request.
  const pendingRow = await env.DB.prepare(
    "SELECT count(*) n FROM accounts WHERE status='auto_pending_review'",
  ).first<{ n: number }>();
  const pendingCount = pendingRow?.n ?? 0;

  const bloomItems = accounts.flatMap((a) =>
    [a.handle, a.x_user_id].filter((v): v is string => !!v),
  );
  const bloomB64 = bloomToBase64(buildBloom(bloomItems));
  const entries: Record<string, PublishedShardEntry> = {};
  const shards: Record<string, string[]> = {};

  for (let i = 0; i < accounts.length; i += BLOOM_SHARD_SIZE) {
    const shardKey = `shard-${Math.floor(i / BLOOM_SHARD_SIZE)}.json`;
    shards[shardKey] = [];
    for (const a of accounts.slice(i, i + BLOOM_SHARD_SIZE)) {
      const entry: PublishedShardEntry = {
        userId: a.x_user_id,
        handle: a.handle,
        label: a.verdict_label,
        confidence: a.confidence,
        published_at: a.published_at,
        tier: a.published_tier === "human" ? "human" : "auto",
      };
      const primaryKey = a.x_user_id ?? `handle:${a.handle.toLowerCase()}`;
      entries[primaryKey] = entry;
      if (a.handle) entries[`handle:${a.handle.toLowerCase()}`] = entry;
      shards[shardKey].push(primaryKey);
    }
  }

  // base64 includes '+' and '/', which would land in the artifact object
  // keys (bloom-<version>.b64 etc.) and the /v1/artifacts/<key> URLs that
  // /v1/list/meta advertises. The artifacts route rejects any key with a
  // '/' (path-traversal guard), so a slash in the version made every
  // published artifact URL 404. Use the URL-safe base64 alphabet for the
  // version prefix so keys are always single path segments.
  const versionPrefix = bloomB64.slice(0, 16).replace(/\+/g, "-").replace(/\//g, "_");
  const version = `v${versionPrefix}-${accounts.length}`;
  const now = Date.now();
  const bloomKey = `bloom-${version}.b64`;
  const metaKey = `meta-${version}.json`;
  const jsonKey = `shards-${version}.json`;
  const liteKey = `lite-${version}.json`;

  // Lite artifact (schema v2): one compact row per account —
  //   [x_user_id ("" when handle-only), handle, "<label><category><tier>"]
  // where label is p=porn_bot / s=spam, category is the 1-char code from
  // CATEGORY_CODE ("o" while the LLM backfill hasn't categorized the row yet),
  // and tier is h=human-confirmed / a=auto-published (AI/rule/mention). Old
  // 2-char codes parse fine on clients (missing tier reads as 'auto').
  // ~50 bytes/entry vs ~300 in the legacy shards JSON (which double-keys every
  // entry by id AND handle with verbose field names). Consumers derive both
  // lookup maps from the single row. The legacy shards artifact keeps being
  // published unchanged for old consumers.
  const liteEntries = accounts.map((a) => [
    a.x_user_id ?? "",
    a.handle,
    (a.verdict_label === "porn_bot" ? "p" : "s") +
      (CATEGORY_CODE[(a.category ?? "other") as SpamCategory] ?? "o") +
      tierCode(a.published_tier),
  ]);
  // Ship the enabled blacklist keyword rules with the artifact so clients can
  // flag first-seen template accounts (brand-new throwaways not yet on the
  // list) locally, with zero upload. Same maintainer-curated rules the server
  // uses as its pre-LLM fast path; the client applies the same translation
  // guard. Compact row: [pattern, fieldCode, labelCode+categoryCode].
  const RULE_FIELD_CODE: Record<string, string> = {
    handle: "h",
    display_name: "d",
    bio: "b",
    tweet: "t",
    any: "a",
  };
  const liteRules = (await getKeywordRules(env))
    .filter((r) => r.action === "blacklist")
    .map((r) => [
      r.pattern,
      RULE_FIELD_CODE[r.field] ?? "a",
      (r.verdict_label === "porn_bot" ? "p" : "s") +
        (CATEGORY_CODE[(categoryForRule(r) ?? "other") as SpamCategory] ?? "o"),
    ]);

  const liteArtifact = {
    schema: 2,
    version,
    generatedAt: now,
    count: accounts.length,
    labels: { p: "porn_bot", s: "spam" },
    tiers: { h: "human", a: "auto" },
    categories: Object.fromEntries(
      (Object.entries(CATEGORY_CODE) as [SpamCategory, string][]).map(([k, v]) => [v, k]),
    ),
    rules: liteRules,
    entries: liteEntries,
  };

  await env.ARTIFACTS.put(bloomKey, bloomB64, {
    httpMetadata: {
      contentType: "text/plain",
      cacheControl: "public, max-age=300, s-maxage=600",
    },
  });
  await env.ARTIFACTS.put(liteKey, JSON.stringify(liteArtifact), {
    httpMetadata: {
      contentType: "application/json",
      cacheControl: "public, max-age=300, s-maxage=600",
    },
  });
  await env.ARTIFACTS.put(
    metaKey,
    JSON.stringify({
      version,
      count: accounts.length,
      generatedAt: now,
      bloomKey,
      shardsKey: jsonKey,
      liteKey,
      shardCount: Object.keys(shards).length,
      bloomSize: BLOOM_SIZE,
      bloomHashes: BLOOM_HASHES,
    }),
    {
      httpMetadata: {
        contentType: "application/json",
        cacheControl: "public, max-age=300, s-maxage=600",
      },
    },
  );
  await env.ARTIFACTS.put(
    jsonKey,
    JSON.stringify({
      version,
      generatedAt: now,
      count: accounts.length,
      shardSize: BLOOM_SHARD_SIZE,
      shards,
      entries,
    }),
    {
      httpMetadata: {
        contentType: "application/json",
        cacheControl: "public, max-age=300, s-maxage=600",
      },
    },
  );

  // ON CONFLICT keeps count/pending_count fresh every run even when the
  // confirmed set (and thus the version key) is unchanged, without bumping
  // published_at (so "latest publication" ordering stays stable) or re-writing
  // R2 objects. That way /v1/list/meta's pending never goes stale between
  // confirmed-set changes.
  await env.DB.prepare(
    `INSERT INTO publications (version, bloom_key, json_key, meta_key, lite_key, count, pending_count, published_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(version) DO UPDATE SET count=excluded.count, pending_count=excluded.pending_count, lite_key=excluded.lite_key`,
  )
    .bind(version, bloomKey, jsonKey, metaKey, liteKey, accounts.length, pendingCount, now)
    .run();
}

// R2 retention. publishArtifacts writes 3 objects (~23 MB, dominated by the
// shards JSON) every time the confirmed set changes — up to every 10 min — and
// historically NEVER deleted the old ones, so the bucket grew without bound
// (69.9 GB / ~10K objects by 2026-06-30, ~+2.8 GB/day). Clients only ever need
// the newest version (advertised by /v1/list/meta), so keep a small rollback
// window and sweep the rest. List-based (not just ledger-based) so it also
// reclaims pre-ledger orphan objects. Bounded per run so the initial backlog
// drains over a few cron ticks without risking a long invocation.
const KEEP_PUBLICATIONS = 24;
const PRUNE_MAX_DELETE_PER_RUN = 2000;

async function prunePublications(env: Bindings): Promise<void> {
  // Objects referenced by the newest KEEP_PUBLICATIONS versions — never delete
  // these (the live version is always among them).
  const keep = await env.DB.prepare(
    "SELECT bloom_key, json_key, meta_key, lite_key FROM publications ORDER BY published_at DESC LIMIT ?",
  )
    .bind(KEEP_PUBLICATIONS)
    .all<{ bloom_key: string; json_key: string; meta_key: string; lite_key: string | null }>();
  const keepSet = new Set<string>();
  for (const p of keep.results ?? []) {
    keepSet.add(p.bloom_key);
    keepSet.add(p.json_key);
    keepSet.add(p.meta_key);
    if (p.lite_key) keepSet.add(p.lite_key);
  }
  // Safety: if we can't tell what's live, do nothing rather than nuke the bucket.
  if (!keepSet.size) return;

  const toDelete: string[] = [];
  let cursor: string | undefined;
  do {
    const listed = await env.ARTIFACTS.list({ limit: 1000, cursor });
    for (const obj of listed.objects) {
      if (!keepSet.has(obj.key)) toDelete.push(obj.key);
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor && toDelete.length < PRUNE_MAX_DELETE_PER_RUN);

  if (!toDelete.length) return;
  const batch = toDelete.slice(0, PRUNE_MAX_DELETE_PER_RUN);
  // R2 batch delete accepts up to 1000 keys per call; DELETE ops are free.
  for (let i = 0; i < batch.length; i += 1000) {
    await env.ARTIFACTS.delete(batch.slice(i, i + 1000));
  }
  // Keep the ledger bounded too (rows beyond the retention window).
  await env.DB.prepare(
    "DELETE FROM publications WHERE id NOT IN (SELECT id FROM publications ORDER BY published_at DESC LIMIT ?)",
  )
    .bind(KEEP_PUBLICATIONS)
    .run();
  logInfo("artifacts.pruned", { pruned: batch.length, kept: keepSet.size });
}

// =========================================================================
// Category backfill — LLM batch sweep over legacy published rows.
// =========================================================================
// Historical human_confirmed spam rows predate the category column. Per the
// project's no-keyword-guessing rule, they are categorized by the LLM from
// the account's stored context (handle / display name / evidence / reasons),
// a bounded batch per cron tick. HARD CAPS: ≤BACKFILL_CALLS_PER_TICK LLM
// calls per 10-min tick (cost ceiling ~288 calls/day), and the sweep is
// self-extinguishing — once no NULL-category rows remain it selects nothing
// and never calls the LLM again.
// 16 rows/call keeps the answer JSON small enough that a reasoning model
// can't blow through max_tokens (the original 40-row batches deterministically
// truncated at temperature 0 and stalled the sweep — see ORDER BY RANDOM()
// note below).
const BACKFILL_ROWS_PER_CALL = 16;
const BACKFILL_CALLS_PER_TICK = 3;

const BackfillAnswer = z.object({
  categories: z
    .array(z.object({ i: z.number().int().nonnegative(), c: z.enum(SPAM_CATEGORIES) }))
    .max(BACKFILL_ROWS_PER_CALL * 2),
});

const BACKFILL_SYSTEM = `You categorize X (Twitter) SPAM accounts (already confirmed spam) into the business category the account is pushing. Use ALL provided context per account (handle, display name, the public post/evidence snippet, prior classifier reasons).
Categories:
- "porn": sexual solicitation, escort/hookup ads, porn bots
- "crypto": coins/tokens, trading, airdrops, stocks/investment shilling
- "gambling": casino, sports betting, lottery
- "resource": netdisk / pirated "resource" bait (网盘/资源自取 links)
- "marketing": generic ads, follower-farming, promo matrix, redirect bait for promotion
- "other": spam that fits none of the above, or too little context to tell
Note: the evidence text may be machine-translated by X; judge the substance, not the surface language.
Return ONLY JSON: {"categories":[{"i":<row number>,"c":"porn|crypto|gambling|resource|marketing|other"}, ...]} covering every row.`;

interface BackfillRow {
  rowid: number;
  handle: string;
  display_name: string | null;
  evidence_text: string | null;
  reasons: string | null;
}

async function backfillCategories(env: Bindings): Promise<void> {
  if (!env.LLM_API_BASE || !env.LLM_API_KEY) return;
  // ORDER BY RANDOM(), not rowid: with a deterministic order + temperature 0,
  // a batch whose content makes the model fail (e.g. runaway reasoning →
  // truncation) is re-selected and re-fails every tick, freezing the sweep.
  // Random sampling makes every tick draw a different batch, so no subset of
  // rows can block the rest.
  const rows = await env.DB.prepare(
    `SELECT rowid, handle, display_name, evidence_text, reasons
       FROM accounts
      WHERE status='human_confirmed'
        AND verdict_label IN ('spam','likely_spam')
        AND category IS NULL
      ORDER BY RANDOM()
      LIMIT ?`,
  )
    .bind(BACKFILL_ROWS_PER_CALL * BACKFILL_CALLS_PER_TICK)
    .all<BackfillRow>();
  const pending = rows.results ?? [];
  if (!pending.length) return;

  for (let off = 0; off < pending.length; off += BACKFILL_ROWS_PER_CALL) {
    const batch = pending.slice(off, off + BACKFILL_ROWS_PER_CALL);
    const lines = batch.map((r, idx) => {
      const reasons = safeReasons(r.reasons).join("; ").slice(0, 160);
      const evidence = (r.evidence_text ?? "").slice(0, 200);
      return `${idx}. @${r.handle} | name: ${r.display_name || "(empty)"} | evidence: ${evidence || "(none)"} | reasons: ${reasons || "(none)"}`;
    });
    let answer: z.infer<typeof BackfillAnswer> | null = null;
    const messages: { role: string; content: string }[] = [
      { role: "system", content: BACKFILL_SYSTEM },
      { role: "user", content: lines.join("\n") },
    ];
    // Two attempts, mirroring classify(): the retry asks for the compact JSON
    // only, which recovers from truncated / prose-wrapped first answers.
    for (let attempt = 0; attempt < 2 && !answer; attempt++) {
      try {
        const res = await fetch(`${env.LLM_API_BASE}/chat/completions`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${env.LLM_API_KEY}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: env.LLM_API_MODEL,
            temperature: 0,
            max_tokens: 8192,
            messages,
          }),
        });
        if (!res.ok) throw new Error(`LLM ${res.status}`);
        const j = (await res.json()) as { choices: ChatChoice[] };
        const choice = j.choices[0];
        const txt = (choice?.message?.content || choice?.message?.reasoning_content || "").trim();
        try {
          answer = BackfillAnswer.parse(extractVerdictJson(txt));
        } catch (parseErr) {
          messages.push(
            { role: "assistant", content: txt.slice(0, 1500) },
            {
              role: "user",
              content:
                'Reply with ONLY the compact JSON object {"categories":[{"i":<n>,"c":"<category>"}...]} covering every row — no reasoning, no markdown fences.',
            },
          );
          if (attempt === 1) {
            logWarn("category_backfill.parse_failed", { error: errorMessage(parseErr) });
          }
        }
      } catch (e) {
        logError("category_backfill.llm_failed", e);
        break; // network/HTTP failure — skip this batch, try the next one
      }
    }
    // A failed batch no longer aborts the tick: with random sampling the next
    // batch is a different draw, so one bad batch can't stall the sweep.
    if (!answer) continue;
    const updates = answer.categories
      .filter((a) => a.i >= 0 && a.i < batch.length)
      .map((a) =>
        env.DB.prepare(
          "UPDATE accounts SET category=? WHERE rowid=? AND category IS NULL",
        ).bind(a.c, batch[a.i]?.rowid),
      );
    if (updates.length) await env.DB.batch(updates);
    logInfo("category_backfill.completed", {
      labeled: updates.length,
      batch: batch.length,
    });
  }
}

export default {
  fetch: app.fetch,
  scheduled(event: ScheduledController, env: Bindings, ctx: ExecutionContext): void {
    // Dispatch by trigger (must match wrangler.toml [triggers].crons):
    //   "0 */6 * * *"  → GitHub mirror only. Running it on every trigger was
    //                    why the data repo got a sync commit every 10 minutes.
    //   "*/10 * * * *" → R2 artifact publish (cheap, diff-tolerant).
    if (event.cron === "0 */6 * * *") {
      ctx.waitUntil(mirrorToGitHub(env).catch((e) => logError("mirror.failed", e)));
    } else {
      // Publish, then prune old R2 artifacts regardless of publish outcome so
      // the retention sweep always runs (and drains the historical backlog).
      ctx.waitUntil(
        publishArtifacts(env)
          .catch((e) => logError("artifact_publish.failed", e))
          .then(() => prunePublications(env))
          .catch((e) => logError("artifact_prune.failed", e)),
      );
      // Legacy-row category sweep (bounded LLM spend per tick; self-stops
      // once every published spam row carries a category).
      ctx.waitUntil(
        backfillCategories(env).catch((e) => logError("category_backfill.failed", e)),
      );
    }
  },
} satisfies ExportedHandler<Bindings>;
