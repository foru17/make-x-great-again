# Architecture — Cloudflare-native public service

Architecture notes for MXGA — the Chrome extension + Cloudflare service
that ships the public spam-shield. Read alongside [GOVERNANCE.md](../GOVERNANCE.md)
for the policy contract this implementation must satisfy.

## Goal

A public-good, semi-open, crowdsourced anti-spam system for X (Twitter):

- Anyone installs the **Chrome extension**, browses X normally, and is
  passively warned about spam / porn-ad bots on the current page.
- One-click **block** (user-initiated, never silently automatic) and one-click
  **report**.
- A **Cloudflare-native service** curates verdicts and distributes a
  semi-public, forkable, auditable blocklist. **No self-hosted server.**

## The decision that dominates cost & performance

The extension must **not** call the online service per account while you
scroll. Instead it is **local-first**:

1. The confirmed blocklist is exported as a compact **bloom filter** artifact
   (~1.2 MB per 1M entries; tens–hundreds of KB early on) on the CDN.
2. The extension downloads it **once per session/day**, version-gated
   (`304 Not Modified` ⇒ ~zero bytes), and checks every account **locally**
   (<1 ms, no network).
3. Only a bloom **hit** triggers one confirmatory API call; reports are
   user-initiated and rare.

Consequence: request volume to the service is ≈ constant regardless of how
many users browse how much. 100 or 100k users scrolling generate almost no
dynamic traffic — the cost driver becomes artifact distribution, which on
Cloudflare R2/CDN has **zero egress fees**.

## Components (all Cloudflare)

```
                ┌─────────────────────────────────────────────┐
                │  Browser extension (MV3, passive)            │
   you browse X │  • read visible accounts (no scraping)       │
  ───────────►  │  • local heuristic prefilter                 │
                │  • LOCAL bloom check (artifact from CDN)      │
                │  • popup: "本页发现 N 个 spam" + list         │
                │  • [一键拉黑] (user gesture)  [一键上报]       │
                └──────┬──────────────────┬───────────────────┘
                       │ rare: confirm    │ POST /v1/report
                       │ GET /v1/check    │
                       ▼                  ▼
                ┌─────────────────────────────────────────────┐
                │  Cloudflare Workers  (public API, edge)      │
                │  /v1/check /report /appeal /list/meta        │
                │  • Cache API + edge cache in front           │
                └──────┬───────────────────────┬──────────────┘
                       │ D1 (curation DB)       │ Cron Trigger
                       ▼                        ▼ (publish job)
                ┌──────────────────┐   ┌────────────────────────┐
                │  Cloudflare D1   │   │  Cloudflare R2          │
                │  source of truth │──►│  bloom + sharded JSON   │
                │  accounts/reports│   │  + meta.json, versioned │
                │  review_log      │   │  ZERO egress · CDN      │
                └──────────────────┘   └───────────┬────────────┘
                                                   │ (optional) mirror
                                                   ▼
                          GitHub data repo (fork/audit) + jsDelivr
```

- **Workers** — the versioned public API, at the edge (low global latency,
  built-in DDoS protection; a public anti-spam endpoint is a retaliation
  target, so this matters).
- **D1** (SQLite at the edge) — curation source of truth. The published
  blocklist is **not** read from D1 per request; it is baked into the R2
  artifact, so D1 read volume stays tiny.
- **R2** — the published bloom + sharded JSON + `meta.json`. Zero egress is
  the decisive property for "many users download the list".
- **Cron Triggers** — the periodic publish job (D1 `confirmed` → R2 artifact,
  versioned). Free with Workers.
- **Pages** — optional static landing/transparency page (free).
- **GitHub data repo** — optional public mirror of the R2 artifact for
  fork/audit; the semi-public, forkable face. R2 stays the hot path.

## Data flow

1. Extension reads visible accounts → local heuristic flags candidates →
   **local bloom** membership check (artifact cached from R2/CDN).
2. Popup aggregates: "本页发现 N 个可疑账号" with per-account verdict.
3. User chooses per account: **block** (extension drives X's native block on
   the user's click — not fully automatic) and/or **report** →
   `POST /v1/report`.
4. Worker pipeline: dedupe → LLM classify (account-age / avatar / social
   graph / content) → confidence, written to D1.
5. **Human-review gate**: an AI verdict is *never* auto-public. Only
   `confirmed` D1 rows are eligible for publication.
6. Cron publish job: export `confirmed` → bloom + sharded JSON + `meta.json`
   → R2 (versioned), optional GitHub mirror. Upheld appeals leave the next
   version with an auditable diff.

## D1 schema (provisional — superseded by SPEC-T1)

> **The final, canonical curation record, status state machine, public
> artifact schema, and gate thresholds now live in
> [docs/SPEC-T1.md](SPEC-T1.md).** The notes below are kept for historical
> context; on any conflict, SPEC-T1 wins. The canonical status set is
> `auto_pending_review | human_confirmed | rejected | removed` (no `appealed`;
> no `publications` D1 table — publish history lives in artifact `meta.json`).

- **accounts** — `x_user_id` (unique, nullable when only a handle is known),
  `handle`, `handle_history` (json), `display_name`, `verdict`, `confidence`,
  `model_version`, `status` (`pending_review` | `confirmed` | `rejected` |
  `appealed` | `removed`), `source` (`report` | `auto_scan` | `import`),
  `evidence` (json), `first_seen`, `last_scored`, `published_at`, timestamps.
- **reports** — hashed `reporter_fingerprint` (anti-abuse, **no PII**),
  target ref, `evidence` json, `page_path` (path only), `status`, `created_at`.
- **review_log** — append-only audit: account, action, actor, note, ts.
- **publications** — `version_tag`, `generated_at`, `count`, `r2_key`,
  optional `git_sha`.

Key policy: `x_user_id` is the immutable key; `@handle` is mutable and never
a primary key. Default-avatar spam accounts often expose no numeric id, so
they are kept handle-keyed with `id_resolved=false` until resolved.

## Public API (Workers, versioned, anonymous read)

- `GET  /v1/health`
- `GET  /v1/list/meta` → current version + R2/CDN artifact URL (the primary
  path — extensions pull the artifact, not per-id queries)
- `GET  /v1/check?ids=…` → confirmatory lookups for bloom hits only
- `POST /v1/report` → `202`, deduped; **a report is a signal, not a verdict**
- `POST /v1/appeal` → queues a removal review
- internal/admin (authed): review & publish

## Abuse resistance (critical)

Crowdsourced reports can be weaponized to defame. A report is **only a
prioritization signal**; the LLM + human gate is the sole publication
authority. No login / no PII; rate-limit & dedupe via salted hashed
fingerprint; optional lightweight proof-of-work. Strict scope: spam /
pornographic-ad bots only, never viewpoints. See [GOVERNANCE.md](../GOVERNANCE.md).

## Cost model (current 2026 pricing)

Sources: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).

- **Workers** — Free: 100k req/day (early = $0). Paid: **$5/mo** incl. 10M
  req + 30M CPU-ms. Local-bloom design keeps dynamic traffic far below 10M/mo
  even at 100k users ⇒ effectively **$0 → $5/mo** flat for a long runway.
- **D1** — Free: ~150M rows read / 3M written / 5GB. Paid incl. 25B reads /
  50M writes. This workload ≈ free.
- **R2** — storage $0.015/GB·mo (artifact <1GB ⇒ cents); **egress $0** — the
  reason "many users download the list" stays cheap at any scale.
- **Cron/Pages** — free.

**vs self-hosted VPS**: compute is sunk-cost $0, but you operate/patch/secure
it, single-region latency, single point of failure, you absorb DDoS, and VPS
egress caps bite when many users pull the list — you'd front it with
Cloudflare anyway. Cloudflare-only is **cheaper and near-zero-ops** for this
light read + cron + static-artifact workload.

> The real recurring cost is **LLM classification**, bounded by the rate of
> *new* suspicious accounts (deduped + gated), independent of user count and
> of the infra choice. An owned server can optionally run LLM batch jobs.

## Component map

| Component | Scope |
|---|---|
| Data contract | D1 schema + API surface + report-abuse / appeal policy |
| Extension | CDN-first checks, per-page badge bubble, one-click block/report |
| Classifier | LLM + human-review gate, runs on Workers |
| Publish pipeline | Cron mirror → `data/*.json` in this repo + CDN |
| Service plane | Workers API + D1 + Cron + SSR pages (no self-host) |
