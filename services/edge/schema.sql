-- D1 curation store. Source of truth; published artifact derives from this.
-- Governance: AI verdict never auto-public; status flips to human_confirmed
-- only on a user block/report (the human-confirm signal).

CREATE TABLE IF NOT EXISTS accounts (
  x_user_id     TEXT,                       -- numeric id (immutable key); NULL if handle-only
  handle        TEXT,
  display_name  TEXT,
  avatar_url    TEXT,
  verdict_label TEXT NOT NULL,              -- spam|porn_bot|likely_spam|uncertain|legit
  confidence    REAL NOT NULL,
  reasons       TEXT,                       -- json array
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
  -- D1/SQLite allows multiple NULL values in composite keys, so the Worker
  -- write path also does normalized handle-level dedupe for handle-only rows.
  PRIMARY KEY (x_user_id, handle)
);
CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status);
CREATE INDEX IF NOT EXISTS idx_accounts_uid ON accounts(x_user_id);
CREATE INDEX IF NOT EXISTS idx_accounts_handle_norm ON accounts(lower(handle));
-- Partial UNIQUE: prevent the same X numeric uid from ever splitting across
-- two rows. NULL is excluded so handle-only rows still coexist while we
-- wait for the fiber walk to land a uid. Paired with findAccount's by-uid
-- pass — writeAccount UPDATEs the canonical row instead of INSERTing a
-- duplicate when the user renames their handle.
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_uid_uq
  ON accounts(x_user_id) WHERE x_user_id IS NOT NULL;

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
  enabled       INTEGER NOT NULL DEFAULT 1,
  note          TEXT,                          -- maintainer free-text reminder
  created_at    INTEGER NOT NULL,
  hit_count     INTEGER NOT NULL DEFAULT 0,    -- bumped on every match
  last_hit_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_keyword_rules_enabled ON keyword_rules(enabled);
