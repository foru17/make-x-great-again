-- Roll back 2026-08-02-list-identity-dedup.sql.
-- Review-log rows remain as an immutable record that the rollback occurred;
-- account status/source/published_at are restored exactly from their audit
-- note. Run soon after the forward migration, before normal traffic changes
-- the affected rows again.

DROP INDEX IF EXISTS idx_accounts_active_null_handle_uq;

UPDATE accounts
   SET status = (
         SELECT substr(
                  rl.note,
                  instr(rl.note, 'prior_status=') + 13,
                  instr(rl.note, '; prior_source=')
                    - instr(rl.note, 'prior_status=') - 13
                )
           FROM review_log rl
          WHERE rl.action='dedup_merged'
            AND rl.actor='migration:2026-08-02'
            AND instr(rl.note, 'rowid=' || accounts.rowid || ';')>0
          ORDER BY rl.at DESC, rl.id DESC LIMIT 1
       ),
       source = (
         SELECT substr(rl.note, instr(rl.note, 'prior_source=') + 13)
           FROM review_log rl
          WHERE rl.action='dedup_merged'
            AND rl.actor='migration:2026-08-02'
            AND instr(rl.note, 'rowid=' || accounts.rowid || ';')>0
          ORDER BY rl.at DESC, rl.id DESC LIMIT 1
       ),
       published_at = CASE (
         SELECT substr(
                  rl.note,
                  instr(rl.note, 'prior_published_at=') + 19,
                  instr(rl.note, '; prior_status=')
                    - instr(rl.note, 'prior_published_at=') - 19
                )
           FROM review_log rl
          WHERE rl.action='dedup_merged'
            AND rl.actor='migration:2026-08-02'
            AND instr(rl.note, 'rowid=' || accounts.rowid || ';')>0
          ORDER BY rl.at DESC, rl.id DESC LIMIT 1
       )
         WHEN 'NULL' THEN NULL
         ELSE CAST((
           SELECT substr(
                    rl.note,
                    instr(rl.note, 'prior_published_at=') + 19,
                    instr(rl.note, '; prior_status=')
                      - instr(rl.note, 'prior_published_at=') - 19
                  )
             FROM review_log rl
            WHERE rl.action='dedup_merged'
              AND rl.actor='migration:2026-08-02'
              AND instr(rl.note, 'rowid=' || accounts.rowid || ';')>0
            ORDER BY rl.at DESC, rl.id DESC LIMIT 1
         ) AS INTEGER)
       END
 WHERE source IN (
   'migration:whitelist_add_collateral',
   'migration:null_to_uid_twin',
   'migration:null_active_dedup'
 )
   AND EXISTS (
     SELECT 1 FROM review_log rl
      WHERE rl.action='dedup_merged'
        AND rl.actor='migration:2026-08-02'
        AND instr(rl.note, 'rowid=' || accounts.rowid || ';')>0
   );
