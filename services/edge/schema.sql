-- D1 curation store. Source of truth; published artifact derives from this.
-- Governance: AI verdict never auto-public; status flips to human_confirmed
-- only on a user block/report (the human-confirm signal).

CREATE TABLE IF NOT EXISTS accounts (
  x_user_id     TEXT,                       -- numeric id (immutable key); NULL if handle-only
  handle        TEXT,
  display_name  TEXT,
  avatar_url    TEXT,
  account_created_at TEXT,                 -- X account created_at string/ISO when observed
  account_age_days INTEGER,                 -- age at last observed signal snapshot
  followers_count INTEGER,
  following_count INTEGER,
  verdict_label TEXT NOT NULL,              -- spam|porn_bot|likely_spam|uncertain|legit
  confidence    REAL NOT NULL,
  reasons       TEXT,                       -- json array
  category      TEXT,                       -- porn|crypto|gambling|resource|marketing|other
                                            -- canonical spam category; NULL = uncategorized
                                            -- (pre-backfill legacy). Drives the client's
                                            -- per-category action policy.
  model         TEXT,
  status        TEXT NOT NULL DEFAULT 'auto_pending_review',
                                            -- auto_pending_review | human_confirmed | rejected
                                            -- | removed | auto_legit | whitelisted
  source        TEXT NOT NULL DEFAULT 'auto_scan', -- auto_scan|report|block|import|admin_whitelist
  signals_hash  TEXT,
  evidence_text TEXT,                       -- ≤240 chars of the public X content
                                            -- that triggered the verdict (the
                                            -- triggering reply / first recent
                                            -- tweet / bio). Public audit fuel.
  first_seen    INTEGER NOT NULL,
  last_scored   INTEGER NOT NULL,
  published_at  INTEGER,
  published_tier TEXT,                      -- who published a human_confirmed row:
                                            -- human|ai|rule|mention. Clients may only
                                            -- auto-act (mute/block) on 'human'.
  removed_at    INTEGER,                   -- set on upheld appeal / removal (SPEC-T1 §3.1)
  -- D1/SQLite allows multiple NULL values in composite keys, so the Worker
  -- write path also does normalized handle-level dedupe for handle-only rows.
  PRIMARY KEY (x_user_id, handle)
);
CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status);
CREATE INDEX IF NOT EXISTS idx_accounts_uid ON accounts(x_user_id);
CREATE INDEX IF NOT EXISTS idx_accounts_handle_norm ON accounts(lower(handle));
CREATE INDEX IF NOT EXISTS idx_accounts_status_published_at ON accounts(status, published_at);
CREATE INDEX IF NOT EXISTS idx_accounts_status_last_scored ON accounts(status, last_scored);
CREATE INDEX IF NOT EXISTS idx_accounts_status_confidence ON accounts(status, confidence);
CREATE INDEX IF NOT EXISTS idx_accounts_status_created_at ON accounts(status, account_created_at);
CREATE INDEX IF NOT EXISTS idx_accounts_status_followers ON accounts(status, followers_count);
CREATE INDEX IF NOT EXISTS idx_accounts_status_following ON accounts(status, following_count);
-- Partial UNIQUE: prevent the same X numeric uid from ever splitting across
-- two rows. NULL is excluded so handle-only rows still coexist while we
-- wait for the fiber walk to land a uid. Paired with findAccount's by-uid
-- pass — writeAccount UPDATEs the canonical row instead of INSERTing a
-- duplicate when the user renames their handle.
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_uid_uq
  ON accounts(x_user_id) WHERE x_user_id IS NOT NULL;
-- SQLite treats NULL values as distinct inside the composite PRIMARY KEY.
-- Keep at most one active handle-only identity while preserving removed audit
-- rows; the Worker reuses/collapses that canonical row before every write.
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_active_null_handle_uq
  ON accounts(lower(handle))
  WHERE x_user_id IS NULL AND status <> 'removed';

CREATE TABLE IF NOT EXISTS reports (
  id                  TEXT PRIMARY KEY,     -- uuid
  x_user_id           TEXT,
  handle              TEXT,
  reporter_fp         TEXT,                 -- salted hash, anti-abuse, NO PII
  reporter_age_days   INTEGER,              -- GH account age at report time;
                                            -- NULL = legacy (treated as eligible)
  evidence            TEXT,                 -- json
  status              TEXT NOT NULL DEFAULT 'pending',
  created_at          INTEGER NOT NULL
);

-- Legacy exact-key guard. Because x_user_id can be NULL, the Worker also
-- performs a normalized pre-check before inserting reports.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique
  ON reports(handle, x_user_id, reporter_fp);
CREATE INDEX IF NOT EXISTS idx_reports_handle_reporter_norm
  ON reports(lower(handle), reporter_fp);
-- Partial index for the auto-promote eligibility query.
CREATE INDEX IF NOT EXISTS idx_reports_eligible
  ON reports(handle, x_user_id)
  WHERE reporter_age_days IS NULL OR reporter_age_days >= 90;

CREATE TABLE IF NOT EXISTS review_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  x_user_id  TEXT,
  handle     TEXT,
  action     TEXT NOT NULL,
  actor      TEXT NOT NULL,                 -- system|user|human|rule:<id>
  note       TEXT,
  at         INTEGER NOT NULL
);
-- /v1/appeal dedupe filters (action, at); without this it full-scans review_log.
CREATE INDEX IF NOT EXISTS idx_review_log_action_at ON review_log(action, at);

-- Maintainer-curated keyword rules. Matched against incoming Signals at
-- /v1/classify time BEFORE the LLM call: a hit short-circuits the verdict,
-- skips the LLM, and routes the account straight to the rule's action
-- (default: human_confirmed → public list). The fast path for obvious
-- patterns (porn-bot template phrases, ad keywords) — keeps the LLM budget
-- focused on the ambiguous cases.
CREATE TABLE IF NOT EXISTS keyword_rules (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern       TEXT NOT NULL,                 -- literal substring, case-insensitive
  field         TEXT NOT NULL,                 -- handle|display_name|bio|tweet|any
  action        TEXT NOT NULL DEFAULT 'blacklist', -- blacklist|whitelist|reject
  verdict_label TEXT NOT NULL DEFAULT 'spam',  -- the label written into accounts on hit
  category      TEXT,                          -- category stamped onto accounts on hit;
                                               -- NULL = derive from verdict_label/pattern
  enabled       INTEGER NOT NULL DEFAULT 1,
  note          TEXT,                          -- maintainer free-text reminder
  created_at    INTEGER NOT NULL,
  hit_count     INTEGER NOT NULL DEFAULT 0,    -- bumped on every match
  last_hit_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_keyword_rules_enabled ON keyword_rules(enabled);

-- Publications: D1 -> R2 publish ledger. Each row represents one successful
-- artifact generation (bloom + sharded JSON + meta.json).
CREATE TABLE IF NOT EXISTS publications (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  version       TEXT NOT NULL UNIQUE,       -- "v<sha256-prefix>-<count>"
  bloom_key     TEXT NOT NULL,              -- R2 object key for bloom filter
  json_key      TEXT NOT NULL,              -- R2 object key for shard JSON
  meta_key      TEXT NOT NULL,              -- R2 object key for meta.json
  count         INTEGER NOT NULL,           -- # of human_confirmed accounts
  pending_count INTEGER,                     -- # of auto_pending_review at publish
                                             -- time; lets /v1/list/meta skip a
                                             -- full-partition scan per request
  lite_key      TEXT,                        -- R2 key of the compact lite artifact
                                             -- (schema v2: id/handle/label+category)
  published_at  INTEGER NOT NULL            -- epoch ms
);
CREATE INDEX IF NOT EXISTS idx_publications_version ON publications(version);

-- Report rate limiting log, keyed by reporter fingerprint.
CREATE TABLE IF NOT EXISTS rate_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  fp         TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_log_fp_time ON rate_log(fp, created_at);
-- The periodic `DELETE FROM rate_log WHERE created_at<?` needs created_at as
-- the leading column (idx_rate_log_fp_time leads with fp) or it full-scans.
CREATE INDEX IF NOT EXISTS idx_rate_log_created_at ON rate_log(created_at);

-- Self-service whitelist applications. Extension users apply with their
-- GitHub identity (same HMAC reporter fingerprint as reports); a maintainer
-- approves/rejects from the admin console.
CREATE TABLE IF NOT EXISTS whitelist_requests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  x_user_id   TEXT,                          -- X numeric id when the applicant supplied it
  handle      TEXT NOT NULL,                 -- the X handle the applicant wants whitelisted
  reporter_fp TEXT NOT NULL,                 -- salted HMAC fingerprint, NO PII
  gh_age_days INTEGER,                       -- GH account age at application time
  note        TEXT,                          -- applicant free-text (<=200 chars)
  status      TEXT NOT NULL DEFAULT 'pending', -- pending|approved|rejected
  created_at  INTEGER NOT NULL,
  decided_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_whitelist_requests_status
  ON whitelist_requests(status);
CREATE INDEX IF NOT EXISTS idx_whitelist_requests_fp_status
  ON whitelist_requests(reporter_fp, status);

-- Reporter bans: admin-maintained anti-abuse blocklist keyed by the same
-- HMAC reporter fingerprint used by reports/rate_log. Temporary bans expire
-- automatically when expires_at is in the past; NULL = permanent.
CREATE TABLE IF NOT EXISTS reporter_bans (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_fp   TEXT NOT NULL,
  reason        TEXT,
  created_by    TEXT NOT NULL DEFAULT 'admin',
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_reporter_bans_fp_active
  ON reporter_bans(reporter_fp, expires_at);
