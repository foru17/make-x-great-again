-- Rule-hit telemetry evidence.
--
-- Why: rule_hit_stats only carried {pattern, handle, uid, category}, so the
-- maintainer promoted accounts from the admin workbench without ever seeing
-- WHAT matched. Keyword rules are now the dominant source of public-list
-- additions (2026-09-04 audit: 104/day vs. 0 from the AI lane), which makes
-- blind promotion the main false-positive path. Clients now send which field
-- matched and a ≤200-char excerpt of that field (the spam account's own
-- public text; the server verifies the excerpt contains the pattern).
ALTER TABLE rule_hit_stats ADD COLUMN field TEXT;
ALTER TABLE rule_hit_stats ADD COLUMN sample_text TEXT;
