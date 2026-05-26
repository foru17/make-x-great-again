-- ============================================================================
-- Roll back the 2026-05-26 identity cleanup
-- ============================================================================
-- Reverses the data changes from 2026-05-26-identity-cleanup.sql by pairing
-- each affected accounts row to its specific review_log entry via the
-- `rowid=<n>;` token embedded in the audit note. We match via instr() rather
-- than dynamic LIKE because SQLite refuses LIKE patterns that concat column
-- values ("LIKE or GLOB pattern too complex" SQLITE_ERROR).
--
-- review_log note layout (terminal segments, parsed by substr/instr):
--   '...; prior_status=<status>; prior_source=<source>'
-- prior_status is the substring between 'prior_status=' and '; prior_source='.
-- prior_source is the substring after 'prior_source=' to end-of-note.
--
-- Phases (mirror-reversed from the forward migration):
--   Phase 1 — undo Class B (pure-orphan dedup)
--   Phase 2 — undo Class A (handle-only collapse to uid-twin)
--   Phase 3 — undo A0b (human_confirmed promotion of uid'd twin)
--   Phase 4 — undo A0a (whitelisted promotion of uid'd twin) — LOSSY
--
-- Limitations:
--   * Class C (reports DELETEs) are NOT reversible from this migration alone.
--   * A0a (whitelisted promotion) overwrote the uid'd row's verdict_label,
--     confidence, reasons, signals_hash with whitelist defaults. Rollback
--     restores status + source only — original verdict / reasons stay lost.
--   * Once normal traffic resumes after the forward migration, ongoing scans
--     will mutate `last_scored` and possibly statuses, making rollback
--     increasingly imprecise. Clean rollback window: minutes, not days.
-- ============================================================================

-- ----- Phase 1 — undo Class B (pure-orphan dedup)
UPDATE accounts
   SET status = (
         SELECT substr(rl.note,
                       instr(rl.note, 'prior_status=') + 13,
                       instr(rl.note, '; prior_source=') - instr(rl.note, 'prior_status=') - 13)
           FROM review_log rl
          WHERE rl.action = 'dedup_merged'
            AND rl.actor = 'migration:2026-05-26'
            AND instr(rl.note, 'pure-orphan cluster; rowid=' || accounts.rowid || ';') > 0
          ORDER BY rl.at DESC LIMIT 1
       ),
       source = (
         SELECT substr(rl.note, instr(rl.note, 'prior_source=') + 13)
           FROM review_log rl
          WHERE rl.action = 'dedup_merged'
            AND rl.actor = 'migration:2026-05-26'
            AND instr(rl.note, 'pure-orphan cluster; rowid=' || accounts.rowid || ';') > 0
          ORDER BY rl.at DESC LIMIT 1
       )
 WHERE x_user_id IS NULL
   AND source = 'migration:null_dedup_keep_latest';

-- ----- Phase 2 — undo Class A (handle-only collapse to uid-twin)
UPDATE accounts
   SET status = (
         SELECT substr(rl.note,
                       instr(rl.note, 'prior_status=') + 13,
                       instr(rl.note, '; prior_source=') - instr(rl.note, 'prior_status=') - 13)
           FROM review_log rl
          WHERE rl.action = 'dedup_merged'
            AND rl.actor = 'migration:2026-05-26'
            AND instr(rl.note, 'collapsed handle-only row; rowid=' || accounts.rowid || ';') > 0
          ORDER BY rl.at DESC LIMIT 1
       ),
       source = (
         SELECT substr(rl.note, instr(rl.note, 'prior_source=') + 13)
           FROM review_log rl
          WHERE rl.action = 'dedup_merged'
            AND rl.actor = 'migration:2026-05-26'
            AND instr(rl.note, 'collapsed handle-only row; rowid=' || accounts.rowid || ';') > 0
          ORDER BY rl.at DESC LIMIT 1
       ),
       published_at = CASE
                        WHEN (
                          SELECT substr(rl.note,
                                        instr(rl.note, 'prior_status=') + 13,
                                        instr(rl.note, '; prior_source=') - instr(rl.note, 'prior_status=') - 13)
                            FROM review_log rl
                           WHERE rl.action = 'dedup_merged'
                             AND rl.actor = 'migration:2026-05-26'
                             AND instr(rl.note, 'collapsed handle-only row; rowid=' || accounts.rowid || ';') > 0
                           ORDER BY rl.at DESC LIMIT 1
                        ) = 'human_confirmed'
                        THEN strftime('%s','now') * 1000
                        ELSE NULL
                      END
 WHERE x_user_id IS NULL
   AND source = 'migration:dedup_to_uid_twin';

-- ----- Phase 3 — undo A0b (human_confirmed promotion of uid'd twin)
UPDATE accounts
   SET status = (
         SELECT substr(rl.note,
                       instr(rl.note, 'prior_status=') + 13,
                       instr(rl.note, '; prior_source=') - instr(rl.note, 'prior_status=') - 13)
           FROM review_log rl
          WHERE rl.action = 'status_promoted'
            AND rl.actor = 'migration:2026-05-26'
            AND instr(rl.note, 'inherited human_confirmed status from handle-only sibling; rowid=' || accounts.rowid || ';') > 0
          ORDER BY rl.at DESC LIMIT 1
       ),
       published_at = NULL
 WHERE x_user_id IS NOT NULL
   AND status = 'human_confirmed'
   AND EXISTS (SELECT 1 FROM review_log rl
                WHERE rl.action = 'status_promoted'
                  AND rl.actor = 'migration:2026-05-26'
                  AND instr(rl.note, 'inherited human_confirmed status from handle-only sibling; rowid=' || accounts.rowid || ';') > 0);

-- ----- Phase 4 — undo A0a (whitelisted promotion of uid'd twin) — LOSSY
UPDATE accounts
   SET status = (
         SELECT substr(rl.note,
                       instr(rl.note, 'prior_status=') + 13,
                       instr(rl.note, '; prior_source=') - instr(rl.note, 'prior_status=') - 13)
           FROM review_log rl
          WHERE rl.action = 'status_promoted'
            AND rl.actor = 'migration:2026-05-26'
            AND instr(rl.note, 'inherited whitelisted status from handle-only sibling; rowid=' || accounts.rowid || ';') > 0
          ORDER BY rl.at DESC LIMIT 1
       ),
       source = (
         SELECT substr(rl.note, instr(rl.note, 'prior_source=') + 13)
           FROM review_log rl
          WHERE rl.action = 'status_promoted'
            AND rl.actor = 'migration:2026-05-26'
            AND instr(rl.note, 'inherited whitelisted status from handle-only sibling; rowid=' || accounts.rowid || ';') > 0
          ORDER BY rl.at DESC LIMIT 1
       ),
       published_at = NULL
 WHERE x_user_id IS NOT NULL
   AND status = 'whitelisted'
   AND source = 'admin_whitelist'
   AND EXISTS (SELECT 1 FROM review_log rl
                WHERE rl.action = 'status_promoted'
                  AND rl.actor = 'migration:2026-05-26'
                  AND instr(rl.note, 'inherited whitelisted status from handle-only sibling; rowid=' || accounts.rowid || ';') > 0);
