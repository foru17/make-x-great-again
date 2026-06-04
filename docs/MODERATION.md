# Trust tiers, GitHub-gated reporting & admin moderation

Status: **implemented for the Worker/admin surface** on the existing Cloudflare
stack. The consumer extension is intentionally passive/local-list-only after
the T5/T6 rollout, so report/confirm/classify write APIs are operated by
trusted tooling/admin flows rather than exposed in the installed extension.
Extends [GOVERNANCE.md](../GOVERNANCE.md) and the Cloudflare architecture.
The design rationale below is unchanged; see **As-built (T6)**
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
| **Verified reporter** | trusted caller with a **GitHub** bearer token | `/v1/report` / `/v1/confirm`. Rate-limited & bannable per HMAC reporter fingerprint. |
| **Admin (守门员)** | maintainer allowlist | moderation panel: approve / reject / remove. |

Key move: **separate cheap public reads from costly/abusable writes.** Server
LLM classification is no longer a free anonymous endpoint.

## GitHub-gated reporting (feasible, well-trodden)

- A trusted client may use **GitHub OAuth Device Flow** (best for browser-like
  clients — no redirect-URI hassle): user clicks "用 GitHub 登录以上报" → opens
  `github.com/login/device`, enters code → the client stores the token locally.
- Worker verifies the token via `GET https://api.github.com/user`, derives
  `reporter_fp = HMAC(REPORT_SALT, "gh:<id>")`, and rate-limits per
  fingerprint. Raw GitHub ids stay in request memory only.
- `/v1/report` & `/v1/confirm` require a valid GitHub identity when
  `REQUIRE_AUTH=1` → `401` otherwise. `/v1/check` stays anonymous.
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

1. **`/v1/classify` = GitHub-authed when `REQUIRE_AUTH=1`.** Anonymous installs get
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
- The shipped consumer extension is passive and local-list-only. Its background
  script returns explicit disabled errors for `gh_start` / `gh_poll`, and there
  is no report/confirm/classify write path in normal content scanning.
- `误判?` posts anonymous `POST /v1/appeal` as a review signal. Appeals do not
  unpublish rows; admin `remove` is still the human decision point.

### Admin console (standalone, never in the extension)
- `GET /admin` serves a self-contained page (`services/edge/src/pages/admin.ts`);
  the maintainer pastes `ADMIN_TOKEN` once (kept in `localStorage`), `noindex`.
  This replaced the earlier in-plugin admin tab per the owner's 2026-05-19
  decision — the token never ships in the public extension.

### Acceptance-criteria map

| Criterion | Status | Evidence |
|---|---|---|
| AI single signal never auto-public; human signal = K GH reporters or admin | ✅ | `submitReport()` requires `reporters>=3`; `/v1/classify` writes only `auto_pending_review` |
| Anonymous read-only; reporting forces GitHub login | ✅ (gated by flag) | `requireReporter()` + `REQUIRE_AUTH`; public reads are confirmed-only; consumer extension has no write path |
| Per-reporter **rate-limit / ban** | ✅ | HMAC fingerprint dedupe + `rate_log` throughput cap + `reporter_bans` admin API |
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

### Open items (owner-timed rollout)
1. **Reporter identity storage is aligned with GOVERNANCE.md.** Report and
   confirm paths persist `HMAC(REPORT_SALT, reporter_id)` fingerprints instead
   of raw GitHub numeric ids; dedupe and reporter counts still work from the
   stable fingerprint, while exported evidence and audit logs remain unlinkable
   without the Worker secret.
2. **Legacy fingerprint backfill.** If any old `gh:<id>` reporter rows exist,
   set `REPORT_SALT`, apply `2026-06-04-reporter-bans.sql`, then call
   `POST /v1/admin/reporter-fingerprints/backfill` once before relying on
   `REQUIRE_AUTH=1`. Runtime dedupe also treats the current request's legacy
   and HMAC aliases as the same reporter to prevent double-counting during the
   transition.
3. **`REQUIRE_AUTH` flip.** This is an owner-timed production operation:
   confirm trusted write clients can supply GitHub bearer tokens, then set
   `wrangler secret put REQUIRE_AUTH` to `1`. The consumer extension remains
   read-only and is unaffected for `/v1/check` and local-list usage.
4. **`/v1/appeal` is implemented as a review signal.** Filing an appeal writes
   an `appeal_submitted` audit row and leaves the listing in place until a human
   admin decides `remove`, matching SPEC-T1's anti-delisting-abuse rule.
