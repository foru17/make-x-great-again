# Side-channel agent pipeline

> Status: **alpha** · landed 2026-05-27 · reference impl: Hermes on a mac
> mini using xAI Grok-4.3 via OAuth · runner code in
> [`services/agent-runner/`](../services/agent-runner) ·
> Worker endpoints in [`services/edge/src/index.ts`](../services/edge/src/index.ts)
> under `// Side-channel AGENT pipeline`.

## What this is

A side-channel mechanism that lets a maintainer plug their own AI agent
into MXGA's moderation pipeline as a **second-opinion reviewer**. The
agent polls the admin queue, performs deeper investigation than the
in-Worker LLM can (live X data access, multi-step reasoning, etc.), and
files structured verdicts back.

Crucially:

- **Extension users notice nothing.** The agent writes to private staging
  statuses; the public list (`status='human_confirmed'`) and the
  official whitelist (`status='whitelisted'`) are unchanged.
- **The governance red line holds.** `GOVERNANCE.md` says AI alone never
  auto-publishes. The agent decision endpoint can only write private
  staging statuses while the row is still in `auto_pending_review`; stale
  agent decisions return `409 stale_agent_decision` instead of overwriting
  a human/admin decision.
- **Plug-in friendly.** Anyone can write a runner that talks to the two
  endpoints described below. Hermes is one possible runner; Claude/Codex
  on a server, GPT-4o on a Cloudflare durable object, your own Python
  script — all equally welcome.

## Architecture

```
                  ┌──────────────────────────────────────────────┐
                  │  Cloudflare Worker (x.zuoluo.tv)              │
                  │                                                │
                  │  D1.accounts ───── (annotate + status flip)    │
                  │       ▲                                        │
   GET /v1/agent/queue    │   POST /v1/agent/decide                │
                  │       │                                        │
                  └───────┼────────────────────────────────────────┘
                          │ Bearer <AGENT_TOKEN>
                          │ X-Agent-Id: <runner-id>
                          │
                  ┌───────┴───────────────────────────┐
                  │  Runner host (your box)            │
                  │  - cron / launchd / hermes cron    │
                  │  - calls your LLM/agent of choice  │
                  │  - parses verdict → routes         │
                  └────────────────────────────────────┘
```

## Statuses

| Status                | Meaning                                              | Who can write                       | On public list? |
| --------------------- | ---------------------------------------------------- | ----------------------------------- | --------------- |
| `auto_pending_review` | Fresh from in-Worker LLM, waiting on a reviewer      | Worker                              | no              |
| `agent_blacklist`     | Side-channel agent confidently says spam — staged    | Agent (via `/v1/agent/decide`)      | **no**          |
| `agent_whitelist`     | Side-channel agent says legit — staged               | Agent                               | **no**          |
| `agent_pending`       | Agent saw it but abstained ("待定")                  | Agent                               | no              |
| `human_confirmed`     | Maintainer-approved spam — on the public list        | Human admin                         | **yes**         |
| `whitelisted`         | Maintainer-approved legit                            | Human admin                         | (positive list) |
| `rejected`            | Maintainer rejected                                  | Human admin                         | no              |
| `removed`             | Was public, unpublished by admin                     | Human admin                         | no              |
| `auto_legit`          | In-Worker LLM said legit                             | Worker                              | no              |

Promoting `agent_blacklist` → `human_confirmed` is **always** a human
action in the current alpha. The agent does the boring screening; the
maintainer does the publishing.

## D1 schema additions

See [`migrations/2026-05-27-agent-pipeline.sql`](../services/edge/migrations/2026-05-27-agent-pipeline.sql).
TL;DR: the `accounts` table gets `agent_*` annotation columns plus
`last_decided_by` / `last_decided_at` denormalized fields so the admin UI
can filter by decision source cheaply.

The existing `review_log` table handles the audit trail — every agent
decision is logged with `actor='agent:<agent_id>'`.

## API

Both endpoints take `Authorization: Bearer <AGENT_TOKEN>` and
`X-Agent-Id: <runner-id>`. `AGENT_TOKEN` is a wrangler secret separate
from `ADMIN_TOKEN`; the runner host stores it in a `chmod 600` file.

### `GET /v1/agent/queue?limit=<N>`

Returns up to `N` (default 30, max 100) `auto_pending_review` rows the
agent hasn't yet scored — or has scored against a stale `signals_hash`.
Sorted `last_scored DESC`. `agent_attempts < 3` caps retries on chronic
agent failures; successful agent decisions reset this counter to 0.

```jsonc
{
  "agent_id": "hermes",
  "queue": [
    {
      "x_user_id": "20591…",
      "handle": "george510658027",
      "display_name": "…",
      "verdict_label": "porn_bot",      // in-Worker LLM's verdict
      "confidence": 0.92,
      "reasons": "[…]",                  // json string
      "evidence_text": "…",
      "last_scored": 1685000000000,
      "signals_hash": "abc123…",
      "agent_id": null,                  // null = never scored by an agent
      "agent_signals_hash": null,
      "agent_attempts": 0
    }
    // …
  ]
}
```

### `POST /v1/agent/decide`

Writes the agent's verdict and (optionally) transitions the row to an
agent-tier staging status. Idempotent: re-posting with the same
`signals_hash` is safe; the Worker's queue filter will skip the item next
time.

```jsonc
{
  "handle": "george510658027",
  "x_user_id": "20591…",       // optional but strongly recommended

  // What the agent recommends doing with this row:
  //   "blacklist" → status becomes agent_blacklist
  //   "whitelist" → status becomes agent_whitelist
  //   "pending"   → status becomes agent_pending
  //   "annotate"  → status untouched; only agent_* columns updated
  "decision": "blacklist",

  "label": "porn_bot",          // one of: spam | porn_bot | likely_spam | uncertain | legit
  "confidence": 0.95,
  "reasons": ["P1 bio promotes escort wording", "P2 templated emoji replies"],
  "signals": ["P1", "P2", "P3"],          // codes from the framework (or your own)
  "evidence": {                            // free-form object, persisted as JSON
    "account_age_days": 12,
    "follower_count": 0,
    "x_status": "active",
    "link_domains": ["t.co"]
  },
  "action": "approve_block",     // one of: approve_block | reject_legit | needs_human
  "model": "grok-4.3",           // free-form model identifier
  "signals_hash": "abc123…",     // echo back the one from /queue
  "error": "parse_or_timeout",    // optional; only for failure annotations
  "notes": "Account bio explicitly promotes 同城上门 services …"
}
```

The Worker:
1. Updates the row only if it is still `status='auto_pending_review'`
   (and, when supplied, still matches the posted `signals_hash`).
   Otherwise it returns `409 stale_agent_decision` and writes nothing.
2. Writes all `agent_*` columns and `last_decided_by='agent:<agent_id>'`.
   On failure annotations, also stores `agent_error`.
3. Flips `status` if `decision != "annotate"` (and not into a
   public-tier status — those writes are rejected at the type level).
4. Inserts one `review_log` row with
   `actor='agent:<agent_id>'`, `action='agent_<decision>'`.
5. Bumps `agent_attempts` only for failed annotate attempts; successful
   decisions reset it to 0.

Returns `{ok:true, agent_id, status: "agent_blacklist" | … | "(annotate-only)"}`.

### `GET /v1/agent/stats`

Quick health check for dashboards / cron self-test. Returns per-status
counts of agent-curated rows, top decision-sources, and decisions in the
last 24h.

## Implementing your own runner

A runner is anything that can:
1. Hit `GET /v1/agent/queue` periodically.
2. Run *some* analysis per handle. Could be a hosted LLM, a local
   Ollama, a manual Telegram-bot pipeline, a deterministic Python
   classifier — anything.
3. POST the verdict to `/v1/agent/decide` in the shape above.

Suggested guardrails (the reference Hermes runner enforces all of these):

- **Single-instance lock** so overlapping cron ticks don't double-process.
- **Daily budget cap** to bound API/compute cost.
- **Per-item timeout** (`subprocess.run(..., timeout=)`) so one stuck
  call doesn't burn the whole cycle.
- **JSON parse fixup** for occasional malformed model output (trailing
  `}` / markdown fences).
- **Local JSONL log** per day for offline auditing — the Worker's
  `review_log` records the decision, but your raw model output isn't
  stored server-side.

### Decision routing policy (reference)

```yaml
blacklist_conf_min: 0.90   # confidence floor for agent_blacklist
whitelist_conf_min: 0.85   # confidence floor for agent_whitelist
pending_when_unsure: true  # else leave in auto_pending_review
annotate_only_when_uid_missing: true
```

Tune these for your tolerance — higher floors send more rows to
`agent_pending` (human reviews more, agent reviews less).

## Reference runner: Hermes + Grok-4.3

Located in [`services/agent-runner/`](../services/agent-runner):

- `prompt.tmpl` — the framework prompt (P1–P6 hard positives, S1–S6 soft,
  L1–L4 KOL exemptions, N1–N4 follower tightening, A1–A3 aborts).
- `run.py` — one-cycle runner (lock, fetch queue, parallel
  `hermes -z PROMPT --yolo` per handle, POST verdict).
- `policy.yaml` — confidence thresholds (above).

## Budgeted batch runner: OpenAI-compatible

`services/agent-runner/run_batch_openai.py` is the fail-closed path for
large queue cleanups:

- one logical cycle fetches at most 100 accounts;
- it shares one compact policy across provider-safe sub-batches of 10, so a
  cycle makes at most ten model calls;
- dry-run is the default; only `APPLY_DECISIONS=1` enables writes;
- writes land only in private agent staging statuses. `reject` becomes
  `agent_whitelist`, `blacklist` becomes `agent_blacklist`, and `pending`
  becomes `agent_pending`; the runner never publishes directly;
- a blacklist recommendation is downgraded unless it has a spam/porn label,
  confidence >= 0.95, and a hard evidence code;
- non-porn accounts with `following_count > 100000` are routed out of the
  pending queue;
- response IDs must match the input IDs exactly once, usage must be present
  before apply, parse failures are capped at two, and per-cycle input/output
  token ceilings stop later sub-batches;
- concurrent `409 stale_agent_decision` responses are skipped and counted,
  rather than aborting the remaining safe writes.

Config additions in the runner `.env`:

```sh
AGENT_ID=batch-openai-v2
AGENT_LLM_BASE_URL=https://api.openai.com/v1
AGENT_LLM_API_KEY=<secret>
AGENT_LLM_MODEL=<model-id>
PROMPT_FILE_BATCH_OPENAI=/path/to/prompt_batch_openai.tmpl
MAX_ITEMS_PER_CYCLE=100
LLM_SUB_BATCH_SIZE=10
MAX_INPUT_TOKENS_PER_CYCLE=30000
MAX_OUTPUT_TOKENS_PER_CYCLE=10000
MAX_PARSE_FAILURES=2
APPLY_DECISIONS=0
```

Run tests and one dry-run cycle:

```sh
cd services/agent-runner
python3 -m unittest -v test_batch_review.py test_run_batch_openai.py
python3 run_batch_openai.py
```

Inspect the single JSON result, then set `APPLY_DECISIONS=1` only for an
approved cycle. Promotion from agent staging remains a separate maintainer
action.

### Install on a Mac mini

```sh
# 1. Drop the runner files
ssh mac-mini
mkdir -p ~/.hermes-jobs/x-spam-agent/logs
cd ~/.hermes-jobs/x-spam-agent
cp /path/to/x-spam-sentinel/services/agent-runner/{prompt.tmpl,run.py,policy.yaml} .
chmod +x run.py

# 2. Drop secrets (NEVER paste these into chat)
cat > .env <<'EOF'
WORKER_URL=https://x.zuoluo.tv
AGENT_TOKEN=<paste from `wrangler secret list` rotated value>
AGENT_ID=hermes
HERMES_BIN=/Users/luolei/.local/bin/hermes
PROMPT_FILE=/Users/luolei/.hermes-jobs/x-spam-agent/prompt.tmpl
POLICY_FILE=/Users/luolei/.hermes-jobs/x-spam-agent/policy.yaml
MAX_ITEMS_PER_CYCLE=20
MAX_PARALLEL=8
DAILY_BUDGET=300
PER_ITEM_TIMEOUT_S=180
LOG_DIR=/Users/luolei/.hermes-jobs/x-spam-agent/logs
EOF
chmod 600 .env

# 3. Wire up scheduling via hermes cron (uses the long-running gateway)
hermes gateway install      # one-time, makes cron jobs actually fire
hermes cron create '15m' \
  --name x-spam-agent \
  --no-agent \
  --script /Users/luolei/.hermes-jobs/x-spam-agent/run.py

# 4. Sanity-check on one tick
hermes cron run x-spam-agent
tail -n 5 ~/.hermes-jobs/x-spam-agent/logs/$(date -u +%F).jsonl
```

### Wrangler side

```sh
cd services/edge

# new wrangler secret
npx wrangler secret put AGENT_TOKEN
# generate a strong opaque token; e.g.:
#   python3 -c "import secrets; print(secrets.token_urlsafe(48))"

# migration
npx wrangler d1 execute xss-db --remote \
  --file=migrations/2026-05-27-agent-pipeline.sql

# deploy
pnpm deploy
```

## Operating notes

- **Watch `/v1/agent/stats` for a few hours after deploy.** A healthy
  cycle moves single-digit-to-low-tens of items; if you see hundreds
  in `agent_pending` and zero in the blacklist/whitelist staging
  buckets, your thresholds are too strict or your prompt is failing
  to parse.
- **Rotate `AGENT_TOKEN` if a runner host is compromised.** The token
  is independent of `ADMIN_TOKEN`; rotating it doesn't lock you out of
  /admin.
- **Multiple agents can coexist.** Use distinct `X-Agent-Id` values
  (e.g., `hermes`, `claude-laptop`, `gpt-vps`). The last one to POST
  on a given handle wins; review_log preserves the full sequence.
- **Suspended-account drift cleanup.** Reference runs show ~75% of the
  current `agent_pending` bucket is X-already-banned accounts the
  blacklist hasn't archived. A simple periodic sweep that archives
  agent_pending items with `x_status='suspended'` is a planned
  follow-up.

## What's intentionally not in scope

- **Auto-promote to public list.** Out of scope by governance.
- **Cross-agent consensus.** Currently last-write-wins. If you run
  multiple agents and want quorum, that lives in your runner, not the
  Worker.
- **Per-agent rate limiting.** Not enforced server-side yet. Trust the
  `AGENT_TOKEN` holder; back-channel agreement on `DAILY_BUDGET`.
