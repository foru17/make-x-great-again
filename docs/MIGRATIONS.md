# D1 migrations ledger

This file tracks one-off SQL data migrations applied to the production
`xss-db` D1 database. Schema-level changes still live in
[`services/edge/schema.sql`](../services/edge/schema.sql) (idempotent
`CREATE IF NOT EXISTS` shape); migrations here are for *data* — backfills,
de-duplications, and one-shot fixups that cannot be expressed as schema.

## How to apply

```bash
cd services/edge

# 1. Dry run against your local sqlite copy (recommended)
npx wrangler d1 execute xss-db --local --file=./migrations/<file>.sql

# 2. Preview against remote — the file's PREVIEW comment block has the
#    diagnostic SELECTs to run via --command first
npx wrangler d1 execute xss-db --remote --command="SELECT ..."

# 3. Apply for real (every statement runs as one atomic D1 batch)
npx wrangler d1 execute xss-db --remote --file=./migrations/<file>.sql
```

Every migration must:
- Be idempotent (re-running is a no-op once the cleanup landed)
- Write a `review_log` entry per affected row (audit trail, also makes
  rollback possible). When the rollback needs to pair each accounts row
  back to its specific audit entry, embed `rowid=<n>;` in the note and
  end the note with `prior_status=...; prior_source=...` so a single
  substr/instr parser handles both fields.
- Ship a companion `.rollback.sql` that undoes the data change.
- Be verified end-to-end against a `--local` seed before `--remote` apply
  (seed → migrate → rollback → cmp against seed snapshot)

## Ledger

| Date | File | Status | Affected | Notes |
|---|---|---|---|---|
| 2026-05-26 | `2026-05-26-identity-cleanup.sql` | ✅ applied 2026-05-26 03:16 UTC | accounts: 78 (Class A) + 19 (Class B) → `status='removed'`; reports: 7 deleted; 2 uid'd rows promoted to whitelisted (A0a); 99 review_log audit rows; 1.86s; D1 `changes=206` | Collapses handle-only "ghost" rows that have a uid-bearing twin; deduplicates pure-orphan handles by `last_scored`; deletes report duplicates that snuck past the UNIQUE INDEX via NULL uids. Pre-apply D1 export saved to `/tmp/xss-db-pre-2026-05-26-identity-cleanup.sql` (3.4 MB, SHA256 `ae01e0db…dffdfdca`) for catastrophic rollback. |
| 2026-05-26 | `2026-05-26-uid-unique-index.sql` | ✅ applied 2026-05-26 03:30 UTC | adds `idx_accounts_uid_uq UNIQUE (x_user_id) WHERE x_user_id IS NOT NULL` | Locks in the post-cleanup state: same X numeric uid can never split across two rows again. Worker code from PR #14 deployed first (version `91374842-6778-4c34-ace1-c65a7260ba2a`), then index applied (5ms). Pre-flight: 0 duplicate uids, no constraint conflicts. |
| 2026-05-27 | `2026-05-27-agent-pipeline.sql` | ⏳ apply before enabling side-channel agent in production | adds agent annotation columns, agent staging statuses, `last_decided_by/at` | Supports `/v1/agent/queue`, `/v1/agent/decide`, `/v1/agent/stats`, and admin promote flows. Rollback file documents how to revert agent statuses to `auto_pending_review`. |
| 2026-05-28 | `2026-05-28-public-trends.sql` | ⏳ apply before relying on `/v1/list/trends` at scale | adds `idx_accounts_status_published_at` | Speeds up public count/window queries and trend buckets. Companion rollback drops only this index. |
| 2026-05-28 | `2026-05-28-account-profile-metrics.sql` | ⏳ apply before deploying admin metrics UI | adds nullable `account_created_at`, `account_age_days`, `followers_count`, `following_count` | Persists profile metrics already captured by the extension so `/admin` can show registration time, followers, and following counts. Rollback leaves nullable columns in place. |
| 2026-05-29 | `2026-05-29-admin-sort-indexes.sql` | ⏳ apply before relying on admin metric sorting at scale | adds `status + account_created_at/followers_count/following_count` indexes | Helps admin queue/list endpoints sort and page by captured profile metrics. Companion rollback drops only these indexes. |
| 2026-06-04 | `2026-06-04-reporter-bans.sql` | ⏳ apply before using reporter bans | adds `reporter_bans` table + active lookup index | Enables `/v1/admin/reporter-bans` and `/v1/admin/reporter-fingerprints/backfill`. After setting `REPORT_SALT`, run the backfill endpoint once before enforcing `REQUIRE_AUTH=1` in production. |

Rollback: `2026-05-26-identity-cleanup.rollback.sql` (restores the
`accounts` rows; `reports` deletes are not recoverable from migration data).
