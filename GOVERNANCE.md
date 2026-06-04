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

- An AI verdict is **never** automatically public.
- A crowdsourced report is a **prioritization signal, not a verdict**.
- Only entries that pass a **human-review gate** with sufficient confidence
  are eligible for the public list.

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
  stored — only a salted, hashed fingerprint for anti-abuse.
- Page context in reports is reduced to a path; no query strings, no content
  beyond the reported account's own public signals.

## Abuse resistance

- Mass-reporting to defame is an explicit threat. Reports never auto-publish;
  rate-limited and deduped; the LLM + human gate is the sole authority.

## Transparency

- The public data repo is versioned and forkable; every publication carries
  a version tag, generation time, count, and source commit.
- Removals are logged. Methodology and scope are public.
- **Audit snapshot**: the curated whitelist + blacklist are auto-mirrored
  from D1 to [`data/whitelist/v1.json`](./data/whitelist/v1.json) and
  [`data/blacklist/v1.json`](./data/blacklist/v1.json) every 6 hours by the
  Worker's scheduled handler (diff-aware — only commits when content
  actually changed). The git history of that directory **is** the audit
  log: anyone can clone and reconstruct "what was on the list at any past
  timestamp", including the `evidence_text` (the public X content that
  triggered each verdict) and `reasons` array (LLM-stated rationale). See
  [`data/README.md`](./data/README.md) for the schema and update mechanism.
- **Public list (sharded + bloom)**: the CDN-friendly `public-list/data/`
  release is generated daily by CI, tagged with SemVer, and served via
  jsDelivr / raw GitHub. Each release includes a bloom filter index
  (~12 KB for 10k entries) and 256 hash-sharded JSONs. Removals appear
  as missing entries in the next tag, and the git diff between tags is
  the auditable change log. See [`DATA_USAGE.md`](./DATA_USAGE.md) and
  [`src/public-list/`](./src/public-list/) for the full format.

## Accountability

- Maintainers must keep the human-review gate functioning. If review capacity
  cannot keep up, slow publication — never bypass the gate.
