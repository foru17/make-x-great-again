# Data Usage & Purpose Declaration

## What this data is

The `public-list/` directory contains a **minimal, versioned, human-reviewed**
blocklist of X (Twitter) accounts that have been confirmed by human moderators
as commercial spam or pornographic-advertising bots.

This is **not** a general-purpose reputation system, political tool, or
arbitrary blacklist. It is narrowly scoped to the exact threat model defined
in [GOVERNANCE.md](../GOVERNANCE.md).

## What fields are present

| Field | Meaning | Example |
|---|---|---|
| `id` | X numeric user id (immutable) | `"123456789"` |
| `h` | @handle (mutable, informational) | `"spam_bot_42"` |
| `v` | verdict — `spam` or `porn_bot` | `"spam"` |
| `c` | confidence 0–1 | `0.97` |
| `r` | 1–6 short reasons | `["link spam", "no original tweets"]` |
| `t` | human-confirmed timestamp (ms) | `1779681234000` |

**No PII** beyond what is publicly broadcast on X. No email, IP, device
fingerprint, or private messages are collected.

## How to consume this data

### 1. Quick check (bloom filter)

Download the tiny `index.json` (bloom filter, ~12 KB for 10k entries) and
test membership locally without revealing which ids you query:

```bash
curl -sL https://cdn.jsdelivr.net/gh/foru17/make-x-great-again@latest/public-list/data/index.json
```

### 2. Full lookup (shard)

If the bloom filter says *probably present*, fetch the exact shard:

```bash
# Hash the user id to a 2-hex bucket (FNV-1a mod 256)
BUCKET=$(node -e "let h=2166136261;for(const c of '123456789'){h^=c.charCodeAt(0);h+=(h<<1)+(h<<4)+(h<<7)+(h<<8)+(h<<24)}console.log((Math.abs(h|0)%256).toString(16).padStart(2,'0'))")
curl -sL "https://cdn.jsdelivr.net/gh/foru17/make-x-great-again@latest/public-list/data/shards/${BUCKET}.json"
```

### 3. Meta / versioning

```bash
curl -sL https://cdn.jsdelivr.net/gh/foru17/make-x-great-again@latest/public-list/data/meta.json
```

Returns `version`, `generatedAt`, `count`, `shardCount`, and `sourceCommit`.

## Forking & redistribution

This repository is **AGPL-3.0 licensed**. You may fork it freely.

If you redistribute the public list as part of a network service, the AGPL
requires you to provide the corresponding source code (including any
modifications) to the users of that service. See [LICENSE](../LICENSE).

## Appeals & removals

- Open a [GitHub issue](https://github.com/foru17/make-x-great-again/issues/new)
  with the handle and reason.
- A human moderator reviews the appeal.
- If upheld, the entry disappears from the **next** release (auditable via git
diff between tags).
- Historical commits remain intact; the git history is the audit trail.

## Disclaimer

This data is provided **as-is** without warranty. The maintainers make no
guarantee that every entry is correctly labeled, and the bloom filter has a
small false-positive rate (~1%). Use at your own risk and always allow human
appeal paths.
