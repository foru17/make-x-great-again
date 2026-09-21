# Changelog

All notable changes to Make X Great Again (MXGA) are documented here.

This project follows a pragmatic [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
style. Version numbers refer to the browser extension package unless noted
otherwise.

## [Unreleased]

### Added

- iOS / iPadOS 18+ Safari Web Extension container with a SwiftUI setup guide,
  Simulator build script, shared MV3 resources, and iPhone/iPad icons.
- Touch-first badge popovers plus an iOS hamburger drawer, single-column dashboard cards,
  and responsive Safari popup/options layouts for compact screens.
- A shared optional Xcode signing configuration that injects local Team settings into all
  Apple platform targets without committing developer credentials.
- Opt-in AI 判定 with the user's own TypeSafe Jev key: reply-section accounts that miss the
  public list, cache and official rules are judged once on-device (one request of typed
  questions — verdict, category, redirect bait, escort copy, legitimate commerce — mapped to
  a verdict by calibrated-probability thresholds in code). Hits ride the rule-hit auto-action
  path (reply sections only, auto tier under `autoTierMode`); results are cached per account
  and never published. The `api.typesafe.ai` host permission is requested only on enable.

### Changed

- Consolidated the macOS and iOS containers and Safari extensions into one Xcode project with
  four platform-specific targets; deployment baselines are now macOS 15 and iOS 18.
- Safari's in-page blacklist index now retains compact lite rows and expands display data only
  on a hit, reducing the measured retained heap for the current 134k snapshot from roughly
  55 MB to 32 MB per page context.

## [0.5.0] - 2026-07-18

The public store release: the 2026-06-10 v0.5 rewrite (documented below in
this same section) plus this pre-release hardening pass.

### Pre-release hardening

- **Tiered auto-processing for auto-published list entries**
  (`autoTierMode`): the 2026-07 hard line made ALL auto-published (AI/rule/
  mention) list hits mark-only — but 90%+ of the live list is auto tier, so
  自动处理 was a no-op against the actual reply wave, and an account got
  WEAKER handling after being listed than the same keyword rule would have
  applied before. Restores the product line "on the public list =
  auto-processable" (precision enforced at the publish source: the AI lane
  only auto-publishes the high-precision porn_bot class). New three-level
  setting: 完整执行 (default — full per-category policy) / 封顶为自动隐藏
  (reversible local hide only; X mute/block stays human-confirmed-only) /
  仅标记 (most conservative). Bubble rows now carry a 人工确认/自动收录
  chip so the per-row treatment is legible.
- **自动展开开关**：new setting 自动处理时展开面板 (`autoExpand`, default on =
  previous behavior). When off, auto-processing no longer pops the bubble card
  open — the pill's pulse is the only signal. Recommended off on narrow /
  mobile viewports where the card covers the timeline.
- **Stale action verb on rendered badges**: changing 手动处理方式 in the
  options page now updates every already-rendered badge and the bubble's
  batch button in open tabs. Previously they kept the old verb (e.g. 隐藏)
  while a click executed the new mode (e.g. 拉黑).
- **v0.4 legacy detection cache no longer outranks the synced list**: a stale
  cached verdict could mask a since-human-confirmed blacklist hit for up to
  30 days, and the cache path skipped the whitelist entirely — appealed
  accounts kept their red badge. Whitelist now short-circuits first and the
  list is consulted before the cache.
- **Manual mute/block failures are recorded honestly**: when X's native
  action fails, the 处理记录 row is annotated (X 动作失败，仅本地隐藏), same
  as the auto path.
- Content-script memory: anchors are now kept only for hit accounts instead
  of every scanned author, removing unbounded growth during long
  infinite-scroll sessions.
- Removed dead v0.4 code: the unused local keyword heuristic (`heuristic()`,
  vocabulary regexes) and the disconnected GraphQL user-cache module. Neither
  had any caller since the v0.5 rewrite; detection remains list/rule/LLM
  driven with no hardcoded keyword judgments.

### Added

- New **处理方式 (action mode)** setting controlling what clicking "隐藏" does
  to a flagged account, with three options:
  - **本地隐藏 (local)** — the default. Pure on-device visual hide
    (`display:none` + a local hidden-list in `chrome.storage`); X is never
    contacted, and the action is reversible from the options page.
  - **X 静音 (mute)** — opt-in. Calls X's own first-party
    `POST /i/api/1.1/mutes/users/create.json` using the user's existing X
    session (the page's `ct0` CSRF cookie + X's public web bearer). One-way:
    the user stops seeing the account; it is not notified; the follow
    relationship is unchanged.
  - **X 拉黑 (block)** — opt-in. Calls X's own first-party
    `POST /i/api/1.1/blocks/create.json` the same way. Mutual block: breaks
    the follow relationship and hides both users from each other.
- The mute/block requests go **only** to x.com — they never touch our backend
  and collect/transmit no data to us or any third party (the user acts on
  their own account via X's own API).
- A global rate-limit queue for the X actions (`extension/lib/x-action.ts`):
  cross-tab serialization via Web Locks, ~1.2s spacing + jitter, periodic
  cooldowns (every 45 / 120 actions) and 429 back-off, to reduce the risk of
  tripping X's automation heuristics during bulk cleanup.
- Mode-aware UI: the 5-second undo badge and bubble show the active mode's verb
  (隐藏 / 静音 / 拉黑).

### Changed

- The extension is **local-first**: the public blacklist and whitelist are
  downloaded from the official service and cached for local matching. The
  background checks every six hours using `alarms`; list requests upload no
  page content, account identity, scan result, or action history.
- The x.com host permission is now **optional** and **runtime-requested**:
  declared as `optional_host_permissions` (Chrome) / `optional_permissions`
  (Firefox) and requested via `chrome.permissions.request` only when the user
  switches to mute or block mode. A fresh install requests nothing; deny →
  stays in local mode.
- "拉黑" was renamed to "隐藏" across the UI. The local hide/record always
  happens regardless of mode (so the row stays gone across navigation); for
  mute/block the X action rides on top via the user's own session. The
  5-second undo window still applies in every mode.
- "误判申诉" now opens the GitHub appeal issue template in a new tab instead
  of POSTing to the edge service.
- Scheduled jobs were split: R2 artifact publishing runs every 10 minutes
  (content-derived versions, so nothing new is published when the list is
  unchanged), while the GitHub `data/` mirror runs only every 6 hours.

### Removed

- The MAIN-world content script (`x-graphql-main.content.ts`) and all
  fetch/XHR patching.

### Added after the initial 0.5 cut

- GitHub Device Flow was restored solely for self-service whitelist
  applications. It requests the GitHub host permission at runtime; routine
  protection remains login-free.
- Dead settings that never did anything: `replyAuto`, `autoBlockListHits`,
  `autoExpandOnFinding`.

### Security

- Badge popover rendering escapes all model/list-derived text, hardening the
  prompt-injection → innerHTML path.
- Delayed hides re-verify the captured article anchor still belongs to the
  same author before hiding (X recycles article nodes), preventing the wrong
  row from being hidden.
- Edge admin auth (`ADMIN_TOKEN`) comparison is now timing-safe.
- `/v1/classify` is rate-limited (20/h per identity, or per-IP fingerprint
  when anonymous); `/v1/appeal` is rate-limited (5/h per IP) with per-handle
  daily dedupe. Both fail closed (503) when `REPORT_SALT` is unset.
- Reporter identity storage is fingerprint-only: salted HMAC fingerprints,
  mandatory salt, and an admin backfill endpoint
  (`POST /v1/admin/reporter-fingerprints/backfill`) for legacy raw `gh:<id>`
  rows.

### Fixed

- Un-hide from the options page now actually restores hidden accounts.
- Blacklist compilation drops handle-only entries (handle reuse trap),
  entries with unsupported labels, and duplicates by numeric id — only
  verified numeric `x_user_id` rows ship in the bundled list, with evidence
  text stripped.
- Published artifact versions/keys are URL-safe, so `/v1/artifacts/*` URLs
  advertised by `/v1/list/meta` no longer 404; `/v1/list/meta` no longer 500s
  when the `publications` table is missing.
- Public-list bloom filters are now sized from the actual entry count
  (the fixed default was tuned for 10k entries and useless at 46k), and the
  classify cache key covers every signal the model sees, so changed
  follower counts / thread context invalidate cached verdicts.
- Content-script memory leaks: per-page state (pending hides, anchors,
  findings) is flushed on SPA navigation, scan loops are bound to the script
  context, and cheap handle extraction avoids per-node fiber walks.

## [0.4.0] - 2026-05-28

### Added

- Silent blocking through X's first-party `blocks/create.json` endpoint, replacing
  the old simulated click + native confirmation flow.
- Background block queue with pacing, cross-tab coordination, retry cooldowns,
  and per-row states for queued, active, done, and failed blocks.
- Expanded bubble queue UI: animated pending list, progress bar, stable four-cell
  status summary, and per-account pending/blocking indicators.
- Batched public-list lookup via `/v1/check?ids=...` to reduce extension-to-edge
  request volume on spam-heavy threads while preserving the old single-id lookup.
- GitHub Device Flow deep-linking from the popup to the settings tab, plus a
  boxed verification code with one-click copy.
- Public landing trend endpoint (`/v1/list/trends`) and D1 index migration for
  published-list time-window charts.
- Side-channel agent moderation pipeline:
  - `/v1/agent/queue`, `/v1/agent/decide`, `/v1/agent/stats`
  - agent staging statuses: `agent_blacklist`, `agent_whitelist`, `agent_pending`
  - admin review tabs and promotion actions for agent decisions.

### Changed

- Auto-blocking now uses a visible background queue rather than blocking the
  user on native X confirmation dialogs.
- The bubble top summary is fixed to `命中 / 正在 / 待拉 / 已拉` so progress
  changes do not resize the panel.
- Public-list and local-cache auto-block hits no longer re-submit redundant
  `confirm_spam` reports after a successful block.
- Block pacing was tuned to reduce wait time while still avoiding bursty X API
  traffic.
- The options page login route now supports `?tab=settings&login=1` and direct
  `?tab=` / `#settings` deep links.
- MAIN-world GraphQL capture no longer forwards X Authorization headers through
  page-visible events; silent block uses the fixed public X web bearer.

### Fixed

- Stale side-channel agent decisions can no longer downgrade rows already handled
  by a human/admin path. `/v1/agent/decide` now requires the row to still be in
  `auto_pending_review` and returns `409 stale_agent_decision` otherwise.
- `agent_attempts` now represents failed agent attempts only; successful agent
  decisions reset the counter, and runner failures populate `agent_error`.
- Agent `requeue` now clears agent annotations and resets retry state so the item
  is actually visible to the next queue fetch.
- Admin agent single and batch promotion actions now handle HTTP/network errors,
  refresh the list, and avoid stuck half-completed UI states.
- GitHub login from the popup no longer lands on the options overview tab before
  starting the login flow.

### Notes

- Chrome Web Store upload artifact:
  `extension/.output/mxga-extension-0.4.0-chrome.zip`
- Server operators should apply
  `services/edge/migrations/2026-05-28-public-trends.sql` before relying on the
  trends endpoint at larger public-list sizes.

## [0.3.0] - 2026-05-26

### Added

- MAIN-world X GraphQL response capture for stronger user identity resolution.
- Viewer-scoped filtering for self, followed, muted, blocked, or follow-requested
  accounts.
- Optional auto-blocking for already-confirmed public-list/local-cache spam hits
  (`autoBlockListHits`, default off).
- Light-theme UI pass, per-row selection for bulk block, and async report/block
  state handling.
- UID-detection regression tests.

### Changed

- Identity resolution now cross-checks GraphQL `rest_id`, JSON-LD, follow-button
  test IDs, React fiber data, and avatar IDs before trusting a numeric X ID.
- Admin branding switched from a generic shield to the Xiaolan mascot.

### Fixed

- Escaped model/user-derived text before rendering in content-script HTML,
  reducing prompt-injection-to-innerHTML risk.
- Service and extension both short-circuit viewer-scoped ignored accounts.

## [0.2.0] - 2026-05-25

### Added

- Initial Chrome MV3 extension for passive X account scanning.
- Cloudflare Worker + D1 backend with `/v1/classify`, `/v1/check`,
  `/v1/report`, `/v1/confirm`, `/list`, and `/admin`.
- Public blacklist/whitelist snapshots in `data/`.
- GitHub Device Flow authentication for reporting and anti-abuse accounting.
- Admin review queue, public list, whitelist, and audit log.

[0.5.0]: https://github.com/foru17/make-x-great-again/releases/tag/v0.5.0
[0.4.0]: https://github.com/foru17/make-x-great-again/releases/tag/v0.4.0
[0.3.0]: https://github.com/foru17/make-x-great-again/releases/tag/v0.3.0
[0.2.0]: https://github.com/foru17/make-x-great-again/releases/tag/v0.2.0
