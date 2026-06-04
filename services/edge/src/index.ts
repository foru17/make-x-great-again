import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { ANALYTICS_CSP } from "./analytics";
import { adminHtml } from "./pages/admin";
import { landingHtml } from "./pages/landing";
import { listHtml } from "./pages/list";

interface Env {
  DB: D1Database;
  ARTIFACTS: R2Bucket;
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
}

type Ctx = Context<{ Bindings: Env }>;

const AUTO_CONF = 0.9; // AI confidence floor for auto-publish
const AUTO_REPORTERS = 3; // distinct GitHub reporters required for auto-publish
// GH accounts younger than this don't count toward the auto-publish
// reporter threshold. Their reports are still stored (audit /
// future re-evaluation), but a fresh throwaway account can't help flip
// status to human_confirmed. 90d is a common drive-by abuse cutoff.
const REPORTER_MIN_AGE_DAYS = 90;
const REPORT_WINDOW_MS = 60 * 60_000;
const REPORT_MAX_PER_WINDOW = 10;
const BLOOM_SIZE = 65_536; // 8 KB bit array
const BLOOM_HASHES = 7;
const BLOOM_SHARD_SIZE = 500; // accounts per logical shard in the JSON artifact

interface PublishedShardEntry {
  userId: string | null;
  handle: string;
  label: string;
  confidence: number;
  published_at: number;
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

async function reporterFingerprint(env: Env, reporterId: string): Promise<string | null> {
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

const Signals = z.object({
  // X numeric user id — immutable, the canonical identity key. Optional
  // because the fiber-walk that extracts it from X's React state fails on
  // some feed/reply contexts; we still accept handle-only payloads but the
  // worker logs and cleans those up at write-time (see writeAccount). When
  // present, must be the digit-only id — matches the Node-side schema in
  // `src/schema.ts` and tightens what was previously z.string().optional().
  userId: z.string().regex(/^\d+$/, "userId must be the X numeric id").optional(),
  handle: z.string().min(1),
  displayName: z.string().default(""),
  bio: z.string().default(""),
  recentTweets: z.array(z.string()).max(20).default([]),
  triggeringComment: z.string().optional(),
  threadTopic: z.string().optional(),
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
});
type Signals = z.infer<typeof Signals>;

const Verdict = z.object({
  label: z.enum(["spam", "porn_bot", "likely_spam", "uncertain", "legit"]),
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.string()).min(1).max(6),
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
Return ONLY JSON: {"label":"spam|porn_bot|likely_spam|uncertain|legit","confidence":<0..1>,"reasons":[1-6 short strings]}`;

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
${meta ? `signals: ${meta}\n` : ""}threadTopic: ${s.threadTopic ?? "(none)"}
triggeringComment: ${s.triggeringComment ?? "(none)"}
recentTweets:
${s.recentTweets.map((t, i) => `  ${i + 1}. ${t}`).join("\n") || "  (none)"}`;
}

async function classify(env: Env, s: Signals): Promise<Verdict> {
  const res = await fetch(`${env.LLM_API_BASE}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.LLM_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: env.LLM_API_MODEL,
      temperature: 0,
      max_tokens: 600,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userPrompt(s) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { choices: { message: { content: string } }[] };
  const txt = j.choices[0]?.message?.content ?? "";
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("no JSON from model");
  return Verdict.parse(JSON.parse(m[0]));
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

async function reportRate(
  env: Env,
  fp: string,
  now: number,
): Promise<{ ok: boolean; remaining: number }> {
  const windowStart = now - REPORT_WINDOW_MS;
  const row = await env.DB.prepare("SELECT count(*) n FROM rate_log WHERE fp=? AND created_at>=?")
    .bind(fp, windowStart)
    .first<{ n: number }>();
  const count = row?.n ?? 0;
  return {
    ok: count < REPORT_MAX_PER_WINDOW,
    remaining: Math.max(0, REPORT_MAX_PER_WINDOW - count),
  };
}

async function recordReportRate(env: Env, fp: string, now: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO rate_log (fp, created_at) VALUES (?,?)").bind(fp, now),
    env.DB.prepare("DELETE FROM rate_log WHERE created_at<?").bind(now - REPORT_WINDOW_MS * 2),
  ]);
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
  // Included so the write path can tell the caller "I matched by uid even
  // though your handle is new" (used by the rename-detection log line).
  handle: string;
  x_user_id: string | null;
}

async function findAccount(
  env: Env,
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
        `SELECT rowid, verdict_label, confidence, reasons, model, signals_hash, status, handle, x_user_id
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
      `SELECT rowid, verdict_label, confidence, reasons, model, signals_hash, status, handle, x_user_id
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
  model?: string | null;
  status: string;
  source: string;
  signalsHash?: string | null;
  evidenceText?: string | null;
  now: number;
  publishedAt?: number | null;
  accountCreatedAt?: string | null;
  accountAgeDays?: number | null;
  followersCount?: number | null;
  followingCount?: number | null;
}

async function writeAccount(env: Env, w: AccountWrite): Promise<AccountRow | null> {
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
        w.model ?? null,
        w.source,
        w.signalsHash ?? null,
        w.evidenceText ?? null,
        w.now,
        w.status,
        w.publishedAt ?? null,
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

  await env.DB.prepare(
    `INSERT INTO accounts
       (x_user_id,handle,display_name,avatar_url,account_created_at,account_age_days,
        followers_count,following_count,verdict_label,confidence,reasons,model,
        status,source,signals_hash,evidence_text,first_seen,last_scored,published_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
      w.model ?? null,
      w.status,
      w.source,
      w.signalsHash ?? null,
      w.evidenceText ?? null,
      w.now,
      w.now,
      w.publishedAt ?? null,
    )
    .run();
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
  env: Env,
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
  env: Env,
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
            published_at=?
      WHERE rowid=?
        AND status IN ('auto_pending_review','auto_legit')
        AND EXISTS (SELECT 1 FROM accounts s
                     WHERE s.x_user_id IS NULL
                       AND s.status='human_confirmed'
                       AND lower(s.handle)=?)`,
  )
    .bind(Date.now(), keepRowid, handle)
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
  env: Env,
  s: Signals,
  handle: string,
  uid: string | null,
  reporter: Reporter,
  fp: string,
  now: number,
): Promise<boolean> {
  const res = await env.DB.prepare(
    `INSERT INTO reports
       (id,x_user_id,handle,reporter_fp,reporter_age_days,evidence,status,created_at)
     SELECT ?,?,?,?,?,?,'pending',?
      WHERE NOT EXISTS (
        SELECT 1 FROM reports
         WHERE lower(handle)=?
           AND reporter_fp=?
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
      fp,
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
  enabled: number; // SQLite stores as INTEGER
  note: string | null;
  created_at: number;
  hit_count: number;
  last_hit_at: number | null;
}

const RULE_CACHE_TTL_MS = 30_000;
let ruleCache: { at: number; rules: KeywordRule[] } | null = null;

async function getKeywordRules(env: Env): Promise<KeywordRule[]> {
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

function ruleMatchesText(rule: KeywordRule, s: Signals): boolean {
  const p = rule.pattern.toLowerCase();
  if (!p) return false;
  const has = (v: string | undefined | null) => !!v && v.toLowerCase().includes(p);
  switch (rule.field) {
    case "handle":
      return has(s.handle);
    case "display_name":
      return has(s.displayName);
    case "bio":
      return has(s.bio);
    case "tweet":
      return s.recentTweets.some((t) => has(t)) || has(s.triggeringComment);
    case "any":
      return (
        has(s.handle) ||
        has(s.displayName) ||
        has(s.bio) ||
        s.recentTweets.some((t) => has(t)) ||
        has(s.triggeringComment)
      );
    default:
      // Unknown field — do NOT silently widen to match every field. A typo'd
      // or future field name must not turn into an everything-matcher.
      return false;
  }
}

async function matchKeywordRules(env: Env, s: Signals): Promise<KeywordRule | null> {
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

const app = new Hono<{ Bindings: Env }>();
app.use("*", cors());

const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;

app.get("/v1/health", async (c) => {
  const r = await c.env.DB.prepare(
    "SELECT count(*) n FROM accounts WHERE status='human_confirmed'",
  ).first<{ n: number }>();
  return c.json({ ok: true, published: r?.n ?? 0 });
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
  const rows = await c.env.DB.prepare(
    `SELECT x_user_id, verdict_label, confidence FROM accounts
     WHERE status='human_confirmed' AND x_user_id IN (${ph})`,
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
  void caches.default.put(cacheKey, resp.clone());
  return resp;
});

app.post("/v1/classify", async (c) => {
  // Cost endpoint — GitHub identity required (when enforcement is on).
  const who = await requireReporter(c);
  if (!who) return c.json({ error: "github_login_required" }, 401);
  const parsed = Signals.parse(await c.req.json());
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
  if (prev && prev.signals_hash === h) {
    await updateAccountSignalSnapshot(c.env, prev.rowid, signalSnapshot(s));
    return c.json({
      cached: true,
      record: {
        verdict: {
          label: prev.verdict_label,
          confidence: prev.confidence,
          reasons: JSON.parse(prev.reasons || "[]"),
        },
        status: prev.status,
      },
    });
  }
  // Fast-path: keyword rules. Match before spending an LLM call. A hit routes
  // the account straight to the rule's destination status (default 'blacklist'
  // → 'human_confirmed' on the public list). The audit log records
  // actor='rule:<id>' so any hit is traceable.
  const ruleHit = await matchKeywordRules(c.env, s);
  if (ruleHit) {
    const now = Date.now();
    const status = statusForRuleAction(ruleHit.action);
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
      model: null,
      status,
      source: "auto_keyword",
      signalsHash: h,
      evidenceText: evidenceText(s),
      now,
      publishedAt: status === "human_confirmed" ? now : null,
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
        `matched "${ruleHit.pattern}" on ${ruleHit.field}`,
        now,
      ),
    ]);
    return c.json({
      cached: false,
      record: { verdict, status },
      matchedRule: { id: ruleHit.id, pattern: ruleHit.pattern, field: ruleHit.field },
    });
  }
  const verdict = await classify(c.env, s);
  const now = Date.now();
  // High-confidence legit verdicts are cached but kept out of the maintainer
  // queue. /admin/queue still only selects status='auto_pending_review', so
  // auto_legit rows are invisible there but the next /v1/classify hit still
  // gets a free cache return.
  const writeStatus =
    verdict.label === "legit" && verdict.confidence >= 0.85 ? "auto_legit" : "auto_pending_review";
  // Pick the most-relevant public X snippet that triggered this verdict so
  // the public list can be audited without retaining unrelated context.
  await writeAccount(c.env, {
    uid,
    handle: s.handle,
    displayName: s.displayName,
    avatarUrl: s.avatarUrl,
    verdictLabel: verdict.label,
    confidence: verdict.confidence,
    reasons: JSON.stringify(verdict.reasons),
    model: c.env.LLM_API_MODEL,
    status: writeStatus,
    source: "auto_scan",
    signalsHash: h,
    evidenceText: evidenceText(s),
    now,
    ...signalSnapshot(s),
  });
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
  const parsed = Signals.parse(await c.req.json());
  const s: Signals = { ...parsed, handle: normalizeHandle(parsed.handle) };
  if (viewerScopedIgnore(s)) {
    return c.json({ ok: true, status: "viewer_ignored", reporters: 0, auto: false, ignored: true });
  }
  const uid = s.userId ?? null;
  const now = Date.now();
  const fp = await reporterFingerprint(c.env, who.id);
  if (!fp) return c.json({ error: "report_salt_required" }, 503);

  const rate = await reportRate(c.env, fp, now);
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
  const insertedReport = await insertReportIfNew(c.env, s, s.handle, uid, who, fp, now);
  const alreadyReported = !insertedReport;
  if (insertedReport) {
    await recordReportRate(c.env, fp, now);
  }

  // Reporter count for auto-publish: only GH accounts older than
  // REPORTER_MIN_AGE_DAYS count. NULL age = legacy rows; treat them as
  // eligible so existing maintainer history is preserved.
  const cnt = await c.env.DB.prepare(
    `SELECT count(DISTINCT reporter_fp) n FROM reports
       WHERE lower(handle)=?
         AND (? IS NULL OR x_user_id IS NULL OR x_user_id=?)
         AND (reporter_age_days IS NULL OR reporter_age_days >= ?)`,
  )
    .bind(s.handle, uid, uid, REPORTER_MIN_AGE_DAYS)
    .first<{ n: number }>();
  const reporters = cnt?.n ?? (who.ageDays >= REPORTER_MIN_AGE_DAYS ? 1 : 0);
  if (alreadyReported && cur) {
    await updateAccountSignalSnapshot(c.env, cur.rowid, signalSnapshot(s));
    return c.json({ ok: true, status: cur.status, reporters, auto: false, duplicate: true });
  }

  // reuse a recent AI verdict if present, else classify now
  const prev = await findAccount(c.env, s.handle, uid);
  let vLabel: string;
  let vConf: number;
  if (prev) {
    vLabel = prev.verdict_label;
    vConf = prev.confidence;
  } else {
    const cl = await classify(c.env, s);
    vLabel = cl.label;
    vConf = cl.confidence;
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
  const status = "auto_pending_review";

  const written = await writeAccount(c.env, {
    uid,
    handle: s.handle,
    displayName: s.displayName,
    avatarUrl: s.avatarUrl,
    verdictLabel: vLabel,
    confidence: vConf,
    reasons: '["reported"]',
    model: prev ? null : c.env.LLM_API_MODEL,
    status,
    source,
    evidenceText: evidenceText(s),
    now,
    publishedAt: auto ? now : null,
    ...signalSnapshot(s),
  });
  const finalStatus = written?.status ?? status;
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
  handle: z.string().min(1),
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
  const handle = normalizeHandle(body.handle);
  const uid = body.userId ?? null;
  const cur = await findAccount(c.env, handle, uid);
  if (!cur) return c.json({ error: "not_found" }, 404);
  if (cur.status !== "human_confirmed") {
    return c.json({ ok: true, status: "not_listed", currentStatus: cur.status });
  }

  const now = Date.now();
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

// ---- Admin (守门员) ----
function admin(c: Ctx): boolean {
  const t = c.env.ADMIN_TOKEN;
  return !!t && c.req.raw.headers.get("x-admin-token") === t;
}

type AdminSort =
  | "time_desc"
  | "created_desc"
  | "created_asc"
  | "followers_desc"
  | "followers_asc"
  | "following_desc"
  | "following_asc";

const ADMIN_SORTS = new Set<AdminSort>([
  "time_desc",
  "created_desc",
  "created_asc",
  "followers_desc",
  "followers_asc",
  "following_desc",
  "following_asc",
]);

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

function encodeSortCursor(
  row: { sort_value: string | number | null; rid: number },
  time: number,
): string {
  return btoa(JSON.stringify([row.sort_value ?? null, time, row.rid]));
}

function decodeSortCursor(raw: string | null): SortCursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(atob(raw));
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

app.get("/v1/admin/queue", async (c) => {
  if (!admin(c)) return c.json({ error: "forbidden" }, 403);
  // Keyset pagination on last_scored DESC. Same dedup-by-handle CTE as before;
  // the cursor is the last_scored of the last row in the previous page, so the
  // next page strictly less-than. Total queue size is exposed via /v1/admin/stats
  // (computed against the same deduped set) so the UI can show "N more" hints
  // without re-counting client-side.
  //
  // Filters (all optional, all AND-combined, all applied INSIDE the dedup CTE
  // so search returns one canonical row per handle, not all variants):
  //   q             — multi-field fuzzy. Auto-routed: if it matches /^\d+$/
  //                   and `uid` is not set, treated as a uid prefix; otherwise
  //                   matched as a case-insensitive substring across handle /
  //                   display_name / evidence_text / reasons.
  //   uid           — x_user_id prefix match (so '2056413' surfaces the whole
  //                   batch-created cluster).
  //   handle        — case-insensitive substring of handle.
  //   evidence      — case-insensitive substring of evidence_text (the
  //                   triggering tweet); the strongest cluster signal.
  //   display_name  — substring of display_name.
  //   reasons       — substring of the raw JSON reasons text.
  //
  // SQLite LIKE is ASCII-case-insensitive by default; we explicitly lower()
  // both sides to keep the behavior consistent for handles, which may have
  // mixed case at write-time but live under idx_accounts_handle_norm.
  const sort = adminSort(c.req.query("sort"));
  const cursor = decodeSortCursor(c.req.query("before") || null);
  const cursorWhere = sortCursorWhere(sort, "last_scored", cursor);
  const limit = Math.min(200, Math.max(1, Number(c.req.query("limit")) || 100));
  const rawQ = (c.req.query("q") || "").trim() || null;
  let q: string | null = rawQ;
  let uid: string | null = (c.req.query("uid") || "").trim() || null;
  // Smart routing: a numeric `q` with no explicit uid filter is almost
  // certainly the user pasting in an X numeric id; treat it as a uid prefix
  // so the indexed lookup wins and we don't waste the search across text
  // fields where digit substrings would mostly be noise.
  if (q && /^\d+$/.test(q) && !uid) {
    uid = q;
    q = null;
  }
  const handle = (c.req.query("handle") || "").trim() || null;
  const evidence = (c.req.query("evidence") || "").trim() || null;
  const displayName = (c.req.query("display_name") || "").trim() || null;
  const reasons = (c.req.query("reasons") || "").trim() || null;

  const sortExpr = sortValueExpr("a", sort, "last_scored");
  const rows = await c.env.DB.prepare(
    `WITH ranked AS (
       SELECT a.rowid AS rid,
              a.*,
              ${sortExpr} AS sort_value,
              row_number() OVER (
                PARTITION BY lower(a.handle)
                ORDER BY CASE WHEN a.x_user_id IS NOT NULL THEN 0 ELSE 1 END,
                         a.last_scored DESC
              ) AS rn
         FROM accounts a
        WHERE a.status='auto_pending_review'
          AND (? IS NULL OR (
                 lower(a.handle) LIKE '%' || lower(?) || '%'
              OR lower(coalesce(a.display_name,'')) LIKE '%' || lower(?) || '%'
              OR lower(coalesce(a.evidence_text,'')) LIKE '%' || lower(?) || '%'
              OR lower(coalesce(a.reasons,'')) LIKE '%' || lower(?) || '%'
          ))
          AND (? IS NULL OR a.x_user_id LIKE ? || '%')
          AND (? IS NULL OR lower(a.handle) LIKE '%' || lower(?) || '%')
          AND (? IS NULL OR lower(coalesce(a.evidence_text,'')) LIKE '%' || lower(?) || '%')
          AND (? IS NULL OR lower(coalesce(a.display_name,'')) LIKE '%' || lower(?) || '%')
          AND (? IS NULL OR lower(coalesce(a.reasons,'')) LIKE '%' || lower(?) || '%')
     )
     SELECT a.rid, a.sort_value,
            a.x_user_id, a.handle, a.display_name, a.avatar_url, a.verdict_label, a.confidence,
            a.account_created_at, a.account_age_days, a.followers_count, a.following_count,
            a.reasons, a.evidence_text, a.last_scored,
            (SELECT count(DISTINCT reporter_fp) FROM reports r
              WHERE lower(r.handle)=lower(a.handle)
                AND (a.x_user_id IS NULL OR r.x_user_id IS NULL OR r.x_user_id=a.x_user_id)
            ) reporters
       FROM ranked a
      WHERE a.rn=1
        AND ${cursorWhere.sql}
      ORDER BY ${sortOrderSql(sort, "last_scored")} LIMIT ?`,
  )
    .bind(
      q,
      q,
      q,
      q,
      q,
      uid,
      uid,
      handle,
      handle,
      evidence,
      evidence,
      displayName,
      displayName,
      reasons,
      reasons,
      ...cursorWhere.binds,
      limit,
    )
    .all<{ rid: number; sort_value: string | number | null; last_scored: number }>();
  const rawList = rows.results ?? [];
  const list = rawList.map(({ rid: _rid, sort_value: _sortValue, ...row }) => row);
  const last = rawList[rawList.length - 1];
  return c.json({
    queue: list,
    nextBefore: rawList.length === limit && last ? encodeSortCursor(last, last.last_scored) : null,
    // Echo back the effective filter set so the UI can keep the inputs in
    // sync (especially after the smart `q` → `uid` rewrite above).
    appliedFilters: { q, uid, handle, evidence, display_name: displayName, reasons, sort },
  });
});

// True per-table counts. Cheap GROUP BY across the accounts table + the dedup
// view that backs /v1/admin/queue. Lets the admin panel tab chips show the
// real total instead of "however many we've loaded into memory".
app.get("/v1/admin/stats", async (c) => {
  if (!admin(c)) return c.json({ error: "forbidden" }, 403);
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
  env: Env,
  handle: string,
  xUserId: string | undefined,
  action: DecideAction,
  now: number,
): D1PreparedStatement[] {
  const status = statusForAction(action);
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
                  last_scored=?,
                  published_at=NULL
            WHERE lower(handle)=? AND x_user_id=?`,
        ).bind(now, handle, xUserId),
      );
    } else {
      stmts.push(
        env.DB.prepare(
          "UPDATE accounts SET status=?, published_at=? WHERE lower(handle)=? AND x_user_id=?",
        ).bind(status, action === "approve" ? now : null, handle, xUserId),
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
                  last_scored=?,
                  published_at=NULL
            WHERE lower(handle)=? AND x_user_id IS NULL`,
        ).bind(now, handle),
      );
    } else {
      stmts.push(
        env.DB.prepare(
          "UPDATE accounts SET status=?, published_at=? WHERE lower(handle)=? AND x_user_id IS NULL",
        ).bind(status, action === "approve" ? now : null, handle),
      );
    }
  }
  return stmts;
}

function reviewLogStmt(
  env: Env,
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

app.post("/v1/admin/decide", async (c) => {
  if (!admin(c)) return c.json({ error: "forbidden" }, 403);
  const body = (await c.req.json()) as {
    handle: string;
    xUserId?: string;
    action: DecideAction;
  };
  const handle = normalizeHandle(body.handle);
  const xUserId = body.xUserId;
  const action = body.action;
  const now = Date.now();
  const stmts = buildDecideStatements(c.env, handle, xUserId, action, now);
  stmts.push(reviewLogStmt(c.env, xUserId ?? null, handle, action, "panel", now));
  await c.env.DB.batch(stmts);
  return c.json({ ok: true, status: statusForAction(action) });
});

// Batch decide — accepts up to 100 items, single homogeneous action, runs as
// one D1 transaction. Either all rows commit or none do (D1 batch is atomic).
// Speeds up "拉黑这 80 条" from ~10s of sequential network round-trips to
// ~300ms in one shot, and removes the half-applied state risk on network
// hiccups mid-batch.
//
// Body: { action: "approve"|"reject"|"remove"|"whitelist",
//         items: [{ handle: string, xUserId?: string }, ...] }
const DecideBatchBody = z.object({
  action: z.enum(["approve", "reject", "remove", "whitelist"]),
  items: z
    .array(
      z.object({
        handle: z.string().min(1),
        xUserId: z.string().regex(/^\d+$/).optional(),
      }),
    )
    .min(1)
    .max(100),
});

app.post("/v1/admin/decide-batch", async (c) => {
  if (!admin(c)) return c.json({ error: "forbidden" }, 403);
  let body: z.infer<typeof DecideBatchBody>;
  try {
    body = DecideBatchBody.parse(await c.req.json());
  } catch (err) {
    return c.json({ error: "bad_request", detail: (err as Error).message }, 400);
  }
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  for (const it of body.items) {
    const h = normalizeHandle(it.handle);
    stmts.push(...buildDecideStatements(c.env, h, it.xUserId, body.action, now));
    stmts.push(reviewLogStmt(c.env, it.xUserId ?? null, h, body.action, "panel_batch", now));
  }
  await c.env.DB.batch(stmts);
  return c.json({
    ok: true,
    status: statusForAction(body.action),
    processed: body.items.length,
  });
});

// Batch whitelist-remove — drops a list of accounts from the whitelist back
// to 'rejected'. Same atomic-batch contract as decide-batch.
const WhitelistBatchBody = z.object({
  items: z
    .array(
      z.object({
        handle: z.string().min(1),
        xUserId: z.string().regex(/^\d+$/).optional(),
      }),
    )
    .min(1)
    .max(100),
});

app.delete("/v1/admin/whitelist-batch", async (c) => {
  if (!admin(c)) return c.json({ error: "forbidden" }, 403);
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
  await c.env.DB.batch(stmts);
  return c.json({ ok: true, processed: body.items.length });
});

// Paginated AI/decision audit trail. Keyset pagination on the id PK
// (DESC) — O(limit), no OFFSET scan, cheap on D1 at any size.
app.get("/v1/admin/log", async (c) => {
  if (!admin(c)) return c.json({ error: "forbidden" }, 403);
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

const KeywordRuleCreate = z.object({
  pattern: z.string().min(1).max(200),
  field: KeywordRuleField,
  action: KeywordRuleAction.default("blacklist"),
  verdict_label: KeywordVerdictLabel.default("spam"),
  note: z.string().max(400).optional(),
});

const KeywordRulePatch = z.object({
  pattern: z.string().min(1).max(200).optional(),
  field: KeywordRuleField.optional(),
  action: KeywordRuleAction.optional(),
  verdict_label: KeywordVerdictLabel.optional(),
  enabled: z.boolean().optional(),
  note: z.string().max(400).optional(),
});

app.get("/v1/admin/keyword-rules", async (c) => {
  if (!admin(c)) return c.json({ error: "forbidden" }, 403);
  const rows = await c.env.DB.prepare(
    "SELECT * FROM keyword_rules ORDER BY enabled DESC, hit_count DESC, id DESC",
  ).all<KeywordRule>();
  return c.json({ rules: rows.results ?? [] });
});

app.post("/v1/admin/keyword-rules", async (c) => {
  if (!admin(c)) return c.json({ error: "forbidden" }, 403);
  let body: z.infer<typeof KeywordRuleCreate>;
  try {
    body = KeywordRuleCreate.parse(await c.req.json());
  } catch (err) {
    return c.json({ error: "bad_request", detail: (err as Error).message }, 400);
  }
  const now = Date.now();
  const r = await c.env.DB.prepare(
    `INSERT INTO keyword_rules
       (pattern, field, action, verdict_label, enabled, note, created_at, hit_count)
     VALUES (?, ?, ?, ?, 1, ?, ?, 0)`,
  )
    .bind(body.pattern, body.field, body.action, body.verdict_label, body.note ?? null, now)
    .run();
  invalidateRuleCache();
  const id = r.meta.last_row_id;
  return c.json({ ok: true, id });
});

app.patch("/v1/admin/keyword-rules/:id", async (c) => {
  if (!admin(c)) return c.json({ error: "forbidden" }, 403);
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
  if (!admin(c)) return c.json({ error: "forbidden" }, 403);
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
  if (!admin(c)) return c.json({ error: "forbidden" }, 403);
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

// Apply all enabled rules to the existing pending queue. Sweeps
// status='auto_pending_review' only. For each row that matches any rule,
// moves it to that rule's destination status, records a review_log audit,
// and bumps the rule's hit_count. Returns a summary so the maintainer
// can see how much the new rule cleaned up.
app.post("/v1/admin/keyword-rules/apply-to-queue", async (c) => {
  if (!admin(c)) return c.json({ error: "forbidden" }, 403);
  const rules = await getKeywordRules(c.env);
  if (!rules.length) return c.json({ ok: true, matched: 0, perRule: [] });

  // Pull the entire queue in one go. At current scale (~600 rows) this is
  // ~50KB; well within Worker memory. Re-evaluate when queue grows >5K.
  const rows = await c.env.DB.prepare(
    `SELECT rowid, x_user_id, handle, display_name, evidence_text, reasons, status
       FROM accounts WHERE status='auto_pending_review'`,
  ).all<{
    rowid: number;
    x_user_id: string | null;
    handle: string;
    display_name: string | null;
    evidence_text: string | null;
    reasons: string | null;
    status: string;
  }>();
  const candidates = rows.results ?? [];
  const now = Date.now();

  // Per-rule hit count, returned to the UI so the maintainer can see which
  // rule did the heavy lifting.
  const perRule: Record<number, number> = {};
  for (const r of rules) perRule[r.id] = 0;

  // We can't reuse ruleMatchesText here because the row layout differs from
  // the Signals payload. Build a row-shaped matcher:
  function rowMatches(row: (typeof candidates)[number], rule: KeywordRule): boolean {
    const p = rule.pattern.toLowerCase();
    if (!p) return false;
    const has = (v: string | null) => !!v && v.toLowerCase().includes(p);
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
  for (const row of candidates) {
    const hit = rules.find((r) => rowMatches(row, r));
    if (!hit) continue;
    totalHit++;
    perRule[hit.id] = (perRule[hit.id] ?? 0) + 1;
    const status = statusForRuleAction(hit.action);
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
          `UPDATE accounts
              SET status=?, source='auto_keyword',
                  verdict_label=?, confidence=1.0, reasons=?,
                  last_scored=?, published_at=?
            WHERE rowid=?`,
        ).bind(
          status,
          hit.verdict_label,
          JSON.stringify([`matched keyword rule "${hit.pattern}" on ${hit.field}`]),
          now,
          status === "human_confirmed" ? now : null,
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
        `apply-to-queue matched "${hit.pattern}" on ${hit.field}`,
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
  xUserId: z.string().regex(/^\d+$/).optional(),
  displayName: z.string().max(120).default(""),
  avatarUrl: z.string().url().optional(),
  note: z.string().max(200).default(""),
});

app.post("/v1/admin/whitelist", async (c) => {
  if (!admin(c)) return c.json({ error: "forbidden" }, 403);
  const body = WhitelistAdd.parse(await c.req.json());
  const uid = body.xUserId ?? null;
  const now = Date.now();
  const reasons = JSON.stringify(["whitelisted by admin", body.note].filter(Boolean));
  // Upsert as whitelisted. If a row already exists (auto_pending_review,
  // auto_legit, rejected, removed, even human_confirmed) the admin's
  // explicit action wins.
  await c.env.DB.prepare(
    `INSERT INTO accounts
       (x_user_id,handle,display_name,avatar_url,verdict_label,confidence,reasons,
        status,source,signals_hash,first_seen,last_scored,published_at)
     VALUES (?,?,?,?,'legit',1.0,?, 'whitelisted','admin_whitelist', NULL, ?, ?, NULL)
     ON CONFLICT(x_user_id,handle) DO UPDATE SET
       status='whitelisted',
       source='admin_whitelist',
       verdict_label='legit',
       confidence=1.0,
       reasons=excluded.reasons,
       published_at=NULL,
       last_scored=excluded.last_scored,
       display_name=COALESCE(excluded.display_name, accounts.display_name),
       avatar_url=COALESCE(excluded.avatar_url, accounts.avatar_url)`,
  )
    .bind(uid, body.handle, body.displayName, body.avatarUrl ?? null, reasons, now, now)
    .run();
  await c.env.DB.prepare(
    "INSERT INTO review_log (x_user_id,handle,action,actor,note,at) VALUES (?,?,?,?,?,?)",
  )
    .bind(uid, body.handle, "whitelist_add", "admin", body.note || "panel", now)
    .run();
  return c.json({ ok: true, handle: body.handle, status: "whitelisted" });
});

app.delete("/v1/admin/whitelist", async (c) => {
  if (!admin(c)) return c.json({ error: "forbidden" }, 403);
  const handle = c.req.query("handle") ?? "";
  const xUserId = c.req.query("xUserId") || null;
  if (!handle) return c.json({ error: "handle_required" }, 400);
  const now = Date.now();
  // Drop back to 'rejected' rather than deleting the row — keeps the audit
  // trail intact and prevents the account from immediately re-entering the
  // public list if it gets re-reported.
  const r = await c.env.DB.prepare(
    `UPDATE accounts SET status='rejected', source='admin_whitelist', last_scored=?
      WHERE lower(handle)=? AND (x_user_id IS ? OR x_user_id=?) AND status='whitelisted'`,
  )
    .bind(now, handle, xUserId, xUserId)
    .run();
  await c.env.DB.prepare(
    "INSERT INTO review_log (x_user_id,handle,action,actor,note,at) VALUES (?,?,?,?,?,?)",
  )
    .bind(xUserId, handle, "whitelist_remove", "admin", "panel", now)
    .run();
  return c.json({ ok: true, changed: r.meta.changes ?? 0 });
});

app.get("/v1/admin/whitelist", async (c) => {
  if (!admin(c)) return c.json({ error: "forbidden" }, 403);
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

// Maintainer view of the public blacklist (status='human_confirmed'). Like
// /v1/list but admin-scoped (returns more columns + uncacheable) so the
// /admin panel can iterate it for "moved here by mistake" cleanup.
app.get("/v1/admin/blacklist", async (c) => {
  if (!admin(c)) return c.json({ error: "forbidden" }, 403);
  const sort = adminSort(c.req.query("sort"));
  const cursor = decodeSortCursor(c.req.query("before") || null);
  const cursorWhere = sortCursorWhere(sort, "published_at", cursor);
  const limit = Math.min(200, Math.max(1, Number(c.req.query("limit")) || 100));
  const q = (c.req.query("q") || "").trim().replace(/^@+/, "") || null;
  const sortExpr = sortValueExpr("a", sort, "published_at");
  const rows = await c.env.DB.prepare(
    `WITH base AS (
       SELECT a.rowid AS rid,
              a.*,
              ${sortExpr} AS sort_value
         FROM accounts a
        WHERE a.status='human_confirmed'
          AND (? IS NULL OR (
               lower(a.handle) LIKE '%' || lower(?) || '%'
            OR a.x_user_id LIKE ? || '%'
            OR lower(coalesce(a.display_name,'')) LIKE '%' || lower(?) || '%'
            OR lower(coalesce(a.evidence_text,'')) LIKE '%' || lower(?) || '%'
            OR lower(coalesce(a.reasons,'')) LIKE '%' || lower(?) || '%'
          ))
     )
     SELECT a.rid, a.sort_value,
            a.x_user_id, a.handle, a.display_name, a.avatar_url,
            a.account_created_at, a.account_age_days, a.followers_count, a.following_count,
            a.verdict_label, a.confidence, a.reasons, a.evidence_text, a.last_scored,
            a.published_at,
            a.last_decided_by, a.last_decided_at,
            (SELECT count(DISTINCT r.reporter_fp) FROM reports r
              WHERE r.handle=a.handle
                AND ifnull(r.x_user_id,'')=ifnull(a.x_user_id,'')) reporters
       FROM base a
      WHERE ${cursorWhere.sql}
      ORDER BY ${sortOrderSql(sort, "published_at")} LIMIT ?`,
  )
    .bind(q, q, q, q, q, q, ...cursorWhere.binds, limit)
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
      reasons: string;
      last_scored: number;
      published_at: number;
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
    appliedFilters: { q, sort },
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

  const obj = await c.env.ARTIFACTS.get(key);
  if (!obj) return c.json({ error: "not_found" }, 404);

  return new Response(obj.body, {
    headers: {
      "Content-Type": key.endsWith(".json") ? "application/json" : "application/octet-stream",
      "Cache-Control": "public, max-age=300, s-maxage=600",
    },
  });
});

app.get("/v1/list/meta", async (c) => {
  const cacheKey = "https://x.zuoluo.tv/v1/list/meta";
  const cached = await caches.default.match(cacheKey);
  if (cached) return cached;

  const now = Date.now();
  const r = await c.env.DB.prepare(
    `SELECT count(*) n,
            max(published_at) latest,
            sum(CASE WHEN published_at >= ? THEN 1 ELSE 0 END) AS day,
            sum(CASE WHEN published_at >= ? THEN 1 ELSE 0 END) AS week,
            (SELECT count(*) FROM accounts WHERE status='auto_pending_review') AS pending
       FROM accounts WHERE status='human_confirmed'`,
  )
    .bind(now - DAY_MS, now - 7 * DAY_MS)
    .first<{ n: number; latest: number | null; day: number; week: number; pending: number }>();

  const pub = await c.env.DB.prepare(
    "SELECT version, bloom_key, json_key, meta_key, count, published_at FROM publications ORDER BY published_at DESC LIMIT 1",
  ).first<{
    version: string;
    bloom_key: string;
    json_key: string;
    meta_key: string;
    count: number;
    published_at: number;
  }>();

  const payload = {
    count: r?.n ?? 0,
    day: r?.day ?? 0,
    week: r?.week ?? 0,
    pending: r?.pending ?? 0,
    generatedAt: pub?.published_at ?? r?.latest ?? null,
    version: pub?.version ?? `d1-${r?.n ?? 0}`,
    artifacts: pub
      ? {
          bloom: `/v1/artifacts/${pub.bloom_key}`,
          shards: `/v1/artifacts/${pub.json_key}`,
          meta: `/v1/artifacts/${pub.meta_key}`,
        }
      : null,
  };
  const resp = Response.json(payload, {
    headers: {
      "Cache-Control": "public, max-age=30, s-maxage=60",
    },
  });
  void caches.default.put(cacheKey, resp.clone());
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
  const rows = await c.env.DB.prepare(
    `WITH rep AS (
       SELECT handle, x_user_id, count(DISTINCT reporter_fp) AS n
         FROM reports WHERE reporter_fp IS NOT NULL
        GROUP BY handle, x_user_id
     )
     SELECT a.x_user_id, a.handle, a.display_name, a.avatar_url,
            a.verdict_label, a.confidence, a.reasons, a.evidence_text, a.published_at,
            coalesce(rep.n, 0) AS reporters
       FROM accounts a
       LEFT JOIN rep ON rep.handle = a.handle
                    AND ifnull(rep.x_user_id,'') = ifnull(a.x_user_id,'')
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
      reasons: string | null;
      evidence_text: string | null;
      published_at: number;
      reporters: number;
    }>();
  const list = rows.results ?? [];
  const nextBefore = list.length === limit ? list[list.length - 1].published_at : null;
  const latestAt = list[0]?.published_at ?? null;
  const etag = `W/"l${latestAt ?? 0}-n${list.length}-b${before ?? 0}-s${since ?? 0}"`;
  c.header("Cache-Control", "public, max-age=10, s-maxage=30");
  c.header("ETag", etag);
  if (c.req.header("if-none-match") === etag) return c.body(null, 304);
  return c.json({ list, nextBefore, latestAt });
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

// Product landing — dark-glass marketing page, no PII, no external deps.
app.get("/", (c) => {
  pageHeaders(c, 60);
  return c.html(landingHtml());
});

// Public spam board — latest 100 human_confirmed accounts (polls /v1/list).
app.get("/list", (c) => {
  pageHeaders(c, 30);
  return c.html(listHtml());
});

// Standalone admin console (separate from the consumer extension). The
// ADMIN_TOKEN is entered here by the maintainer and kept in localStorage —
// it never ships in the public extension. Page is noindex,nofollow.
app.get("/admin", (c) => {
  pageHeaders(c, 0);
  c.header("Cache-Control", "no-store");
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
async function mirrorToGitHub(env: Env): Promise<void> {
  const token = env.WHITELIST_SYNC_TOKEN;
  if (!token) return; // PAT not provided yet — mirror disabled.
  const repo = env.WHITELIST_SYNC_REPO ?? "foru17/make-x-great-again";

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
    const head = await fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        "user-agent": "mxga-worker",
        accept: "application/vnd.github+json",
      },
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
        authorization: `Bearer ${token}`,
        "user-agent": "mxga-worker",
        accept: "application/vnd.github+json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        message: commitMessage,
        content: b64utf8(nextBody),
        ...(sha ? { sha } : {}),
      }),
    });
    if (!put.ok) {
      console.warn(`mirror ${path} failed`, put.status, (await put.text()).slice(0, 200));
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
    `WITH rep AS (
       SELECT handle, x_user_id, count(DISTINCT reporter_fp) AS n
         FROM reports WHERE reporter_fp IS NOT NULL
        GROUP BY handle, x_user_id
     )
     SELECT a.x_user_id, a.handle, a.verdict_label, a.confidence,
            a.reasons, a.evidence_text, a.published_at,
            coalesce(rep.n, 0) AS reporters
       FROM accounts a
       LEFT JOIN rep ON rep.handle = a.handle
                    AND ifnull(rep.x_user_id,'') = ifnull(a.x_user_id,'')
      WHERE a.status='human_confirmed' AND a.published_at IS NOT NULL
      ORDER BY a.published_at DESC LIMIT ${BL_EXPORT_LIMIT}`,
  ).all<{
    x_user_id: string | null;
    handle: string;
    verdict_label: string;
    confidence: number;
    reasons: string | null;
    evidence_text: string | null;
    published_at: number;
    reporters: number;
  }>();

  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10); // YYYY-MM-DD
  const wlCount = wl.results?.length ?? 0;
  const blCount = bl.results?.length ?? 0;
  if (blCount >= BL_EXPORT_LIMIT) {
    // Don't silently cap: the published `count` would understate reality, which
    // is exactly the bug this guard prevents. Paginate or move to the Git Data
    // API when this fires.
    console.warn(
      `mirror: blacklist export hit the ${BL_EXPORT_LIMIT} cap — true total is higher; file is truncated.`,
    );
  }

  await publish(
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

  await publish(
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
        reasons: r.reasons ? JSON.parse(r.reasons) : [],
        evidence_text: r.evidence_text,
        reporters: r.reporters,
        published_at: r.published_at,
      })),
    },
    `data(blacklist): sync · ${blCount} total · ${today}`,
  );
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
function agent(c: Ctx): { ok: true; agentId: string } | { ok: false } {
  const t = c.env.AGENT_TOKEN;
  if (!t) return { ok: false };
  const auth = c.req.raw.headers.get("authorization") ?? "";
  const tok = auth.replace(/^Bearer\s+/i, "").trim();
  if (tok !== t) return { ok: false };
  // X-Agent-Id is a self-identifier (e.g. "hermes", "claude-luolei-laptop").
  // Used for audit + per-agent throttling later; doesn't grant authority.
  const id = (c.req.raw.headers.get("x-agent-id") ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_:-]{0,63}$/.test(id)) return { ok: false };
  return { ok: true, agentId: id };
}

// GET /v1/agent/queue — items the agent should look at next.
// Returns auto_pending_review rows where the agent either hasn't scored yet
// or scored against a stale signals_hash. Ordered last_scored DESC so fresh
// items get attention first. Capped to 100 per call to bound work.
app.get("/v1/agent/queue", async (c) => {
  const a = agent(c);
  if (!a.ok) return c.json({ error: "forbidden" }, 403);
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit")) || 30));
  const rows = await c.env.DB.prepare(
    `SELECT x_user_id, handle, display_name, avatar_url, verdict_label, confidence,
            account_created_at, account_age_days, followers_count, following_count,
            reasons, evidence_text, last_scored, signals_hash,
            agent_id, agent_at, agent_signals_hash, agent_attempts
       FROM accounts
      WHERE status = 'auto_pending_review'
        AND agent_attempts < 3
        AND (agent_at IS NULL OR agent_signals_hash IS NULL OR agent_signals_hash != signals_hash)
      ORDER BY last_scored DESC
      LIMIT ?`,
  )
    .bind(limit)
    .all();
  return c.json({
    agent_id: a.agentId,
    queue: rows.results ?? [],
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
  x_user_id: z.string().regex(/^\d+$/).optional(),
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
  const a = agent(c);
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
  const a = agent(c);
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
  if (!admin(c)) return c.json({ error: "forbidden" }, 403);
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
  x_user_id: z.string().regex(/^\d+$/).optional(),
  target: z.enum(["blacklist", "whitelist", "reject", "requeue"]),
});
const AgentPromoteBatch = z.object({
  target: z.enum(["blacklist", "whitelist", "reject", "requeue"]),
  items: z
    .array(
      z.object({
        handle: z.string().min(1),
        x_user_id: z.string().regex(/^\d+$/).optional(),
      }),
    )
    .min(1)
    .max(100),
});

function agentPromoteStmts(
  env: Env,
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
  if (!admin(c)) return c.json({ error: "forbidden" }, 403);
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
  await c.env.DB.batch(stmts);
  return c.json({ ok: true, target: body.target });
});

app.post("/v1/admin/agent-promote-batch", async (c) => {
  if (!admin(c)) return c.json({ error: "forbidden" }, 403);
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
  await c.env.DB.batch(stmts);
  return c.json({ ok: true, target: body.target, processed: body.items.length });
});

/** Admin-only manual trigger — handy after a batch of admin decisions when
 *  you don't want to wait for the next 6h cron tick. Same code path as the
 *  scheduled handler; cron just calls mirrorToGitHub directly. */
app.post("/v1/admin/sync-mirror", async (c) => {
  if (!admin(c)) return c.json({ error: "forbidden" }, 403);
  if (!c.env.WHITELIST_SYNC_TOKEN) {
    return c.json({ error: "mirror_disabled", reason: "WHITELIST_SYNC_TOKEN not set" }, 503);
  }
  await mirrorToGitHub(c.env);
  return c.json({ ok: true });
});

async function publishArtifacts(env: Env): Promise<void> {
  const rows = await env.DB.prepare(
    "SELECT x_user_id, handle, verdict_label, confidence, published_at FROM accounts WHERE status='human_confirmed' ORDER BY published_at DESC",
  ).all<{
    x_user_id: string | null;
    handle: string;
    verdict_label: string;
    confidence: number;
    published_at: number;
  }>();

  const accounts = rows.results ?? [];
  if (!accounts.length) return;

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
      };
      const primaryKey = a.x_user_id ?? `handle:${a.handle.toLowerCase()}`;
      entries[primaryKey] = entry;
      if (a.handle) entries[`handle:${a.handle.toLowerCase()}`] = entry;
      shards[shardKey].push(primaryKey);
    }
  }

  const version = `v${bloomB64.slice(0, 16)}-${accounts.length}`;
  const now = Date.now();
  const bloomKey = `bloom-${version}.b64`;
  const metaKey = `meta-${version}.json`;
  const jsonKey = `shards-${version}.json`;

  await env.ARTIFACTS.put(bloomKey, bloomB64, {
    httpMetadata: {
      contentType: "text/plain",
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

  await env.DB.prepare(
    "INSERT OR IGNORE INTO publications (version, bloom_key, json_key, meta_key, count, published_at) VALUES (?,?,?,?,?,?)",
  )
    .bind(version, bloomKey, jsonKey, metaKey, accounts.length, now)
    .run();
}

export default {
  fetch: app.fetch,
  scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(mirrorToGitHub(env).catch((e) => console.warn("mirror error", e)));
    ctx.waitUntil(publishArtifacts(env).catch((e) => console.warn("artifact publish error", e)));
  },
};
