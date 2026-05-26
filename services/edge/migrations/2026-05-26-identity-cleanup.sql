-- ============================================================================
-- 2026-05-26 — identity cleanup (Wave A)
-- ============================================================================
-- Collapses three classes of duplicate / orphan rows that accumulated while
-- the extension was unable to extract X's numeric user id (the fiber walk
-- fails on some feed/reply contexts, so the same target ended up scored
-- multiple times — once handle-only, then later with a uid).
--
-- Surveyed counts on 2026-05-26 (run preview queries below to verify before
-- applying):
--   Class A — handle-only rows where a uid-bearing twin already exists ......  80
--     of which status=human_confirmed (visible dup on /list) ...............  61
--     of which status=auto_pending_review (phantom queue items) ............  10
--     of which status=auto_legit ...........................................   5
--     other (rejected/removed/whitelisted) .................................   4
--   Class B — pure-orphan handles with multiple null-uid rows .............. ~34
--   Class C — `reports` rows with NULL uid that have a uid-bearing twin ....   9
--
-- Status promotion: before collapsing duplicates, the strongest maintainer
-- signal in each handle cluster propagates to the canonical row. Priority:
--   whitelisted > human_confirmed > rejected > auto_legit > auto_pending_review
-- This salvages the lone prod case where a maintainer whitelisted a handle-
-- only row but the uid-bearing twin was still in `auto_legit` (luoleiorg).
--
-- Class A/B work is non-destructive: rows are set to status='removed' with a
-- `source='migration:...'` marker; full payload (verdict, reasons,
-- evidence_text, signals_hash, last_scored) stays for audit. review_log gets
-- a row per collapse including the original accounts.rowid, so the rollback
-- can pair each accounts row back to its specific prior-status entry.
--
-- Class C deletes the duplicate `reports` rows outright — they violate the
-- spirit of the UNIQUE INDEX on (handle, x_user_id, reporter_fp) but slipped
-- in because SQLite treats multiple NULLs as distinct. The uid-bearing twin
-- preserves the audit trail.
--
-- Roll-back: see migrations/2026-05-26-identity-cleanup.rollback.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- PREVIEW (run before applying; nothing here mutates state)
-- ----------------------------------------------------------------------------
-- SELECT a.x_user_id, a.handle, a.status, a.last_scored
--   FROM accounts a
--  WHERE a.x_user_id IS NULL
--    AND EXISTS (SELECT 1 FROM accounts b
--                 WHERE b.x_user_id IS NOT NULL
--                   AND lower(b.handle)=lower(a.handle));
--
-- WITH null_clusters AS (
--   SELECT lower(handle) AS h FROM accounts
--    WHERE x_user_id IS NULL
--    GROUP BY lower(handle) HAVING count(*) > 1
-- )
-- SELECT a.handle, a.status, a.last_scored
--   FROM accounts a
--  WHERE a.x_user_id IS NULL
--    AND lower(a.handle) IN (SELECT h FROM null_clusters)
--    AND NOT EXISTS (SELECT 1 FROM accounts b
--                     WHERE b.x_user_id IS NOT NULL
--                       AND lower(b.handle)=lower(a.handle))
--  ORDER BY lower(a.handle), a.last_scored DESC;
--
-- SELECT id, handle, reporter_fp, created_at FROM reports r
--  WHERE x_user_id IS NULL
--    AND EXISTS (SELECT 1 FROM reports s
--                 WHERE s.x_user_id IS NOT NULL
--                   AND lower(s.handle)=lower(r.handle)
--                   AND s.reporter_fp=r.reporter_fp);

-- ----------------------------------------------------------------------------
-- APPLY (atomic — D1 runs every statement in this file as one batch)
-- ----------------------------------------------------------------------------

-- ----- A0. Promote: uid-bearing twin inherits the strongest status that any
--      null-uid sibling holds, so the maintainer's manual whitelisted /
--      human_confirmed decision survives the collapse. Only PROMOTE — never
--      demote, never touch already-strongest-status rows.

-- A0a. Promote uid'd twin → 'whitelisted' if any null-uid sibling is whitelisted
INSERT INTO review_log (x_user_id, handle, action, actor, note, at)
SELECT a.x_user_id, a.handle, 'status_promoted', 'migration:2026-05-26',
       'inherited whitelisted status from handle-only sibling; rowid=' || a.rowid
         || '; prior_status=' || a.status || '; prior_source=' || a.source,
       strftime('%s','now') * 1000
  FROM accounts a
 WHERE a.x_user_id IS NOT NULL
   AND a.status NOT IN ('whitelisted')
   AND EXISTS (SELECT 1 FROM accounts s
                WHERE s.x_user_id IS NULL
                  AND s.status = 'whitelisted'
                  AND lower(s.handle) = lower(a.handle));

UPDATE accounts
   SET status = 'whitelisted',
       source = 'admin_whitelist',
       verdict_label = 'legit',
       confidence = 1.0,
       reasons = '["whitelisted by admin"]',
       signals_hash = NULL,
       published_at = NULL
 WHERE x_user_id IS NOT NULL
   AND status <> 'whitelisted'
   AND EXISTS (SELECT 1 FROM accounts s
                WHERE s.x_user_id IS NULL
                  AND s.status = 'whitelisted'
                  AND lower(s.handle) = lower(accounts.handle));

-- A0b. Promote uid'd twin → 'human_confirmed' if any null-uid sibling is
--      human_confirmed AND uid'd twin is in a weaker auto_* state. (Don't
--      downgrade rejected/whitelisted; don't re-promote already-confirmed.)
--      source is unchanged here, but we still record prior_source so the
--      rollback can use a single unified parser.
INSERT INTO review_log (x_user_id, handle, action, actor, note, at)
SELECT a.x_user_id, a.handle, 'status_promoted', 'migration:2026-05-26',
       'inherited human_confirmed status from handle-only sibling; rowid=' || a.rowid
         || '; prior_status=' || a.status || '; prior_source=' || a.source,
       strftime('%s','now') * 1000
  FROM accounts a
 WHERE a.x_user_id IS NOT NULL
   AND a.status IN ('auto_pending_review','auto_legit')
   AND EXISTS (SELECT 1 FROM accounts s
                WHERE s.x_user_id IS NULL
                  AND s.status = 'human_confirmed'
                  AND lower(s.handle) = lower(a.handle));

UPDATE accounts
   SET status = 'human_confirmed',
       published_at = strftime('%s','now') * 1000
 WHERE x_user_id IS NOT NULL
   AND status IN ('auto_pending_review','auto_legit')
   AND EXISTS (SELECT 1 FROM accounts s
                WHERE s.x_user_id IS NULL
                  AND s.status = 'human_confirmed'
                  AND lower(s.handle) = lower(accounts.handle));

-- ----- A1. Class A — handle-only rows whose canonical uid-bearing twin
--       already exists. Audit log first (capturing rowid + prior status),
--       then mark removed. last_scored / verdict / reasons stay untouched.
INSERT INTO review_log (x_user_id, handle, action, actor, note, at)
SELECT NULL,
       a.handle,
       'dedup_merged',
       'migration:2026-05-26',
       'collapsed handle-only row; rowid=' || a.rowid || '; canonical uid=' || (
         SELECT b.x_user_id FROM accounts b
          WHERE b.x_user_id IS NOT NULL
            AND lower(b.handle) = lower(a.handle)
          LIMIT 1
       ) || '; prior_status=' || a.status || '; prior_source=' || a.source,
       strftime('%s','now') * 1000
  FROM accounts a
 WHERE a.x_user_id IS NULL
   AND a.status <> 'removed'
   AND EXISTS (SELECT 1 FROM accounts b
                WHERE b.x_user_id IS NOT NULL
                  AND lower(b.handle) = lower(a.handle));

UPDATE accounts
   SET status = 'removed',
       source = 'migration:dedup_to_uid_twin',
       published_at = NULL
 WHERE x_user_id IS NULL
   AND status <> 'removed'
   AND EXISTS (SELECT 1 FROM accounts b
                WHERE b.x_user_id IS NOT NULL
                  AND lower(b.handle) = lower(accounts.handle));

-- ----- B. Class B — pure-orphan clusters: rank by (status_priority DESC,
--       last_scored DESC) and keep rn=1, mark the rest removed.
INSERT INTO review_log (x_user_id, handle, action, actor, note, at)
SELECT NULL,
       a.handle,
       'dedup_merged',
       'migration:2026-05-26',
       'pure-orphan cluster; rowid=' || a.rowid || '; prior_status=' || a.status || '; prior_source=' || a.source,
       strftime('%s','now') * 1000
  FROM accounts a
 WHERE a.x_user_id IS NULL
   AND a.status <> 'removed'
   AND a.rowid IN (
     WITH ranked AS (
       SELECT rowid,
              row_number() OVER (
                PARTITION BY lower(handle)
                ORDER BY CASE status
                           WHEN 'whitelisted'           THEN 0
                           WHEN 'human_confirmed'       THEN 1
                           WHEN 'rejected'              THEN 2
                           WHEN 'auto_legit'            THEN 3
                           WHEN 'auto_pending_review'   THEN 4
                           ELSE 5
                         END,
                         last_scored DESC,
                         rowid DESC
              ) AS rn
         FROM accounts
        WHERE x_user_id IS NULL
          AND status <> 'removed'
          AND NOT EXISTS (SELECT 1 FROM accounts b
                           WHERE b.x_user_id IS NOT NULL
                             AND lower(b.handle) = lower(accounts.handle))
     )
     SELECT rowid FROM ranked WHERE rn > 1
   );

UPDATE accounts
   SET status = 'removed',
       source = 'migration:null_dedup_keep_latest',
       published_at = NULL
 WHERE rowid IN (
   WITH ranked AS (
     SELECT rowid,
            row_number() OVER (
              PARTITION BY lower(handle)
              ORDER BY CASE status
                         WHEN 'whitelisted'           THEN 0
                         WHEN 'human_confirmed'       THEN 1
                         WHEN 'rejected'              THEN 2
                         WHEN 'auto_legit'            THEN 3
                         WHEN 'auto_pending_review'   THEN 4
                         ELSE 5
                       END,
                       last_scored DESC,
                       rowid DESC
            ) AS rn
       FROM accounts
      WHERE x_user_id IS NULL
        AND status <> 'removed'
        AND NOT EXISTS (SELECT 1 FROM accounts b
                         WHERE b.x_user_id IS NOT NULL
                           AND lower(b.handle) = lower(accounts.handle))
   )
   SELECT rowid FROM ranked WHERE rn > 1
 );

-- ----- C. Class C — `reports` with NULL uid that have a uid-bearing twin
--       from the same reporter. Keep the uid-bearing one, delete the orphan.
DELETE FROM reports
 WHERE x_user_id IS NULL
   AND EXISTS (SELECT 1 FROM reports s
                WHERE s.x_user_id IS NOT NULL
                  AND lower(s.handle) = lower(reports.handle)
                  AND s.reporter_fp = reports.reporter_fp);
