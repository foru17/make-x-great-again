-- ============================================================================
-- 2026-05-26 — keyword_rules table  (Wave G)
-- ============================================================================
-- Maintainer-curated keyword rules. Matched against incoming Signals at
-- /v1/classify time BEFORE the LLM call: a hit short-circuits the verdict,
-- skips the LLM, and routes the account straight to the rule's action
-- (default: human_confirmed → public list).
--
-- The new path:
--   1. whitelist short-circuit (existing)
--   2. signalsHash cache short-circuit (existing)
--   3. matchKeywordRules → if hit, write status='human_confirmed' (NEW)
--   4. LLM call (existing fallback for the ambiguous middle)
--
-- Idempotent: re-running this file is a no-op (CREATE IF NOT EXISTS).
-- ============================================================================

CREATE TABLE IF NOT EXISTS keyword_rules (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern       TEXT NOT NULL,
  field         TEXT NOT NULL,
  action        TEXT NOT NULL DEFAULT 'blacklist',
  verdict_label TEXT NOT NULL DEFAULT 'spam',
  enabled       INTEGER NOT NULL DEFAULT 1,
  note          TEXT,
  created_at    INTEGER NOT NULL,
  hit_count     INTEGER NOT NULL DEFAULT 0,
  last_hit_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_keyword_rules_enabled ON keyword_rules(enabled);
