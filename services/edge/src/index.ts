import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { ANALYTICS_CSP } from "./analytics";
import { adminHtml } from "./pages/admin";
import { landingHtml } from "./pages/landing";
import { listHtml } from "./pages/list";

interface Env {
  DB: D1Database;
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

const Signals = z.object({
  userId: z.string().optional(),
  handle: z.string().min(1),
  displayName: z.string().default(""),
  bio: z.string().default(""),
  recentTweets: z.array(z.string()).max(20).default([]),
  triggeringComment: z.string().optional(),
  threadTopic: z.string().optional(),
  accountAgeDays: z.number().optional(),
  followersCount: z.number().optional(),
  followingCount: z.number().optional(),
  hasDefaultAvatar: z.boolean().optional(),
  avatarUrl: z.string().optional(),
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

function userPrompt(s: Signals): string {
  const meta = [
    s.accountAgeDays !== undefined ? `accountAgeDays=${s.accountAgeDays}` : "",
    s.followersCount !== undefined ? `followers=${s.followersCount}` : "",
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

interface AccountRow {
  rowid: number;
  verdict_label: string;
  confidence: number;
  reasons: string | null;
  model: string | null;
  signals_hash: string | null;
  status: string;
}

async function findAccount(
  env: Env,
  handle: string,
  uid: string | null,
): Promise<AccountRow | null> {
  return (
    (await env.DB.prepare(
      `SELECT rowid, verdict_label, confidence, reasons, model, signals_hash, status
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
    await cleanupHandleOnlyAccountDuplicates(env, w.handle, prev.rowid);
    return findAccount(env, w.handle, w.uid);
  }

  await env.DB.prepare(
    `INSERT INTO accounts
       (x_user_id,handle,display_name,avatar_url,verdict_label,confidence,reasons,model,
        status,source,signals_hash,evidence_text,first_seen,last_scored,published_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      w.uid,
      w.handle,
      w.displayName,
      w.avatarUrl ?? null,
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
  return findAccount(env, w.handle, w.uid);
}

async function cleanupHandleOnlyAccountDuplicates(
  env: Env,
  handle: string,
  keepRowid: number,
): Promise<void> {
  await env.DB.prepare(
    `DELETE FROM accounts
      WHERE rowid<>?
        AND lower(handle)=?
        AND x_user_id IS NULL
        AND status IN ('auto_pending_review','auto_legit')`,
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
      reporter.id,
      reporter.ageDays,
      JSON.stringify(s).slice(0, 4000),
      now,
      handle,
      reporter.id,
      uid,
      uid,
    )
    .run();
  return (res.meta.changes ?? 0) > 0;
}

const app = new Hono<{ Bindings: Env }>();
app.use("*", cors());

app.get("/v1/health", async (c) => {
  const r = await c.env.DB.prepare(
    "SELECT count(*) n FROM accounts WHERE status='human_confirmed'",
  ).first<{ n: number }>();
  return c.json({ ok: true, published: r?.n ?? 0 });
});

// Public membership check — only human_confirmed (the public list).
app.get("/v1/check", async (c) => {
  const ids = (c.req.query("ids") ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 100);
  if (!ids.length) return c.json({ hits: {} });
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
  return c.json({ hits });
});

app.post("/v1/classify", async (c) => {
  // Cost endpoint — GitHub identity required (when enforcement is on).
  const who = await requireReporter(c);
  if (!who) return c.json({ error: "github_login_required" }, 401);
  const parsed = Signals.parse(await c.req.json());
  const s: Signals = { ...parsed, handle: normalizeHandle(parsed.handle) };
  const h = sigHash(s);
  const uid = s.userId ?? null;
  const prev = await findAccount(c.env, s.handle, uid);
  // Hard short-circuit for admin-curated whitelist — skip the LLM AND ignore
  // signals_hash drift. Whitelist beats heuristics.
  if (prev && prev.status === "whitelisted") {
    return c.json({
      cached: true,
      record: {
        verdict: { label: "legit", confidence: 1, reasons: ["whitelisted"] },
        status: "whitelisted",
      },
    });
  }
  if (prev && prev.signals_hash === h) {
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
  const uid = s.userId ?? null;
  const now = Date.now();

  // Whitelist short-circuit — if maintainer has explicitly whitelisted the
  // target, ignore the report entirely (don't even store it). Avoids letting
  // a coordinated brigade pollute the audit trail against a trusted account.
  const cur = await findAccount(c.env, s.handle, uid);
  if (cur?.status === "whitelisted") {
    return c.json({ ok: true, status: "whitelisted", reporters: 0, auto: false });
  }

  // one report per (target, reporter); always store, even for "young" GH
  // accounts — they just don't count toward AUTO_REPORTERS.
  const insertedReport = await insertReportIfNew(c.env, s, s.handle, uid, who, now);
  const alreadyReported = !insertedReport;

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
        who.id,
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

// ---- Admin (守门员) ----
function admin(c: Ctx): boolean {
  const t = c.env.ADMIN_TOKEN;
  return !!t && c.req.raw.headers.get("x-admin-token") === t;
}
app.get("/v1/admin/queue", async (c) => {
  if (!admin(c)) return c.json({ error: "forbidden" }, 403);
  // Keyset pagination on last_scored DESC. Same dedup-by-handle CTE as before;
  // the cursor is the last_scored of the last row in the previous page, so the
  // next page strictly less-than. Total queue size is exposed via /v1/admin/stats
  // (computed against the same deduped set) so the UI can show "N more" hints
  // without re-counting client-side.
  const before = Number(c.req.query("before")) || null;
  const limit = Math.min(200, Math.max(1, Number(c.req.query("limit")) || 100));
  const rows = await c.env.DB.prepare(
    `WITH ranked AS (
       SELECT a.*,
              row_number() OVER (
                PARTITION BY lower(a.handle)
                ORDER BY CASE WHEN a.x_user_id IS NOT NULL THEN 0 ELSE 1 END,
                         a.last_scored DESC
              ) AS rn
         FROM accounts a
        WHERE a.status='auto_pending_review'
     )
     SELECT a.x_user_id, a.handle, a.display_name, a.avatar_url, a.verdict_label, a.confidence,
            a.reasons, a.evidence_text, a.last_scored,
            (SELECT count(DISTINCT reporter_fp) FROM reports r
              WHERE lower(r.handle)=lower(a.handle)
                AND (a.x_user_id IS NULL OR r.x_user_id IS NULL OR r.x_user_id=a.x_user_id)
            ) reporters
       FROM ranked a
      WHERE a.rn=1
        AND (?1 IS NULL OR a.last_scored < ?1)
      ORDER BY a.last_scored DESC LIMIT ?2`,
  )
    .bind(before, limit)
    .all<{ last_scored: number }>();
  const list = rows.results ?? [];
  return c.json({
    queue: list,
    nextBefore: list.length === limit ? list[list.length - 1].last_scored : null,
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
  });
});
app.post("/v1/admin/decide", async (c) => {
  if (!admin(c)) return c.json({ error: "forbidden" }, 403);
  const body = (await c.req.json()) as {
    handle: string;
    xUserId?: string;
    action: "approve" | "reject" | "remove" | "whitelist";
  };
  const handle = normalizeHandle(body.handle);
  const xUserId = body.xUserId;
  const action = body.action;
  const status =
    action === "approve"
      ? "human_confirmed"
      : action === "remove"
        ? "removed"
        : action === "whitelist"
          ? "whitelisted"
          : "rejected";
  const now = Date.now();
  if (xUserId) {
    if (action === "whitelist") {
      await c.env.DB.prepare(
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
      )
        .bind(now, handle, xUserId)
        .run();
    } else {
      await c.env.DB.prepare(
        "UPDATE accounts SET status=?, published_at=? WHERE lower(handle)=? AND x_user_id=?",
      )
        .bind(status, action === "approve" ? now : null, handle, xUserId)
        .run();
    }
    await c.env.DB.prepare(
      `UPDATE accounts SET status=?, published_at=NULL
        WHERE lower(handle)=? AND x_user_id IS NULL AND status='auto_pending_review'`,
    )
      .bind(action === "approve" || action === "whitelist" ? "removed" : status, handle)
      .run();
  } else {
    if (action === "whitelist") {
      await c.env.DB.prepare(
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
      )
        .bind(now, handle)
        .run();
    } else {
      await c.env.DB.prepare(
        "UPDATE accounts SET status=?, published_at=? WHERE lower(handle)=? AND x_user_id IS NULL",
      )
        .bind(status, action === "approve" ? now : null, handle)
        .run();
    }
  }
  await c.env.DB.prepare(
    "INSERT INTO review_log (x_user_id,handle,action,actor,note,at) VALUES (?,?,?,?,?,?)",
  )
    .bind(xUserId ?? null, handle, action, "admin", "panel", now)
    .run();
  return c.json({ ok: true, status });
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
  const before = Number(c.req.query("before")) || null;
  const limit = Math.min(200, Math.max(1, Number(c.req.query("limit")) || 100));
  const rows = await c.env.DB.prepare(
    `SELECT x_user_id, handle, display_name, avatar_url, reasons, last_scored
       FROM accounts
      WHERE status='whitelisted'
        AND (?1 IS NULL OR last_scored < ?1)
      ORDER BY last_scored DESC LIMIT ?2`,
  )
    .bind(before, limit)
    .all<{
      x_user_id: string | null;
      handle: string;
      display_name: string | null;
      avatar_url: string | null;
      reasons: string;
      last_scored: number;
    }>();
  const list = rows.results ?? [];
  return c.json({
    list,
    nextBefore: list.length === limit ? list[list.length - 1].last_scored : null,
  });
});

// Maintainer view of the public blacklist (status='human_confirmed'). Like
// /v1/list but admin-scoped (returns more columns + uncacheable) so the
// /admin panel can iterate it for "moved here by mistake" cleanup.
app.get("/v1/admin/blacklist", async (c) => {
  if (!admin(c)) return c.json({ error: "forbidden" }, 403);
  const before = Number(c.req.query("before")) || null;
  const limit = Math.min(200, Math.max(1, Number(c.req.query("limit")) || 100));
  const rows = await c.env.DB.prepare(
    `SELECT a.x_user_id, a.handle, a.display_name, a.avatar_url,
            a.verdict_label, a.confidence, a.reasons, a.evidence_text, a.published_at,
            (SELECT count(DISTINCT r.reporter_fp) FROM reports r
              WHERE r.handle=a.handle
                AND ifnull(r.x_user_id,'')=ifnull(a.x_user_id,'')) reporters
       FROM accounts a
      WHERE a.status='human_confirmed'
        AND (?1 IS NULL OR a.published_at < ?1)
      ORDER BY a.published_at DESC LIMIT ?2`,
  )
    .bind(before, limit)
    .all<{
      x_user_id: string | null;
      handle: string;
      display_name: string | null;
      avatar_url: string | null;
      verdict_label: string;
      confidence: number;
      reasons: string;
      published_at: number;
      reporters: number;
    }>();
  const list = rows.results ?? [];
  return c.json({
    list,
    nextBefore: list.length === limit ? list[list.length - 1].published_at : null,
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

app.get("/v1/list/meta", async (c) => {
  const r = await c.env.DB.prepare(
    `SELECT count(*) n,
            max(published_at) latest,
            sum(CASE WHEN published_at >= ? THEN 1 ELSE 0 END) AS week,
            (SELECT count(*) FROM accounts WHERE status='auto_pending_review') AS pending
       FROM accounts WHERE status='human_confirmed'`,
  )
    .bind(Date.now() - 7 * 24 * 3600_000)
    .first<{ n: number; latest: number | null; week: number; pending: number }>();
  c.header("Cache-Control", "public, max-age=30, s-maxage=60");
  return c.json({
    count: r?.n ?? 0,
    week: r?.week ?? 0,
    pending: r?.pending ?? 0,
    generatedAt: r?.latest ?? null,
    version: `d1-${r?.n ?? 0}`,
  });
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

  /** UTF-8 safe base64 (btoa() only handles latin-1). */
  function b64utf8(s: string): string {
    return btoa(unescape(encodeURIComponent(s)));
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
      ORDER BY a.published_at DESC LIMIT 10000`,
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

export default {
  fetch: app.fetch,
  scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(mirrorToGitHub(env).catch((e) => console.warn("mirror error", e)));
  },
};
