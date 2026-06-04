# Deploy the Cloudflare edge service

One-time setup needs your Cloudflare auth (interactive). Steady-state
re-deploys just run `npm run deploy`.

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
`GET /v1/admin/queue` · `POST /v1/admin/decide` · `GET /v1/admin/log`

## Governance

D1 is the source of truth. `POST /v1/classify` only ever writes
`auto_pending_review` — an AI verdict is never public. `/v1/check` and
`/v1/list` return **only** `human_confirmed` rows. A row becomes
`human_confirmed` solely via human action (`/v1/admin/decide` approve or
`/v1/confirm`/`/v1/report` once 3 distinct GitHub reporters agree). No PII
beyond the public numeric id.

`/v1/appeal` queues a human removal review and does not unpublish by itself.
Reporter identities are stored as HMAC fingerprints derived from `REPORT_SALT`;
`rate_log` caps report/confirm signals per fingerprint per hour.
