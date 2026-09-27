-- Handle-only auto-publish corroboration ledger.
--
-- Why: /v1/classify's AI auto-publish lane required a numeric x_user_id, but
-- the shipped extension reads uid/bio/followers/account-age exclusively from
-- X's React fiber, which an isolated-world content script cannot see. Measured
-- 2026-08-23: ~98% of live payloads are handle-only, so the lane published
-- once in 72h against ~1000 confident porn_bot verdicts/day. This table lets a
-- handle publish on independent corroboration instead of on a uid.
CREATE TABLE IF NOT EXISTS classify_witness (
  handle_norm TEXT NOT NULL,
  fp          TEXT NOT NULL,
  first_at    INTEGER NOT NULL,
  PRIMARY KEY (handle_norm, fp)
);
CREATE INDEX IF NOT EXISTS idx_classify_witness_first_at ON classify_witness(first_at);
