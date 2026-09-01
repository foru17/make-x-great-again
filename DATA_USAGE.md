# Data Usage & Purpose Declaration

## What this data is

This repository publishes a **versioned, human-confirmed** blocklist of
X (Twitter) accounts that maintainers have confirmed as commercial spam or
pornographic-advertising bots, plus a small curated whitelist.

This is **not** a general-purpose reputation system, political tool, or
arbitrary blacklist. It is narrowly scoped to the exact threat model defined
in [GOVERNANCE.md](./GOVERNANCE.md).

## September 1, 2026 blacklist cleanup

By September 1, the live blacklist had grown to 223,670 entries. False
positives from AI verdicts and later bulk human confirmations were degrading
normal browsing, so we performed a two-stage, auditable cleanup:

1. We moved all 21,827 entries whose publication tier was `ai` out of the
   current blacklist and disabled direct AI publication.
2. We then rescanned all 201,912 current blacklist rows with the 72 blacklist
   rules enabled at the time. We retained only the 171,754 rows that still
   matched a rule in their persisted handle, display name, or evidence text,
   and moved the other 30,158 rows—including 28,560 historical human/bulk
   confirmations—to the recoverable `removed` state.

A second full scan after the operation found zero non-rule matches among the
171,754 remaining rows. Neither stage modified the whitelist; it contained
2,338 entries immediately before and after stage two. Historical account rows,
evidence, and mirror commits remain available as the audit trail. Current API,
R2, and `data-mirror` artifacts represent the cleaned list. New AI verdicts
remain review-only and cannot publish directly.

## Where the data lives

| Source | Path / endpoint | Freshness |
|---|---|---|
| In-repo snapshot (audit) | [`data/blacklist/v1.json`](./data/blacklist/v1.json), [`data/whitelist/v1.json`](./data/whitelist/v1.json) | mirrored from D1 every 6 hours (diff-aware; git history = audit log) |
| Live API | `https://x.zuoluo.tv/v1/list` (paginated), `/v1/whitelist` | real-time, edge-cached |
| Published artifacts (R2) | `https://x.zuoluo.tv/v1/list/meta` → `/v1/artifacts/<key>` | republished every 10 minutes; version changes only when content changes |

## Record fields (`data/blacklist/v1.json`)

Top level: `{ "schema": 1, "generatedAt": <ms>, "count": <n>, "list": [...] }`.
Each `list` entry:

| Field | Meaning | Example |
|---|---|---|
| `handle` | @handle (mutable, informational) | `"spam_bot_42"` |
| `x_user_id` | X numeric user id (immutable; may be `null` for handle-only rows) | `"348526665"` |
| `verdict_label` | `spam` / `porn_bot` / `likely_spam` / `uncertain` / `legit` | `"spam"` |
| `confidence` | 0–1 | `1` |
| `reasons` | short reasons (keyword rule or LLM rationale) | `["matched keyword rule \"...\" on display_name"]` |
| `evidence_text` | the public X text that triggered the verdict (≤240 chars) | `"已入驻约p平台:👉…"` |
| `reporters` | count of distinct verified reporters | `0` |
| `published_at` | human-confirmed timestamp (ms) | `1780896002531` |

`data/whitelist/v1.json` entries carry `handle`, `x_user_id` (nullable) and
`last_scored` (ms).

**No PII** beyond what is publicly broadcast on X. No email, IP, device
fingerprint, or private messages are collected.

## How to consume this data

### 1. Discover the current published artifacts

```bash
curl -s https://x.zuoluo.tv/v1/list/meta
```

Returns `count`, `day`, `week`, `pending`, `generatedAt`, `version`, and an
`artifacts` object (or `null` if nothing has been published yet):

```json
{
  "artifacts": {
    "bloom":  "/v1/artifacts/bloom-<version>.b64",
    "shards": "/v1/artifacts/shards-<version>.json",
    "meta":   "/v1/artifacts/meta-<version>.json"
  }
}
```

### 2. Quick check (bloom filter)

The bloom artifact is a base64-encoded bit array (65,536 bits / 8 KB,
7 hashes — parameters are also echoed in the `meta-<version>.json` artifact
as `bloomSize` / `bloomHashes`). It contains every published handle and
numeric id, so membership can be tested locally without revealing which ids
you query:

```bash
META=$(curl -s https://x.zuoluo.tv/v1/list/meta)
curl -s "https://x.zuoluo.tv$(echo "$META" | jq -r .artifacts.bloom)"
```

### 3. Full lookup (shards)

`shards-<version>.json` is a single JSON document with `version`,
`generatedAt`, `count`, `shardSize` (500 accounts per logical shard),
a `shards` map (shard name → primary keys) and an `entries` map keyed by
numeric id **and** `handle:<lowercased-handle>`, each entry carrying
`userId`, `handle`, `label`, `confidence`, `published_at`:

```bash
curl -s "https://x.zuoluo.tv$(echo "$META" | jq -r .artifacts.shards)"
```

### 4. Paginated live list

```bash
curl -s "https://x.zuoluo.tv/v1/list?limit=100"            # latest 100 (limit ≤ 100)
curl -s "https://x.zuoluo.tv/v1/list?limit=100&before=<ms>" # keyset page: strictly older
curl -s "https://x.zuoluo.tv/v1/list?limit=100&since=<ms>"  # poll: strictly newer
```

Returns full records including `reasons`, `evidence_text` and `reporters`.

### 5. Full in-repo snapshot (audit)

```bash
curl -sL https://raw.githubusercontent.com/foru17/make-x-great-again/main/data/blacklist/v1.json
```

> **Size warning**: `data/blacklist/v1.json` is currently ~18 MB and growing —
> near jsDelivr's 20 MB per-file limit, so **do not rely on jsDelivr for the
> full file**. Use raw GitHub for audits, or the API / artifact endpoints
> above for anything programmatic.

## Forking & redistribution

This repository is **AGPL-3.0 licensed**. You may fork it freely.

If you redistribute the public list as part of a network service, the AGPL
requires you to provide the corresponding source code (including any
modifications) to the users of that service. See [LICENSE](./LICENSE).

## Appeals & removals

- Open a [GitHub appeal issue](https://github.com/foru17/make-x-great-again/issues/new?template=appeal.yml)
  with the handle and reason (or `POST /v1/appeal`, rate-limited).
- A human moderator reviews the appeal.
- If upheld, the entry disappears from the next mirror sync and the next
  published artifact version (auditable via git diff).
- Historical commits remain intact; the git history is the audit trail.

## Disclaimer

This data is provided **as-is** without warranty. The maintainers make no
guarantee that every entry is correctly labeled, and the bloom filter has a
small false-positive rate. Use at your own risk and always allow human
appeal paths.
