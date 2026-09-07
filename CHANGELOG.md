# Changelog

All notable changes to Make X Great Again (MXGA) are documented here.

This project follows a pragmatic [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
style. Version numbers refer to the browser extension package unless noted
otherwise.

## [Unreleased]

_Nothing yet._

## [0.6.1] - 2026-09-06

The false-positive release. The 2026-09-04 audit (eight upheld appeals,
ten audited mislabels among the latest fifty spam verdicts, an 80%-noise
review queue) traced most misfires to input the classifier never received,
verdicts that outlived their withdrawal, and rule hits promoted blind. 0.6.1
closes each of those paths, adds a user-owned whitelist that outranks
everything, and ships the MAIN-world profile bridge that 0.6.0 missed.

### Added

- **Local whitelist** (设置 → 白名单): the user's own never-touch list,
  highest priority of the whole chain — accounts on it are never badged,
  rule-matched, sent for online detection or auto-processed, even when the
  public list or an official rule says spam. Followed accounts join
  automatically (`followingWhitelist`, default on) as they scroll past:
  every standalone post in the home **Following** feed (reposts, thread-pair
  parents and replies excluded), any author X's own profile object marks as
  followed (fiber bridge), and the viewer's own /following page; any handle
  can be added from the badge popover (加入白名单) or the options tab. Local
  storage only, never uploaded.
- The fiber/bridge reader understands X's 2025 GraphQL user shape (`core`,
  `relationship_perspectives`, `verification`, `location`, `avatar`) as
  well as the legacy one — without this the bridge found no user at all on
  current X.
- **MAIN-world profile bridge** (`x-bridge.content.ts`): a page-world script
  reads the author profile X already holds in its React state and stamps it
  onto the article as a DOM attribute, so the isolated content script can
  send uid / bio / follower counts / account age (92% of live payloads had
  none of them). Read-and-annotate only — no network requests, no page
  globals touched. Disclosed in PRIVACY A.4.
- **Rendering context** sent with every online check: `surface`
  (home/thread/profile/search), `isReply`, `replyToHandle`,
  `rootAuthorHandle` — the classifier's reply-section-bot vs own-timeline
  boundary was undecidable from a bare tweet.
- **Profile facts** X already holds: verified, post / media / like counts,
  location, and X's own default-avatar flag (the DOM heuristic flagged real
  avatars that failed to lazy-load; the prompt now trusts only the profile
  source).
- **Template repeats**: a local, hash-only, 14-day memory of each author's
  recent comments reports how many earlier times this browser saw the same
  text — the cross-thread repetition the prompt asks for and never got.
  Only the count leaves the device.
- **Profile pages** now send the account's own visible posts as history
  (the profile path used to send no text at all).
- **举报 asks which kind of spam first** (category chips, two taps); the
  claim travels with the report and seeds the queued row's category.
- **Rule-hit telemetry carries evidence**: which field matched and a
  ≤200-char excerpt of the spam account's own text (server-verified to
  contain the pattern), shown in the admin drill-down before promotion.
  Disclosed in PRIVACY A.4b and the settings copy.
- **Backup & migration** (设置 → 备份): export the user's own local data
  (settings, local whitelist, custom / disabled rules, hidden accounts +
  处理记录, local stats, optionally the detection cache) to a JSON file and
  import it on another browser — merge (union lists, sum counters) or
  replace per section, with a content preview first. The file never
  contains the GitHub login or the synced public lists; import validates
  every field and can only write those known keys.
- **Frozen classifier eval set** (`docs/eval/cases.json`, 42 cases) and an
  offline runner with a hard call cap; the 0.6.1 prompt scores 42/42.
- **In-page UI acceptance harness** (`scripts/ui-acceptance/inpage`): real
  build on simulated X pages, three X themes × two viewports.

### Fixed

- **Withdrawn verdicts resurfaced**: `/v1/classify` served the original spam
  verdict for accounts a moderator had removed or whose report was rejected,
  and the client re-cached it for 30 days — every appeal you won stayed red
  in your own browser. The edge now serves the withdrawal as legit; the
  client folds removed / rejected / whitelisted into a clean verdict,
  overwrites the stale cache entry, and re-checks day-old cached spam.
- **Fabricated repetition**: the article path copied the tweet text into
  both `triggeringComment` and `recentTweets[0]`; the model read two
  identical strings as "posts the same thing repeatedly" (#371).
- **Uncertain verdicts badged**: an "uncertain 40%" red mark was a
  user-visible false positive (#367); uncertain and low-confidence
  likely_spam now stay silent.
- **Rule hits could fire X mute/block**: local keyword-rule hits (a
  substring match with zero review) are now capped at the reversible local
  hide in every autoTierMode; X mute/block stays for published list entries.
- **Spam cache lived 30 days across all later tweets**: 7 days now, and
  reused across new tweets only while fresh or when the client cannot
  re-check.
- **UI followed the OS scheme, not X's theme**: X's Default / Dim / Lights
  out are chosen in-app; a light OS with X in Lights out got grey ghost
  badges and slate popover text on black. The page's real background now
  decides, restamped when X switches theme.
- Desktop bubble pill sat on the right end of X's pinned search box; the
  two-character 误判 link in bubble rows could split across lines.

### Service (deployed 2026-09-06, x.zuoluo.tv, version 943b8b34)

- Review-queue split: legit at any confidence → `auto_legit`, uncertain →
  new `auto_unsure` (3-day TTL, never listed, rule-overridable, rescanned
  by scope:'all' sweeps); only spam-family labels queue. 80% of the queue
  was non-spam labels burying the real false positives.
- Prompt: repetition means distinct posts; one ordinary sentence with
  missing profile data is not spam; context and profile-fact semantics;
  avatar caveat keyed to provenance.
- `rule_hit_stats` gained `field` / `sample_text` (migration
  `2026-09-06-rule-hit-evidence.sql`); `/v1/report` accepts
  `reportCategory`; `/v1/classify` accepts the new context / profile /
  template-repeat fields.

## [0.6.0] - 2026-08-14

The contribution-funnel release. v0.5's passive zero-remote architecture
quietly starved the shared spam-collection pipeline (users upgraded off the
always-classify ≤0.4 builds while `/v1/classify` went GitHub-gated), so 0.6
rebuilds the contribution loop through explicit, privacy-bounded channels —
and fixes a silent whitelist truncation that had dropped false-positive
protection for 3/4 of the whitelisted accounts.

### Added

- **Detection-rules panel** (设置 → 检测规则): inspect the synced official
  keyword rules (pattern / matched field / category), flip a master switch,
  or disable individual rules — rule behavior is finally visible and
  controllable from the UI instead of being an invisible engine.
- **Custom local rules**: author your own keyword rules (field + category)
  that run with the same whitelist-first and translate-guard semantics as
  official rules. Stored only on this machine; never uploaded, never part of
  telemetry.
- **Anonymous rule-hit telemetry** (default on, one switch to off, disclosed
  in PRIVACY A.4b): when an official rule catches a spam account locally,
  the extension reports only {matched pattern, spam account handle, its
  public numeric id, category} — no user identity, no page content. Deduped
  per (rule, account) for 7 days, batched ≤50 every 30 minutes. Server-side
  the rows land in an isolated stats table that cannot create queue or list
  entries; a maintainer explicitly reviews and promotes accounts into the
  normal review queue from the admin console.
- **Contribution status card** (概览): logged-out users see exactly what
  GitHub login enables (online AI detection + one-click reporting) with a
  direct login CTA; logged-in users see a live status line and their local
  contribution counters.
- **Online AI detection**: after GitHub login, accounts that miss the local
  list, cache and rules are automatically submitted to `/v1/classify`
  (≤40 per page, 3 concurrent, verdicts cached locally); clean results stay
  visually silent instead of badging every checked account.
- **举报为 spam**: one-click GitHub-authenticated report into the public
  review queue, sent from the background worker so x.com's CSP/CORS can't
  block it.
- **Manual action ladder + prefilled appeal**: the badge popover exposes the
  full 仅标记/本地隐藏/X 静音/X 拉黑 ladder per account, and 误判申诉 opens a
  GitHub issue template prefilled with the account's identity.
- iOS / iPadOS 18+ Safari Web Extension container with a SwiftUI setup
  guide, Simulator build script, shared MV3 resources, and iPhone/iPad
  icons; touch-first badge popovers, an iOS hamburger drawer and responsive
  Safari popup/options layouts; a shared optional Xcode signing config that
  keeps local Team settings out of the repo.

### Fixed

- **Whitelist truncation (critical)**: `/v1/whitelist` served a default page
  of 500 rows while the whitelist had grown past 2000, and the client stored
  that first page as the complete set — silently dropping false-positive
  protection for every account whitelisted since late July. The server-side
  default page now exceeds the full set (already-deployed clients heal on
  their next 6h sync), and the client now walks the since/limit cursor to a
  short page with a hard page fuse.
- Interrupted auto-processing (tab close, SPA navigation mid-queue) no
  longer records actions that never fired as 已处理; pending X actions are
  re-attempted on the next load.
- Auto-processing hides the real tweet instantly; the collapse animation
  plays only in the bubble, not on the page DOM fighting X's virtualizer.
- Profile-page badge hide-target resolution, pending-timer cleanup, and
  badge-popover anchoring/closing fixes.
- The whitelist self-service page renders the real membership state instead
  of offering an application to already-whitelisted accounts.
- Firefox: consent compatibility baselines, background sync receiver gaps,
  absent content styles, live account surfaces, and online-detection
  disclosure preserved through the data-permission flow.

### Changed

- 处理记录 persists across SPA navigations and hard reloads, scoped to the
  session so a fresh visit to X no longer replays the previous session's
  history into the bubble.
- Options-panel terminology and layout pass: the four-action vocabulary
  (仅标记 / 本地隐藏 / X 静音 / X 拉黑) is now identical between manual and
  automatic settings, and official keyword-rule hits count toward the
  autoTierMode cap exactly like auto-published list entries.
- Safari's in-page blacklist index retains compact lite rows and expands
  display data only on a hit (~55 MB → ~32 MB retained heap per page
  context on the 134k snapshot); the macOS and iOS containers are one Xcode
  project with four platform targets (baselines macOS 15 / iOS 18).

### Service (deployed 2026-08-14, x.zuoluo.tv)

- `POST /v1/rule-hits` telemetry ingest: pattern must match a currently
  enabled blacklist rule, per-IP salted-fingerprint rate limit, 50k rows/day
  fuse, and a hard wall between the stats table and the moderation surface.
- Admin console: rule-hit review workbench (per-rule aggregates, per-account
  drill-down, explicit 提审 into the review queue) and a 共建活跃 dashboard
  (`/v1/admin/contrib`) tracking daily distinct contributors by channel —
  the metric for whether the login-narrative work moves the needle.
- `/v1/whitelist` gained the larger default page plus an explicit edge cache
  keyed by query string.

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
