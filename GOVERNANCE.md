# Governance

Make X Great Again (MXGA) publishes a list that effectively **accuses real
accounts** of being spam/abuse bots. That power is dangerous if misused.
These rules are non-negotiable and bind the code, the service, and the
published data.

## Scope

- In scope: **commercial spam and pornographic-advertising bots only**.
- Out of scope, never judged: viewpoints, politics, religion, opinions,
  language, nationality, or who a person is.

## Controlled publication

On 2026-10-15 the maintainer authorized automatic publication of qualifying
second-opinion Agent blacklist recommendations. This replaces the previous
blanket prohibition on AI publication. The settings below describe the
authorized implementation; deployment must be verified separately.

- `AI_AUTO_PUBLISH_ENABLED=0`: the first-pass AI/report promotion path stays
  disabled. A first-pass classification alone does not publish an account.
- `AGENT_AUTO_BLACKLIST_ENABLED=1`: a second-opinion decision authenticated
  with `AGENT_TOKEN` may publish only when its decision is `blacklist`, its
  action is `approve_block`, its label is `spam` or `porn_bot`, confidence is
  at least `0.90`, and its signals contain `P1`, `P2`, `P3`, `P4`, or `P6`.
  Stored original evidence must be nonempty and the Agent evidence hash must
  match the current signals hash. Known follower counts must be below
  100,000; a missing count is permitted.
- Identity conflicts, a matching whitelist entry, or an existing human
  terminal decision prevent automatic promotion. A canonical handle-only
  identity may qualify when no numeric user id is available.
- Automatic Agent publications retain `published_tier='ai'` and Agent
  decision provenance, including in the legacy `human_confirmed` status;
  they must not be presented as human approvals.
- A crowdsourced report is a **prioritization signal, not a verdict**.
- Maintainers may still approve entries individually or in vetted rule-based
  batches. Agent decisions outside the automatic gate remain private for
  review. Every publication is audit-logged in `review_log`, and appeals
  remain subject to human review.
- The same gate applies to new Agent decisions and existing `agent_blacklist`
  rows. Scheduled backfill is bounded to 100 candidates per 10-minute tick;
  the admin backfill defaults to `dry_run=true`, with `limit` capped at 100.
  Promotion reuses stored verdicts and adds no model calls or runner budget.

## Appeal & removal

- Anyone can appeal a listing (see the appeal issue template, or
  `POST /v1/appeal`).
- Appeals are reviewed by a human. An upheld appeal **removes** the entry,
  which disappears from the next published version with an **auditable diff**.
- Removal must be at least as fast and easy as listing.

## Data minimization & privacy

- The public list stores the **public X numeric user id**, or a canonical
  public handle when the id is unavailable, plus minimal
  evidence needed to justify the verdict (verdict, confidence, model version,
  reasons, timestamp).
- **No PII** beyond the public identifier. Reporter identities are never
  stored — only a salted HMAC fingerprint for anti-abuse. The salt
  (`REPORT_SALT`) is mandatory: report/confirm/classify/appeal endpoints
  **fail closed** (503) when it is unset, so raw identities can never land
  in the database; a one-shot admin backfill migrates any legacy raw
  `gh:<id>` rows to fingerprints.
- Page context in reports is reduced to a path; no query strings, no content
  beyond the reported account's own public signals.

## Abuse resistance

- Mass-reporting to defame is an explicit threat. Reports are rate-limited
  and deduped, and cannot by themselves authorize publication. Publication
  requires an authorized rule, a maintainer decision, or the guarded
  second-opinion Agent path above.

## Transparency

- The public data repo is versioned and forkable; every publication carries
  a content-derived version, generation time, and count.
- Removals are logged. Methodology and scope are public.
- **Audit snapshot**: the curated whitelist + blacklist are auto-mirrored
  from D1 to [`data/whitelist/v1.json`](https://github.com/foru17/make-x-great-again/blob/data-mirror/data/whitelist/v1.json) and
  [`data/blacklist/v1.json`](https://github.com/foru17/make-x-great-again/blob/data-mirror/data/blacklist/v1.json) every 6 hours by the
  Worker's scheduled handler (diff-aware — only commits when content
  actually changed). Since 2026-08-03 the mirror writes to the dedicated
  [`data-mirror`](https://github.com/foru17/make-x-great-again/tree/data-mirror/data)
  branch so automated data commits never race code work on `main` (the
  `data/` copy on `main` is a frozen snapshot from that date). The git
  history of that branch **is** the audit
  log: anyone can clone and reconstruct "what was on the list at any past
  timestamp", including the `evidence_text` (the public X content that
  triggered each verdict) and `reasons` array (LLM-stated rationale). See
  [`data/README.md`](https://github.com/foru17/make-x-great-again/blob/data-mirror/data/README.md) for the schema and update mechanism.
- **Published artifacts (bloom + shards)**: the Worker republishes the
  confirmed list to R2 every 10 minutes as a bloom filter + sharded JSON +
  meta document, discoverable via `GET /v1/list/meta` and served from
  `/v1/artifacts/<key>` on `x.zuoluo.tv`. Artifact versions are derived from
  content, so a new version appears only when the list actually changed.
  Removals disappear from the next version. See
  [`DATA_USAGE.md`](./DATA_USAGE.md) for the full format.

## Accountability

- Maintainers must keep the publication guards, audit trail, and human appeal
  review functioning. Review backlogs do not justify bypassing these guards;
  disable the Agent publication switch if its quality becomes unacceptable.
