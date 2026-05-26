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
| 2026-05-26 | `2026-05-26-uid-unique-index.sql` | ⏳ pending | adds `idx_accounts_uid_uq UNIQUE (x_user_id) WHERE x_user_id IS NOT NULL` | Locks in the post-cleanup state: same X numeric uid can never split across two rows again. **Must be applied AFTER the matching worker code (Wave B, `findAccount` by-uid-first) is deployed**, otherwise handle-rename events would raise UNIQUE violations on /v1/classify. |

Rollback: `2026-05-26-identity-cleanup.rollback.sql` (restores the
`accounts` rows; `reports` deletes are not recoverable from migration data).
