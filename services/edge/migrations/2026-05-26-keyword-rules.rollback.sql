-- Roll back the 2026-05-26 keyword_rules migration.
-- DROP TABLE removes all rules + their hit counters. There's no recovery.
-- If you only want to disable the feature temporarily, leave the table
-- alone and roll back the Worker code instead (it'll stop reading the
-- table entirely).
DROP INDEX IF EXISTS idx_keyword_rules_enabled;
DROP TABLE IF EXISTS keyword_rules;
