# SPEC-T1 — Governance red lines & data contract (FINAL)

Status: **final** (LUO-16 / T1). Supersedes the "provisional / proposed"
notes in `docs/ARCHITECTURE.md`, `src/schema.ts`, and `services/edge/schema.sql`
wherever they conflict. This is the single source of truth that T2–T5 build
against. Inputs: `docs/ARCHITECTURE.md`, `docs/MODERATION.md`,
`GOVERNANCE.md`, the deployed edge schema, and PR#4.

Scope of this document, per the T1 acceptance criteria:

1. Governance red lines (misjudgment / appeal / removal, scope, no-PII,
   open-source license rationale, transparency).
2. Canonical curation record schema (key = X numeric user id).
3. Canonical public-release artifact schema (sharded JSON + `meta.json` +
   membership index).
4. Confidence thresholds & human-review gate strategy.

Where the deployed code already implements a decision, this spec **ratifies
the deployed behaviour** and lists the exact remaining deltas in
§7 so finalization does not destabilize the live service.

---

## 1. Governance red lines (binding)

These bind the code, the service, and every published artifact. They restate
`GOVERNANCE.md` as enforceable contract; on any conflict, the stricter reading
wins.

### 1.1 Scope (what may ever be listed)

- **In scope, the only thing judged:** commercial **spam** and
  **pornographic-advertising bots**.
- **Out of scope, never judged:** viewpoints, politics, religion, opinions,
  language, nationality, or who a person is. A classifier output that depends
  on any of these is a defect, not a verdict.

### 1.2 No auto-publication of an AI verdict alone

- An AI verdict is **never** publishable on its own.
- A crowdsourced report is a **prioritization signal, not a verdict**.
- An entry becomes public only by passing the **human-review gate** (§5):
  either a maintainer approval, or the codified human signal
  (≥ K independent GitHub-verified reporters) layered on top of a
  high-confidence AI verdict.

### 1.3 Misjudgment / appeal / removal

- Anyone may appeal a listing via the appeal issue template or
  `POST /v1/appeal`. No login or PII is required to appeal.
- Appeals are decided by a human. An **upheld appeal removes the entry**: its
  status goes to `removed` and it disappears from the **next** published
  artifact, leaving an **auditable diff** (the removal is recorded, not
  silently dropped).
- **Removal must be at least as fast and easy as listing.** Operationally:
  the publish cron (§4.6) must run at least as often as new entries are
  confirmed, so a `removed` flag never lingers in a live artifact longer than
  one publish cycle.
- Filing an appeal does **not** by itself unpublish an entry (otherwise mass
  appeals become a delisting attack). The entry stays in its current status
  until a human decides. A maintainer MAY provisionally suppress a contested
  entry pending review; that is a human action, logged like any other.

### 1.4 Data minimization & no PII

- The curation store and the public artifact key on the **public X numeric
  user id** only. Beyond that, only the minimal evidence needed to justify a
  verdict is stored: `verdict_label`, `confidence`, `model`, `reasons[]`,
  timestamps, and a `signals_hash` pointer.
- **No reporter identity is ever stored.** Anti-abuse uses only a salted,
  hashed fingerprint (`reporter_fp`) — for GitHub-gated reporting this is
  `gh:<numeric-id>` (a stable pseudonymous id, the minimum needed to
  rate-limit and dedupe per account). No email, no handle, no IP retained.
- Report page context is reduced to a **path** (`page_path`); no query
  strings, no free-text content beyond the reported account's own public
  signals.
- **The public artifact carries no `reasons` free text that could leak a
  reporter or third party** — see §4.4 redaction.

### 1.5 Abuse resistance

- Mass-reporting to defame is an explicit, designed-for threat. Reports never
  auto-publish; they are rate-limited and deduped per `reporter_fp`; the
  AI + human gate is the sole publication authority (§5).
- The costly/abusable write path (`/v1/classify`, `/v1/report`, `/v1/confirm`)
  is identity-gated; cheap reads (`/v1/check`, artifact fetch) are anonymous.

### 1.6 Transparency

- The published data is versioned, forkable, and auditable. Every artifact
  carries a version tag, generation time, entry count, and source commit
  (§4.3).
- Removals are logged (`review_log`); scope and methodology are public
  (this doc + `GOVERNANCE.md` + `docs/MODERATION.md`).

### 1.7 Accountability

- Maintainers must keep the human-review gate functioning. If review capacity
  cannot keep up, **slow publication — never bypass the gate** (raise the
  cadence interval or pause the cron, never lower the gate).

---

## 2. Open-source license rationale (decided)

Two distinct artifacts, two distinct licenses:

### 2.1 Code — **AGPL-3.0-only** (decided; already the repo `LICENSE`)

The project is a **hosted public-good anti-abuse service**. The risk we are
licensing against is a third party taking the curation server + admin gate,
running it as a closed SaaS, and never returning improvements — which would
fork the public good into a private one. AGPL-3.0's network-use clause closes
exactly that hole: anyone who runs a modified service over a network must
offer their source.

- **Why AGPL over MIT/Apache:** MIT/Apache maximize adoption but permit a
  closed hosted fork. For infrastructure whose entire value is being *public
  and auditable*, copyleft-over-the-network is the aligned choice. The cost of
  AGPL (some companies forbid AGPL deps) is acceptable: this is an end-user
  service, not a library meant to be embedded.
- **Decision:** keep `LICENSE` = **AGPL-3.0-only** for the server (`services/edge`)
  and curation tooling (`src/`).

### 2.2 Browser extension — **AGPL-3.0-only (kept), MIT/Apache-2.0 reconsidered only if reuse demands it**

The extension is client-side and contains no server secrets. A permissive
license (MIT/Apache-2.0) would maximize reuse of the detection UI by other
clients. However, keeping the whole monorepo under one license (AGPL-3.0)
avoids per-directory license ambiguity and matches the project's
public-good posture. **Decision:** single repo license = AGPL-3.0-only; revisit
a permissive sub-license for `extension/` only if a concrete downstream reuse
case appears. (Documented as a reversible, low-cost decision.)

### 2.3 Published blocklist DATA — **ODbL-1.0** (decided)

The list is a database, not code; a code license fits it poorly.

- **Why ODbL over CC0:** CC0 (public-domain) maximizes reuse but lets a fork
  republish the list with **no attribution and no share-back of corrections**,
  which weakens the auditable-commons goal (corrections/removals are the whole
  point). ODbL-1.0 keeps the database open while requiring derivative
  databases to stay open and attributed — the share-alike property we want for
  a defamation-sensitive accusatory list.
- **Decision:** the R2/GitHub published artifact (`meta.json` + shards +
  index) is licensed **ODbL-1.0**, declared in `meta.json.license` and a
  `LICENSE-DATA` file in the data mirror. Individual verdict records are not
  themselves copyrightable; ODbL governs the *database*.

---

## 3. Canonical curation record (D1 — source of truth)

`x_user_id` (X numeric user id) is the **immutable key**. `@handle` is mutable
and is **never** a key. This ratifies the deployed `services/edge/schema.sql`;
deltas to align the other two files are in §7.

### 3.1 `accounts` (the curated record)

| Column | Type | Notes |
|---|---|---|
| `x_user_id` | TEXT | Numeric id as string; **the key**. NULL only when handle-only (see §3.4). |
| `handle` | TEXT | `@handle` without `@`; mutable, informational. |
| `display_name` | TEXT | Informational. |
| `avatar_url` | TEXT | Informational; admin-console convenience only. |
| `verdict_label` | TEXT NOT NULL | `spam \| porn_bot \| likely_spam \| uncertain \| legit`. |
| `confidence` | REAL NOT NULL | `0..1`, model self-reported. |
| `reasons` | TEXT | JSON array of 1–6 short evidence strings. |
| `model` | TEXT | **Model version** that produced the verdict. |
| `status` | TEXT NOT NULL | State machine §3.3. Default `auto_pending_review`. |
| `source` | TEXT NOT NULL | `auto_scan \| report \| import`. Default `auto_scan`. |
| `signals_hash` | TEXT | sha/derived hash of canonicalized signals — the **evidence pointer** (detects re-scores; links the published record back to the private signals without storing them publicly). |
| `first_seen` | INTEGER NOT NULL | epoch ms. |
| `last_scored` | INTEGER NOT NULL | epoch ms — **the verdict timestamp**. |
| `published_at` | INTEGER | epoch ms; set when first included in an artifact. NULL until then. |
| `removed_at` | INTEGER | epoch ms; set on upheld appeal / maintainer removal. **(new — see §7)** |
| PRIMARY KEY | `(x_user_id, handle)` | Composite tolerates handle-only rows pre-resolution. |

Acceptance-criteria mapping: **key** = `x_user_id`; **evidence pointer** =
`signals_hash` (+ `reasons`); **classifier verdict/confidence** =
`verdict_label` / `confidence`; **model version** = `model`; **timestamp** =
`last_scored` (scored) / `first_seen` / `published_at`; **human-review flag** =
`status` (the `human_confirmed` transition is the human gate).

### 3.2 `reports`, `review_log` (ratified as deployed)

- `reports(id, x_user_id, handle, reporter_fp, evidence, status, created_at)`
  with the unique index `(handle, x_user_id, reporter_fp)` for INSERT-OR-IGNORE
  dedupe. `reporter_fp` is `gh:<id>` or a salted hash — **no PII** (§1.4).
- `review_log(id, x_user_id, handle, action, actor, note, at)`, append-only;
  `actor ∈ system | user | human`. Every status transition and every removal
  writes a row — this is the transparency/audit ledger.

### 3.3 Status state machine (canonical)

```
            AI scores (source=auto_scan|report)
                       │
                       ▼
            ┌─────────────────────┐
            │ auto_pending_review │  (never public)
            └──────────┬──────────┘
       gate (§5):      │
   admin approve  OR   │  AI≥0.9 spam/porn_bot + ≥K gh reporters
                       ▼
            ┌─────────────────────┐
            │   human_confirmed   │  (PUBLIC — only this status publishes)
            └──────────┬──────────┘
        upheld appeal /│ maintainer removal
                       ▼
            ┌─────────────────────┐
            │      removed        │  (tombstone; excluded from artifact;
            └─────────────────────┘   retained for auditable diff)

   gate rejects ─────► rejected   (never public; retained to suppress
                                   re-listing churn)
```

Canonical status set: **`auto_pending_review | human_confirmed | rejected |
removed`**. (`/v1/check` and every publish query filter `status =
'human_confirmed'`.) The provisional five-state set in `ARCHITECTURE.md`
(`pending_review|confirmed|appealed|…`) and `human_rejected` in `src/schema.ts`
are **superseded** — see §7 for the rename deltas. `appealed` is **not** a
status; an open appeal is tracked via `review_log` + an optional `appeals`
table and does not by itself change `status` (§1.3).

### 3.4 Key policy & the handle-only fallback (decided)

- **Only `x_user_id`-resolved entries are ever published.** A handle is
  reassignable; publishing on a handle key risks accusing whoever next owns
  that handle. Therefore:
  - Handle-only rows (`x_user_id IS NULL`) are kept in D1 with
    `status` capped at `auto_pending_review` / `rejected` and are
    **excluded from the public artifact** until the numeric id is resolved.
  - Default-avatar spam that exposes no numeric id stays handle-keyed and
    unpublished until resolution; this is the accepted coverage gap, not a
    reason to relax the key rule.
- `x_user_id` is immutable. Handle changes update `handle`/`handle_history`
  but never the identity of the record.

---

## 4. Public-release artifact schema (FINAL)

The artifact is what extensions and forks consume. It is **derived** from
D1 `status='human_confirmed'` by the publish cron (T4); D1 is never read
per-scroll. **Status: spec final, implementation is T4 (LUO-19), not yet
built** — today the extension uses per-id `/v1/check` against D1 (§6).

### 4.1 Layout (R2 / GitHub mirror, CDN-fronted)

```
/v1/latest.json                 → pointer: { "version": "<tag>", "meta": "<url>" }
/v1/<version>/meta.json         → manifest (§4.3)
/v1/<version>/bloom.bin         → membership filter (§4.5)
/v1/<version>/index.json        → hash-bucket fallback index (§4.5, optional)
/v1/<version>/shards/<bb>.json  → per-shard records (§4.4); <bb> = 2 hex chars
```

- `<version>` is immutable once written (content-addressed by version tag);
  clients cache aggressively and gate on `/v1/latest.json` + ETag / `304`.
- `latest.json` is the only mutable object; everything under `/<version>/` is
  write-once, enabling zero-egress CDN caching and trivial forking.

### 4.2 Versioning

- `version` = `v<schema_major>.<generation>` e.g. `v1.2026060300` where the
  generation is a monotonic publish counter or UTC `YYYYMMDDHH`. Monotonic,
  sortable, never reused.
- `schema_version` (integer) in `meta.json` is bumped only on breaking layout
  changes; clients reject unknown `schema_version` major.

### 4.3 `meta.json` (manifest)

```jsonc
{
  "schema_version": 1,
  "version": "v1.2026060300",
  "generated_at": "2026-06-03T00:00:00Z",
  "source_commit": "<git sha of the publishing code>",       // transparency
  "count": 1234,                       // # human_confirmed entries in artifact
  "removed_since_prev": 5,             // auditable-diff hint (§1.3)
  "license": "ODbL-1.0",
  "shard": { "count": 256, "key": "sha256(x_user_id)[0:2]", "dir": "shards" },
  "shards": [                          // integrity per shard
    { "name": "00.json", "count": 7, "sha256": "<hex>" }
    /* … */
  ],
  "bloom": {                           // params to reconstruct the filter
    "file": "bloom.bin", "m_bits": 16384, "k": 7,
    "hash": "fnv1a+double", "seed": 0, "target_fp": 1e-4, "sha256": "<hex>"
  },
  "index": { "file": "index.json", "present": false }
}
```

### 4.4 Shard record (the published, redacted view)

Sharding: `shard = first 2 hex chars of sha256(x_user_id)` → ≤256 balanced,
stable buckets (few populated early; no rebalancing as the list grows).

```jsonc
// /v1/<version>/shards/<bb>.json
{
  "version": "v1.2026060300",
  "entries": {
    "44196397": {                      // key = X numeric user id (string)
      "label": "porn_bot",             // spam | porn_bot | likely_spam
      "confidence": 0.94,
      "model": "<model-version>",
      "listed_at": "2026-05-30T11:02:00Z",
      "reasons": ["new account + default avatar", "links to escort site"]
    }
    /* … */
  }
}
```

- **Published labels are restricted to `spam | porn_bot | likely_spam`.**
  `uncertain` / `legit` never appear (they are never `human_confirmed`).
- **Redaction (§1.4):** `reasons` are short, account-intrinsic justifications
  only; the publish job MUST drop any reason mentioning a reporter, a third
  party, or page context. `reporter_fp`, `signals_hash`, `page_path`, and all
  report rows are **never** exported. No handle is published as a key (numeric
  id only); handle MAY be included as a non-authoritative display field if
  desired, but is not required and is never the lookup key.

### 4.5 Membership index

Two co-published forms; clients pick by capability:

- **Bloom filter (`bloom.bin`)** — primary. Local `<1 ms` membership check,
  no network per account. Sized for **target false-positive ≤ 1e-4** at the
  current `count`; `m_bits` and `k` recomputed each publish and recorded in
  `meta.bloom`. A bloom **hit** is only a *maybe* → the client confirms via the
  shard file (or `/v1/check`) before showing a verdict, so a bloom FP never
  produces a false accusation, only a wasted lookup.
- **Hash-bucket index (`index.json`)** — optional exact fallback for clients
  that can't run a bloom (or want exact membership without downloading all
  shards): `{ "<bb>": ["<id>", …] }` keyed by the same 2-hex shard. Larger
  than the bloom; published only when `meta.index.present = true`.

Encoding: `bloom.bin` is a little-endian packed bitset prefixed by a small
fixed header (`m_bits`, `k`, `seed`); the canonical reference serializer/
reader lives with the T4 publish job and the T2 extension respectively and
MUST round-trip the params from `meta.json`.

### 4.6 Publish cron contract (T4)

- Query `status='human_confirmed'` → build shards + bloom (+ optional index) →
  write `/<version>/…` → flip `/v1/latest.json`. Set `published_at` on
  newly-included rows. Exclude `removed` rows and emit `removed_since_prev`.
- Cadence is a knob (default hourly; min = "as often as confirmations occur",
  per §1.3). The job is idempotent: same D1 state ⇒ same artifact bytes
  (stable shard ordering, sorted keys) so diffs are reviewable.

---

## 5. Confidence thresholds & human-review gate (FINAL)

Ratifies the deployed `AUTO_CONF=0.9`, `AUTO_REPORTERS=3` constants and
`docs/MODERATION.md` §"Decisions".

### 5.1 Classifier output

`label ∈ {spam, porn_bot, likely_spam, uncertain, legit}` + `confidence ∈
[0,1]` + `reasons[1..6]`. Temperature 0. "When genuinely unsure, prefer
`uncertain` over a false accusation" is a hard rule, not a preference.

### 5.2 Gate decision table

| Condition | Result |
|---|---|
| `label ∈ {spam, porn_bot}` **AND** `confidence ≥ 0.90` **AND** `≥ K=3` independent GitHub-verified reporters **AND** `x_user_id` resolved | **auto-confirm → `human_confirmed` (public)** |
| `label ∈ {spam, porn_bot}` high conf but `< K` reporters | **admin queue** (human decides) |
| `label ∈ {likely_spam, uncertain}` (any confidence / any reporters) | **admin queue** — never auto |
| `label = legit` | not listed |
| Admin **approve** in queue | → `human_confirmed` (public) |
| Admin **reject** | → `rejected` |
| Upheld appeal / admin **remove** | → `removed` (§1.3) |

- **The red line is preserved:** AI confidence alone *never* publishes. The
  human signal for the auto path is **K independent GitHub-verified reporters**
  (real people), not the model. Everything the auto path doesn't catch flows
  to a human.
- **Knobs (defaults):** `AUTO_CONF = 0.90`, `K = AUTO_REPORTERS = 3`,
  publish bloom `target_fp = 1e-4`, publish cadence = hourly. All are
  policy knobs; changing them is a logged maintainer decision, not a code
  rewrite.
- `confidence` is model-self-reported and **not** calibrated; it is used only
  as a *floor* in combination with human corroboration, never as a sole
  publication trigger. Do not present raw confidence to end users as a
  probability.

### 5.3 Identity gating (cost & abuse, ratified)

- `/v1/check` and artifact fetch: **anonymous** (cheap, cacheable, read-only).
- `/v1/classify`, `/v1/report`, `/v1/confirm`: **GitHub identity required**
  when `REQUIRE_AUTH=1`. The server LLM key is never an anonymous endpoint.
  `REQUIRE_AUTH` ships **off** and is flipped on once the extension's GitHub
  login is live (tracked in STATUS gap #6 — a deploy decision, not a T1 one).

---

## 6. As-built vs. this spec (so T1 doesn't destabilize prod)

| Area | Deployed today | This spec |
|---|---|---|
| Curation record | `accounts` per `schema.sql` | §3 — ratified; +`removed_at` (§7) |
| Status set | `auto_pending_review/human_confirmed/rejected/removed` | §3.3 — **ratified as canonical** |
| Public distribution | per-id `/v1/check` + `/v1/list` from D1 | §4 artifact (T4) — **spec only, not built** |
| Gate constants | `AUTO_CONF=0.9`, `AUTO_REPORTERS=3` | §5 — ratified |
| License (code) | AGPL-3.0 `LICENSE` | §2.1 — ratified |
| License (data) | none | §2.3 ODbL-1.0 — **new, add on first publish** |

The artifact schema (§4) is the one genuinely *new* contract; it is
deliberately specified so T4 can be built without re-opening T1.

---

## 7. Finalization deltas (exact, low-risk; for T2–T5)

These align the drifted files to this spec. None change deployed runtime
behaviour except the additive `removed_at` column.

1. **`src/schema.ts`** — rename `ReviewStatus` value `human_rejected` →
   `rejected` to match the deployed DB and §3.3. (Code-only; the local JSONL
   store is dev-side.) Update the doc-comment to point here.
2. **`services/edge/schema.sql`** — add `removed_at INTEGER` to `accounts`
   (additive, nullable; no backfill needed). Add the (optional) `appeals`
   table only when `POST /v1/appeal` is implemented.
3. **`docs/ARCHITECTURE.md`** — replace the "provisional" five-state status
   list and the never-created `publications` table reference with a pointer to
   this spec (§3.3, §4). The R2 `publications` bookkeeping, if wanted, is
   `meta.json` history, not a D1 table.
4. **Publish job (T4 / LUO-19)** — implement §4 exactly: shard by
   `sha256(id)[0:2]`, bloom at `target_fp=1e-4`, `meta.json` per §4.3,
   `removed_since_prev` diff, ODbL `LICENSE-DATA` in the mirror.
5. **Classifier dedupe (debt #4 in STATUS)** — out of T1 scope, but the two
   SYSTEM prompts (`src/llm.ts`, `services/edge`) must converge on one source
   to keep `model`/verdict semantics stable; flagged for a follow-up.

---

## 8. Acceptance criteria — status

- [x] Governance doc: misjudgment/appeal/removal, scope, no-PII, license
  (AGPL/ODbL argued), transparency → §1, §2.
- [x] Curation record schema final, key = X numeric user id, with evidence
  pointer / verdict / confidence / model version / timestamp / human-review
  flag → §3.
- [x] Public artifact schema: sharded JSON + `meta.json` (version/counts) +
  membership index (bloom + hash-bucket) → §4.
- [x] Confidence thresholds + human-review gate written → §5.
- [ ] **Originator review** → pending PersonalReviewer@Will-Codex.

Open (explicitly deferred, not T1 blockers): build T4 to this spec; flip
`REQUIRE_AUTH`; converge the duplicated classifier prompt; merge/clean the
large PR#7 (per STATUS §9).
