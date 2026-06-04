# Trust tiers, GitHub-gated reporting & admin moderation

Status: **implemented** (server + extension + admin console shipped on the
existing Cloudflare stack). Extends [GOVERNANCE.md](../GOVERNANCE.md) and the Cloudflare
architecture. The design rationale below is unchanged; see **As-built (T6)**
at the end for what actually shipped, the acceptance-criteria map, the
verification points, and the two items still open for owner decision.

## Why (threat model)

The moderation design protects three high-risk surfaces:

1. **LLM-cost abuse** — `/v1/classify` holds the server LLM key; anyone can
   burn it.
2. **Report/defamation abuse** — anonymous `/v1/report` can be weaponized to
   mass-list innocent accounts.
3. **Public-list integrity** — needs a real gatekeeper before anything goes
   public.

## Trust tiers (the core idea)

| Tier | Who | Can do |
|---|---|---|
| **Anonymous** | any installed extension | **read only**: `/v1/check`, fetch public list/bloom. Cheap, cacheable, no abuse surface. Local heuristic + local cache still work. |
| **Verified reporter** | signed in with **GitHub** | `/v1/report`. Rate-limited & bannable *per GitHub account*. |
| **Admin (守门员)** | maintainer allowlist | moderation panel: approve / reject / remove. |

Key move: **separate cheap public reads from costly/abusable writes.** Server
LLM classification is no longer a free anonymous endpoint.

## GitHub-gated reporting (feasible, well-trodden)

- Extension uses **GitHub OAuth Device Flow** (best for extensions — no
  redirect-URI hassle): user clicks "用 GitHub 登录以上报" → opens
  `github.com/login/device`, enters code → extension stores the token in
  `chrome.storage`.
- Worker verifies the token via `GET https://api.github.com/user`, derives
  `reporter_fp = HMAC(REPORT_SALT, "gh:<id>")`, and rate-limits per
  fingerprint. Raw GitHub ids stay in request memory only.
- `/v1/report` & `/v1/confirm` require a valid GitHub identity → `401`
  otherwise. `/v1/check` stays anonymous.
- Cost: a free GitHub OAuth App.

## Report → AI → auto / queue → admin (the gatekeeper pipeline)

```
GitHub-verified report → D1 reports(pending)
        │
        ▼  server re-classifies (Worker → LLM) + counts independent GH reporters
   ┌────────────────────────────────────────────────┐
   │ AI = spam/porn_bot, high conf (≥0.9)            │
   │   AND ≥ K independent GitHub reporters          │ → AUTO-confirm → public
   ├────────────────────────────────────────────────┤
   │ anything else (疑似 / low corroboration / AI    │ → ADMIN QUEUE
   │ unsure)                                         │   (human decides)
   └────────────────────────────────────────────────┘
        │
        ▼  Admin panel: approve → public · reject → dropped · remove → unpublish
```

### Governance reconciliation

GOVERNANCE.md says an AI verdict is never enough by itself. The policy line is:
**the human signal = K independent GitHub-verified reporters or a maintainer
review.** AI-high-confidence plus real corroborating humans may be promoted by
policy, while AI alone never auto-publishes. Borderline cases stay in the
admin queue.

## Admin moderation panel (守门员)

- A protected web page (Worker-served or static + Worker API). Auth =
  maintainer GitHub-login allowlist (or Cloudflare Access).
- Queue view: account + AI verdict/confidence + evidence (signals snapshot)
  + #reporters; actions **通过 / 驳回 / 移除**, writes `review_log`.
- D1 stores `accounts`, `reports`, `review_log`; status transitions and admin
  endpoints keep the public list auditable.

## Implementation summary

| Piece | Notes |
|---|---|
| GitHub Device-Flow auth (ext) + Worker verify | Standard browser-extension login path |
| Gate `/v1/report` `/v1/confirm` by GitHub id | Prevents anonymous report abuse |
| Protect `/v1/classify` from anonymous abuse | Keeps LLM cost bounded |
| Report→AI re-score + review queue | Worker + D1 |
| Admin moderation panel + admin auth | Maintainer-only review surface |

All on the existing Cloudflare stack.

## Current policy

1. **`/v1/classify` = GitHub-authed only.** Anonymous installs get
   read-only public list (`/v1/check`) + local heuristic + local cache.
   Server-side AI classification requires GitHub login. The server LLM key
   is never an anonymous endpoint. (UX implication: not-logged-in users
   don't get fresh AI verdicts on brand-new accounts — only known-list hits
   + local heuristic. Logging in with GitHub unlocks AI analysis. This is
   the accepted security trade-off.)
2. **Auto-publish = AI ≥ 0.9 AND ≥ 3 independent GitHub reporters.**
   Everything else → admin review queue. AI alone never auto-publishes
   (governance red line intact; the 3 real GitHub reporters are the human
   signal). K=3 is a tunable policy knob.

---

## As-built (T6) — what actually shipped

The pipeline above is implemented end-to-end. File pointers are the live
code on `main`.

### Server (`services/edge/src/index.ts`)
- **Identity** — `ghIdentity()` verifies the bearer token via
  `GET https://api.github.com/user`; write paths persist only
  `HMAC(REPORT_SALT, "gh:<id>")` as `reports.reporter_fp`.
  `requireReporter()` enforces it **only when `REQUIRE_AUTH=1`**; with the
  flag off (current default) a missing token resolves to `"anon"` so the
  already-shipped anonymous extension keeps working. `Env.REQUIRE_AUTH` is a
  Worker secret (`wrangler secret put REQUIRE_AUTH`).
- **Tiers** — `/v1/check`, `/v1/list`, `/v1/list/meta`, `/` and `/list`
  are public and return **only `human_confirmed`** rows. `/v1/classify`,
  `/v1/report`, `/v1/confirm` go through `requireReporter()` → `401
  github_login_required` when auth is enforced.
- **Auto/queue rule** — `submitReport()`: dedupes one report per
  `(target, reporter)` via `INSERT OR IGNORE`, counts
  `DISTINCT reporter_fp`, and only sets `human_confirmed` when
  `AUTO_CONF=0.9` **and** `AUTO_REPORTERS=3` are both met; otherwise
  `auto_pending_review`. `/v1/classify` **only ever** writes
  `auto_pending_review` — an AI verdict is never public on its own.
- **Admin (守门员)** — `GET /v1/admin/queue`, `POST /v1/admin/decide`
  (`approve` / `reject` / `remove`), `GET /v1/admin/log` (keyset-paginated
  audit trail). Gated by the `x-admin-token` header against the
  `ADMIN_TOKEN` secret. Every decision writes `review_log`.

### Extension (consumer, no admin surface)
- GitHub **Device Flow** login in the background service worker
  (`extension/entrypoints/background.ts`: `ghStart` → `login/device/code`,
  `ghPoll` → `access_token` → `GET /user`). Token + login stored via
  `extension/lib/auth.ts` (`chrome.storage.local`), public client id
  `GH_CLIENT_ID` is a build constant (device flow has no secret).
- `authedPost()` attaches `Authorization: Bearer <token>` to `/v1/classify`
  and `/v1/confirm`. Login UI lives in `extension/entrypoints/options/App.tsx`.

### Admin console (standalone, never in the extension)
- `GET /admin` serves a self-contained page (`services/edge/src/pages/admin.ts`);
  the maintainer pastes `ADMIN_TOKEN` once (kept in `localStorage`), `noindex`.
  This replaced the earlier in-plugin admin tab per the owner's 2026-05-19
  decision — the token never ships in the public extension.

### Acceptance-criteria map

| Criterion | Status | Evidence |
|---|---|---|
| AI single signal never auto-public; human signal = K GH reporters or admin | ✅ | `submitReport()` requires `reporters>=3`; `/v1/classify` writes only `auto_pending_review` |
| Anonymous read-only; reporting forces GitHub login | ✅ (gated by flag) | `requireReporter()` + `REQUIRE_AUTH`; public reads are confirmed-only |
| Per-reporter **rate-limit / ban** | ⚠️ **partial** | HMAC fingerprint dedupe + `rate_log` throughput cap ship; ban list remains a follow-up — see Open #1 |
| `/v1/classify` no longer a free anonymous endpoint | ✅ (gated by flag) | `requireReporter()` on the route |
| Admin panel: pull queue, see evidence, approve/reject/remove + `review_log` | ✅ | `/v1/admin/*` + `/admin` page |
| All on existing Cloudflare stack, no new infra | ✅ | Worker + D1 only |
| Written to docs/MODERATION.md + conclusions | ✅ | this section |

### Verification points
- `services/edge`: `npm run typecheck` (tsc `--noEmit`) passes clean.
  CI gate (PR #8) runs typecheck/test/build for core, extension, edge.
- Behavior verified earlier on the deployed Worker (see issue history):
  3 anonymous reports on one target → `reporters=1`, not auto-published;
  `/v1/admin/queue` returns 403 without the token, the pending queue with it.

### Open items (need owner decision — NOT blockers for T6 server/ext)
1. **Reporter ban list is not implemented yet.** Current abuse controls are
   `(target, reporter_fp)` dedupe plus a `rate_log` sliding-window cap, but a
   maintainer still cannot ban a bad reporter fingerprint/GitHub identity from
   the Worker. That follow-up is tracked in LUO-62.
2. **Reporter identity storage is now aligned with GOVERNANCE.md.** Report and
   confirm paths persist `HMAC(REPORT_SALT, reporter_id)` fingerprints instead
   of raw GitHub numeric ids; dedupe and reporter counts still work from the
   stable fingerprint, while exported evidence and audit logs remain unlinkable
   without the Worker secret.
3. **`REQUIRE_AUTH` flip.** Server + extension login both shipped, so the
   flag can be turned on (`wrangler secret put REQUIRE_AUTH` = `1`) once a
   GitHub-login-capable extension build is published to users. Until then it
   stays off to avoid breaking installed anonymous clients. Ops step, owner-timed.
4. **`/v1/appeal` is implemented as a review signal.** Filing an appeal writes
   an `appeal_submitted` audit row and leaves the listing in place until a human
   admin decides `remove`, matching SPEC-T1's anti-delisting-abuse rule.
