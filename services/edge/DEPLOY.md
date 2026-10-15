# Deploy the Cloudflare edge service

One-time setup needs your Cloudflare auth (interactive). Before a production
redeploy, identify the current deployed version and use its production source
as the baseline; development and production branches have existing differences.
The 2026-10-15 release is version
`b8d315ca-0a7c-413c-a239-1fc19fa06112`, built from `70971ed` on
`codex/agent-auto-blacklist-production-2026-10-15`. Preserve earlier production
hotfixes, confirm the budget alert, and preserve remote variables when deploying.

## 1. Authenticate

Option A — interactive:

    cd services/edge && npx wrangler login

Option B — API token (Workers + D1 + Workers Routes + Zone read):

    export CLOUDFLARE_API_TOKEN=...

## 2. Provision (first time only)

    npm install
    npx wrangler d1 create xss-db                # paste database_id into wrangler.toml
    npm run db:init:remote                        # apply schema.sql to remote D1

Set the four required secrets — the project never holds the LLM provider
URL / model in plaintext (so the repo stays publishable):

    npx wrangler secret put LLM_API_BASE     # any OpenAI-compatible /chat/completions base
    npx wrangler secret put LLM_API_MODEL    # model id
    npx wrangler secret put LLM_API_KEY      # bearer token
    npx wrangler secret put ADMIN_TOKEN      # /admin gate
    npx wrangler secret put REPORT_SALT      # HMAC salt for reporter fingerprints

Optional:

    npx wrangler secret put REQUIRE_AUTH     # "1" => /v1/classify requires GH login

## 3. Custom domain (already wired in `wrangler.toml`)

`routes = [{ pattern = "x.zuoluo.tv", custom_domain = true }]`.

The parent zone (`zuoluo.tv`) must be active on this Cloudflare account
and the API token needs `workers_routes:write` + `zone:read` (both present
by default for the personal account).

## 4. Deploy

    npm run deploy
    # → https://x.zuoluo.tv     (workers.dev URL still works as a fallback)

Before enabling reporter bans or a `REQUIRE_AUTH=1` rollout, apply the reporter
ban migration and backfill any legacy `gh:<id>` fingerprints:

    npx wrangler d1 execute xss-db --remote --file=./migrations/2026-06-04-reporter-bans.sql
    curl -X POST https://x.zuoluo.tv/v1/admin/reporter-fingerprints/backfill \
      -H "x-admin-token: $ADMIN_TOKEN"

## 5. Point the extension at it

The extension defaults to `BRAND.edgeBase` (= `https://x.zuoluo.tv`) via
`extension/lib/brand.ts`. Override in `Settings → 高级 · 服务端地址` for
local / staging.

`/v1/health` returns `{ ok: true, published: <count> }`.

## Endpoints

`GET /` (landing) · `GET /list` (public board, polls /v1/list) ·
`GET /admin` (gated by ADMIN_TOKEN, never ships in the consumer extension)

`GET /v1/health` · `GET /v1/check?ids=` (public, human_confirmed only, edge cached) ·
`POST /v1/classify` · `POST /v1/confirm` · `POST /v1/report` ·
`POST /v1/appeal` ·
`GET /v1/list?limit&before&since` · `GET /v1/list/meta` ·
`GET /v1/admin/queue` · `POST /v1/admin/decide` · `GET /v1/admin/log` ·
`GET/POST/DELETE /v1/admin/reporter-bans`

## Governance

D1 is the source of truth. `AI_AUTO_PUBLISH_ENABLED=0` keeps first-pass AI
promotion disabled. Independently, `AGENT_AUTO_BLACKLIST_ENABLED=1` permits
authenticated second-opinion Agent blacklist recommendations to publish at
confidence >=0.90 with a recognized hard signal, stored original evidence,
matching hashes, and the identity/whitelist/human-decision guards documented
in `docs/AGENT.md`. These rows use `published_tier='ai'` with Agent provenance.
`/v1/list` includes published rows; `/v1/check` remains human-tier-only for
legacy clients. Public artifacts distinguish automatic and human entries.
No personal information beyond the public numeric id or canonical handle is
added by this path.

`/v1/appeal` queues a human removal review and does not unpublish by itself.
Reporter identities are stored as HMAC fingerprints derived from `REPORT_SALT`;
`rate_log` caps report/confirm signals per fingerprint per hour, and
`reporter_bans` blocks abusive fingerprints before any effective signal is
written.
