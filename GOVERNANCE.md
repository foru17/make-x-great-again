# Governance

Make X Great Again (MXGA) publishes a list that effectively **accuses real
accounts** of being spam/abuse bots. That power is dangerous if misused.
These rules are non-negotiable and bind the code, the service, and the
published data.

## Scope

- In scope: **commercial spam and pornographic-advertising bots only**.
- Out of scope, never judged: viewpoints, politics, religion, opinions,
  language, nationality, or who a person is.

## No auto-publication

- An AI verdict is **never** automatically public. (The auto-publish gate —
  high-confidence AI + ≥3 aged independent reporters — still exists in code
  but is **disabled**; every entry queues for a maintainer.)
- A crowdsourced report is a **prioritization signal, not a verdict**.
- How entries actually flow: keyword rules + LLM classification produce
  verdicts that land in a review queue as `auto_pending_review`. Maintainers
  decide via the admin console — **individually or in rule-based batches**
  (e.g. applying a vetted keyword rule across matching queue rows). This is
  a human decision gate over every publication, not a per-entry forensic
  investigation; the safety valve is that every decision is audit-logged in
  `review_log` and appeals are honored.

## Appeal & removal

- Anyone can appeal a listing (see the appeal issue template, or
  `POST /v1/appeal`).
- Appeals are reviewed by a human. An upheld appeal **removes** the entry,
  which disappears from the next published version with an **auditable diff**.
- Removal must be at least as fast and easy as listing.

## Data minimization & privacy

- The public list stores only the **public X numeric user id** plus minimal
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

- Mass-reporting to defame is an explicit threat. Reports never auto-publish;
  rate-limited and deduped; the LLM + human gate is the sole authority.

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

- Maintainers must keep the human-review gate functioning. If review capacity
  cannot keep up, slow publication — never bypass the gate.
