-- ============================================================================
-- 2026-08-02 — whitelist collateral + active NULL-id identity cleanup
-- ============================================================================
-- Fixes the data left by the former whitelistUpsert handle-wide UPDATE:
--   * a numeric-id whitelist add also promoted same-handle sibling rows;
--   * repeated handle-only adds could insert multiple active NULL-id rows.
--
-- Safety boundaries:
--   * non-null collateral is removed only when its last_scored timestamp,
--     admin_whitelist source, and handle match the exact audited whitelist
--     decision for a different canonical uid;
--   * different non-null uids on the blacklist are never collapsed;
--   * removed rows keep their payload and receive one review_log audit row;
--   * the final partial UNIQUE index covers active NULL-id rows only, so
--     removed audit history remains intact.
--
-- Apply order: deploy the whitelistUpsert fix first, then back up D1, preview
-- these counts, and apply this file. Applying the data migration while the old
-- Worker is live would allow the handle-wide UPDATE to recreate duplicates.
--
-- PREVIEW (read-only):
-- WITH collateral AS (
--   SELECT DISTINCT a.rowid
--     FROM accounts a
--     JOIN review_log rl
--       ON lower(rl.handle)=lower(a.handle)
--      AND rl.at=a.last_scored
--      AND rl.action IN ('whitelist_add','whitelist_request_approve')
--      AND rl.x_user_id IS NOT NULL
--     JOIN accounts kept
--       ON kept.x_user_id=rl.x_user_id
--      AND lower(kept.handle)=lower(a.handle)
--      AND kept.status='whitelisted'
--    WHERE a.status='whitelisted'
--      AND a.source='admin_whitelist'
--      AND (a.x_user_id IS NULL OR a.x_user_id<>rl.x_user_id)
-- ) SELECT count(*) AS exact_whitelist_collateral_rows FROM collateral;
--
-- SELECT count(*) AS active_null_rows_with_uid_twin FROM accounts a
--  WHERE a.x_user_id IS NULL AND a.status<>'removed'
--    AND EXISTS (SELECT 1 FROM accounts b WHERE b.x_user_id IS NOT NULL
--                 AND lower(b.handle)=lower(a.handle));
--
-- WITH ranked AS (
--   SELECT rowid, row_number() OVER (
--            PARTITION BY lower(handle) ORDER BY last_scored DESC, rowid DESC
--          ) AS rn
--     FROM accounts a
--    WHERE x_user_id IS NULL AND status<>'removed'
--      AND NOT EXISTS (SELECT 1 FROM accounts b WHERE b.x_user_id IS NOT NULL
--                       AND lower(b.handle)=lower(a.handle))
-- ) SELECT count(*) AS excess_pure_null_rows FROM ranked WHERE rn>1;
-- ============================================================================

-- A. Rows provably promoted as collateral by one audited numeric-id whitelist
--    add. Keep the uid named by the audit entry; remove only the other rows
--    stamped by that same operation.
INSERT INTO review_log (x_user_id, handle, action, actor, note, at)
SELECT a.x_user_id,
       a.handle,
       'dedup_merged',
       'migration:2026-08-02',
       'whitelist-add collateral; rowid=' || a.rowid
         || '; canonical_uid=' || (
              SELECT rl.x_user_id
                FROM review_log rl
                JOIN accounts kept
                  ON kept.x_user_id=rl.x_user_id
                 AND lower(kept.handle)=lower(a.handle)
                 AND kept.status='whitelisted'
               WHERE lower(rl.handle)=lower(a.handle)
                 AND rl.at=a.last_scored
                 AND rl.action IN ('whitelist_add','whitelist_request_approve')
                 AND rl.x_user_id IS NOT NULL
                 AND (a.x_user_id IS NULL OR a.x_user_id<>rl.x_user_id)
               ORDER BY rl.id DESC LIMIT 1
            )
         || '; prior_published_at=' || coalesce(CAST(a.published_at AS TEXT), 'NULL')
         || '; prior_status=' || a.status || '; prior_source=' || a.source,
       strftime('%s','now') * 1000
  FROM accounts a
 WHERE a.status='whitelisted'
   AND a.source='admin_whitelist'
   AND EXISTS (
     SELECT 1
       FROM review_log rl
       JOIN accounts kept
         ON kept.x_user_id=rl.x_user_id
        AND lower(kept.handle)=lower(a.handle)
        AND kept.status='whitelisted'
      WHERE lower(rl.handle)=lower(a.handle)
        AND rl.at=a.last_scored
        AND rl.action IN ('whitelist_add','whitelist_request_approve')
        AND rl.x_user_id IS NOT NULL
        AND (a.x_user_id IS NULL OR a.x_user_id<>rl.x_user_id)
   );

UPDATE accounts
   SET status='removed',
       source='migration:whitelist_add_collateral',
       published_at=NULL
 WHERE rowid IN (
   SELECT DISTINCT a.rowid
     FROM accounts a
     JOIN review_log rl
       ON lower(rl.handle)=lower(a.handle)
      AND rl.at=a.last_scored
      AND rl.action IN ('whitelist_add','whitelist_request_approve')
      AND rl.x_user_id IS NOT NULL
     JOIN accounts kept
       ON kept.x_user_id=rl.x_user_id
      AND lower(kept.handle)=lower(a.handle)
      AND kept.status='whitelisted'
    WHERE a.status='whitelisted'
      AND a.source='admin_whitelist'
      AND (a.x_user_id IS NULL OR a.x_user_id<>rl.x_user_id)
 );

-- B. Any remaining active handle-only row with an immutable-id twin is the
--    non-canonical sibling. This also covers legacy blacklist NULL-id rows
--    without touching any different non-null ids.
INSERT INTO review_log (x_user_id, handle, action, actor, note, at)
SELECT NULL,
       a.handle,
       'dedup_merged',
       'migration:2026-08-02',
       'active null-id row with uid twin; rowid=' || a.rowid
         || '; canonical_uid=' || (
              SELECT b.x_user_id FROM accounts b
               WHERE b.x_user_id IS NOT NULL
                 AND lower(b.handle)=lower(a.handle)
               ORDER BY b.last_scored DESC, b.rowid DESC LIMIT 1
            )
         || '; prior_published_at=' || coalesce(CAST(a.published_at AS TEXT), 'NULL')
         || '; prior_status=' || a.status || '; prior_source=' || a.source,
       strftime('%s','now') * 1000
  FROM accounts a
 WHERE a.x_user_id IS NULL
   AND a.status<>'removed'
   AND EXISTS (SELECT 1 FROM accounts b
                WHERE b.x_user_id IS NOT NULL
                  AND lower(b.handle)=lower(a.handle));

UPDATE accounts
   SET status='removed',
       source='migration:null_to_uid_twin',
       published_at=NULL
 WHERE x_user_id IS NULL
   AND status<>'removed'
   AND EXISTS (SELECT 1 FROM accounts b
                WHERE b.x_user_id IS NOT NULL
                  AND lower(b.handle)=lower(accounts.handle));

-- C. For handles that have only NULL ids, keep the strongest/freshest active
--    row and preserve every other row as removed audit history.
INSERT INTO review_log (x_user_id, handle, action, actor, note, at)
SELECT NULL,
       a.handle,
       'dedup_merged',
       'migration:2026-08-02',
       'duplicate active null-id row; rowid=' || a.rowid
         || '; prior_published_at=' || coalesce(CAST(a.published_at AS TEXT), 'NULL')
         || '; prior_status=' || a.status || '; prior_source=' || a.source,
       strftime('%s','now') * 1000
  FROM accounts a
 WHERE a.rowid IN (
   WITH ranked AS (
     SELECT rowid,
            row_number() OVER (
              PARTITION BY lower(handle)
              ORDER BY CASE status
                         WHEN 'whitelisted'         THEN 0
                         WHEN 'human_confirmed'     THEN 1
                         WHEN 'rejected'            THEN 2
                         WHEN 'agent_whitelist'     THEN 3
                         WHEN 'agent_blacklist'     THEN 4
                         WHEN 'agent_pending'       THEN 5
                         WHEN 'auto_legit'          THEN 6
                         WHEN 'auto_pending_review' THEN 7
                         ELSE 8
                       END,
                       last_scored DESC,
                       rowid DESC
            ) AS rn
       FROM accounts
      WHERE x_user_id IS NULL
        AND status<>'removed'
        AND NOT EXISTS (SELECT 1 FROM accounts b
                         WHERE b.x_user_id IS NOT NULL
                           AND lower(b.handle)=lower(accounts.handle))
   )
   SELECT rowid FROM ranked WHERE rn>1
 );

UPDATE accounts
   SET status='removed',
       source='migration:null_active_dedup',
       published_at=NULL
 WHERE rowid IN (
   WITH ranked AS (
     SELECT rowid,
            row_number() OVER (
              PARTITION BY lower(handle)
              ORDER BY CASE status
                         WHEN 'whitelisted'         THEN 0
                         WHEN 'human_confirmed'     THEN 1
                         WHEN 'rejected'            THEN 2
                         WHEN 'agent_whitelist'     THEN 3
                         WHEN 'agent_blacklist'     THEN 4
                         WHEN 'agent_pending'       THEN 5
                         WHEN 'auto_legit'          THEN 6
                         WHEN 'auto_pending_review' THEN 7
                         ELSE 8
                       END,
                       last_scored DESC,
                       rowid DESC
            ) AS rn
       FROM accounts
      WHERE x_user_id IS NULL
        AND status<>'removed'
        AND NOT EXISTS (SELECT 1 FROM accounts b
                         WHERE b.x_user_id IS NOT NULL
                           AND lower(b.handle)=lower(accounts.handle))
   )
   SELECT rowid FROM ranked WHERE rn>1
 );

-- D. Physical guard for concurrent handle-only writes. Removed rows are
--    intentionally outside the index so audit history may share a handle.
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_active_null_handle_uq
  ON accounts(lower(handle))
  WHERE x_user_id IS NULL AND status<>'removed';
