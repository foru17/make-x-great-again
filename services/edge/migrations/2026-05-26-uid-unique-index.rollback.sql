-- Roll back the UNIQUE INDEX from 2026-05-26-uid-unique-index.sql.
-- Drops the partial uniqueness constraint on accounts(x_user_id).
-- After this runs, accounts(x_user_id) is unconstrained again — handle-
-- rename events will once more INSERT duplicate uid rows from the old
-- (handle-first) writeAccount path if the Wave B worker is also rolled back.
DROP INDEX IF EXISTS idx_accounts_uid_uq;
