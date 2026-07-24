import { hideAccountSurface, restoreAccountSurfaces } from "../lib/account-surface";
import { autoEligible, capAutoTierAction } from "../lib/auto-policy";
import {
  BLOCKED_KEY,
  addBlocked,
  isBlockedSync,
  warm as warmBlocklist,
} from "../lib/blocklist";
import { BRAND } from "../lib/brand";
import { type Cached, cacheGet, signalsHash } from "../lib/cache";
import {
  extractFromArticle,
  extractProfile,
  extractThreadTopic,
  viewerHandle,
} from "../lib/detect";
import { CATEGORY_ZH } from "../lib/category";
import { LIST_KEY, WL_KEY } from "../lib/list-sync";
import { type IndexEntry, isWhitelisted, lookupLocal, warmLocalIndex } from "../lib/local-index";
import { matchLocalRules } from "../lib/local-rules";
import {
  OnlineClassificationLimiter,
  classifyAndCache,
  onlineVerdictVisibility,
  shouldAutoClassify,
} from "../lib/online-detection";
import {
  type ActionMode,
  type CategoryAction,
  type Settings,
  getSettings,
  onSettingsChange,
  setSetting,
} from "../lib/settings";
import { bumpStat } from "../lib/stats";
import {
  type PendingXAction,
  addBlockRecord,
  addPendingAction,
  bumpStats,
  clearPendingAction,
  getPendingActions,
  updateBlockRecord,
} from "../lib/store";
import type { Signals, Verdict } from "../lib/types";
import {
  type BadgeSource,
  type Finding,
  STYLE,
  createActingBadge,
  createAnalyzingBadge,
  createBadge,
  createBubble,
  createCheckedMarker,
} from "../lib/ui";

/** "误判申诉" — opens the GitHub appeal issue template, PRE-FILLED with the
 *  account's handle / user id / title so the user only writes the reason and
 *  submits. Zero remote requests from the extension itself; the appeal is
 *  filed on GitHub (the template field ids are handle / userid). */
function openAppeal(appeal?: { handle: string; userId?: string }): void {
  let url = BRAND.appealNewIssue;
  if (appeal?.handle) {
    const p = new URLSearchParams();
    p.set("handle", `@${appeal.handle}`);
    if (appeal.userId) p.set("userid", appeal.userId);
    p.set("title", `[Appeal] @${appeal.handle} wrongly listed`);
    url += `&${p.toString()}`;
  }
  window.open(url, "_blank", "noopener");
}

/** Cap on how many interrupted (queue-died) X-actions we resume per load, so a
 *  huge backlog can't fire a burst of X calls at once. The global x-action
 *  lock still paces each one; anything beyond the cap settles on later loads. */
const RESUME_MAX = 50;

/** Report an unlisted account to the public review queue. GitHub-authed
 *  contribution: the token gates who can report (server enforces a 90-day
 *  account-age floor, 10/hour rate limit, one-vote-per-target dedup, reporter
 *  bans, and — auto-publish being off — every report just queues for a
 *  maintainer to confirm). The extension only surfaces the outcome; it never
 *  auto-lists anything. Returns a short line for the popover to show inline. */
async function reportSpam(sig: Signals): Promise<{ ok: boolean; message: string }> {
  // The POST runs in the BACKGROUND (see BgRequest "report"): a content-script
  // fetch to the edge Worker is bound by x.com's CORS/CSP; the SW shares the
  // extension origin the whitelist-apply flow already reports from.
  let resp:
    | { ok: boolean; error?: string; data?: { status: number; body: ReportBody } }
    | undefined;
  try {
    resp = await chrome.runtime.sendMessage({ type: "report", sig });
  } catch {
    return { ok: false, message: "网络错误，举报未提交" };
  }
  if (!resp || !resp.ok) {
    if (resp?.error === "no_token") {
      try {
        chrome.runtime.sendMessage({ type: "open_options" });
      } catch {
        /* best-effort */
      }
      return { ok: false, message: "举报需先在设置页用 GitHub 授权（已为你打开设置）" };
    }
    return { ok: false, message: "网络错误，举报未提交" };
  }
  const { status, body } = resp.data ?? { status: 0, body: {} as ReportBody };
  if (status >= 200 && status < 300 && body.ok) {
    if (body.duplicate) return { ok: true, message: "你已举报过该账号，感谢" };
    if (body.status === "whitelisted")
      return { ok: true, message: "该账号已被官方列入白名单，举报已忽略" };
    if (body.status === "viewer_ignored")
      return { ok: true, message: "这是你自己的账号，举报已忽略" };
    return { ok: true, message: "已举报，进入人工审核队列，感谢贡献" };
  }
  switch (status) {
    case 401:
      try {
        chrome.runtime.sendMessage({ type: "open_options" });
      } catch {
        /* best-effort */
      }
      return { ok: false, message: "GitHub 授权已失效，请在设置页重新授权" };
    case 403:
      return { ok: false, message: "你的举报权限已被限制" };
    case 429:
      return { ok: false, message: "举报过于频繁，请稍后再试" };
    case 503:
      return { ok: false, message: "服务暂未就绪，请稍后再试" };
    default:
      return { ok: false, message: "举报失败，请稍后重试" };
  }
}

interface ReportBody {
  ok?: boolean;
  status?: string;
  duplicate?: boolean;
  error?: string;
}

function articleOf(node: Element | null): HTMLElement | null {
  return (node?.closest("article") as HTMLElement) ?? null;
}

/** User-facing verb for the configured action mode. */
function actionVerb(mode: ActionMode): string {
  return mode === "block" ? "拉黑" : mode === "mute" ? "静音" : "隐藏";
}

/** How many spam categories currently escalate beyond "badge" — shown as the
 *  hint next to the bubble's 自动处理 switch. */
function autoCategoryCount(s: Settings): number {
  return Object.values(s.categoryActions).filter((a) => a !== "badge").length;
}

/** Fire X's native mute/block (best-effort, paced) with one retry. The local
 *  hide/record is applied separately and always — the X call rides on top.
 *  Returns false only when the native X action definitively failed (used by
 *  the bubble's batch panel to surface a per-row 重试 state). */
async function applyXAction(mode: ActionMode, sig: Signals): Promise<boolean> {
  if (mode === "local") return true;

  // Load the mutation client only after the user explicitly chooses a native
  // X action and grants the optional host permission.
  const { performXAction, retryDelayForAttempt } = await import("../lib/x-action");
  const attempt = await performXAction(mode, sig.userId, sig.handle);
  if (attempt.ok) return true;
  const delay = retryDelayForAttempt(attempt, 1);
  if (delay > 0) {
    await new Promise((r) => setTimeout(r, delay));
    const second = await performXAction(mode, sig.userId, sig.handle); // one best-effort retry
    return second.ok;
  }
  return false;
}

/** Cheap author handle from the User-Name link href — no fiber walk, no
 *  innerText. Used both as the scan() skip key and to re-verify a captured
 *  anchor before a delayed hide fires (X recycles article nodes). */
function handleFromArticle(art: HTMLElement): string | undefined {
  const nameBlock = art.querySelector<HTMLElement>('[data-testid="User-Name"]');
  if (!nameBlock) return undefined;
  for (const a of nameBlock.querySelectorAll<HTMLAnchorElement>('a[href^="/"]')) {
    const s = (a.getAttribute("href") ?? "").split("/").filter(Boolean);
    if (s.length === 1 && /^[A-Za-z0-9_]{1,15}$/.test(s[0] ?? "")) return s[0];
  }
  return undefined;
}

/** Where a scanned account was seen. Auto actions are scoped by this:
 *  - "reply"   — a NON-focal article on a status page: someone replying under
 *                a tweet. This is where the spam wave lives → auto-actable.
 *  - "feed"    — the account's own post in a timeline / search / the focal
 *                tweet itself. Detect + badge only under the default scope.
 *  - "profile" — the profile header on the account's own page. Badge only. */
type ScanContext = "reply" | "feed" | "profile";

/** Status id of the tweet the current page is focused on, or null when not
 *  on a /user/status/<id> page. */
function focalStatusId(): string | null {
  const m = location.pathname.match(/^\/[^/]+\/status\/(\d+)/);
  return m?.[1] ?? null;
}

/** Status id of an article, read from its timestamp permalink. Null when the
 *  article carries no <time> link (fail-safe → treated as non-reply). */
function articleStatusId(art: HTMLElement): string | null {
  for (const a of art.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]')) {
    if (!a.querySelector("time")) continue;
    const m = (a.getAttribute("href") ?? "").match(/\/status\/(\d+)/);
    if (m?.[1]) return m[1];
  }
  return null;
}

/** Each inline badge gets its own shadow host so X CSS can't touch it. */
function mountBadge(anchor: HTMLElement, build: () => HTMLElement) {
  const host = document.createElement("span");
  host.className = "xss-mount";
  // The profile header's UserName block is a flex container with the default
  // align-items:stretch — an unpinned host (and the badge inside it, via the
  // host's own default stretch) inflates to the full two-line row height and
  // renders as a giant capsule. Pin both axes to content size.
  host.style.cssText =
    "display:inline-flex;align-items:center;align-self:center;vertical-align:middle;flex:none;";
  const sr = host.attachShadow({ mode: "open" });
  const st = document.createElement("style");
  st.textContent = STYLE;
  sr.append(st, build());
  anchor.appendChild(host);
}

function clearMounts(anchor: HTMLElement) {
  anchor
    .querySelectorAll(":scope > .xss-mount, :scope > .xss-pending")
    .forEach((n) => n.remove());
}

// ---- 5-second preview undo queue (PENDING_MS) ----
const PENDING_MS = 5000;

interface PendingAction {
  key: string;
  sig: Signals;
  anchor: HTMLElement;
  timer: ReturnType<typeof setTimeout>;
  ts: number;
  /** Per-action override of settings.actionMode — the popover's secondary
   *  隐藏 button schedules a local-only hide even when the mode is block. */
  mode?: ActionMode;
  /** Triggering tweet, captured while the DOM anchor is still alive —
   *  lands in the 处理记录 audit trail. */
  tweetId?: string;
  tweetText?: string;
}

export default defineContentScript({
  matches: ["https://x.com/*", "https://twitter.com/*"],
  // STYLE is mounted explicitly inside createShadowRootUi below. "manual"
  // prevents WXT from fetching an unbuilt content.css on Firefox.
  cssInjectionMode: "manual",
  async main(ctx) {
    let bubbleApi: ReturnType<typeof createBubble> | null = null;
    let dismissed = false;
    const anchorByKey = new Map<string, HTMLElement>();
    const nodeHandle = new WeakMap<HTMLElement, string>(); // virtualization-safe
    let findings: Finding[] = [];
    const pendingActions = new Map<string, PendingAction>();
    const inFlight = new Set<string>(); // keys currently in process()
    const hitPublicSeen = new Set<string>(); // hitPublic stat: once per account
    const onlineClassificationLimiter = new OnlineClassificationLimiter();
    let autoClassificationsStarted = 0;
    let onlineAuthenticated = false;

    let settings = await getSettings();
    if (!settings.enabled) return; // master off → don't init (applies next load)
    // Build marker — confirms which content-script build is live in this tab
    // (reloading the unpacked extension does NOT refresh already-open tabs).
    console.info("[MXGA] content script ready · build 2026-07-31 (v0.5.1-online-ai)");
    onSettingsChange((s) => {
      const modeChanged = s.actionMode !== settings.actionMode;
      settings = s;
      // Keep the bubble's 自动处理 switch + hint in sync (options page or
      // another tab may have flipped it).
      bubbleApi?.setAutoProcess(s.autoProcess, autoCategoryCount(s), s.autoScope === "all");
      bubbleApi?.setAutoExpand(s.autoExpand);
      if (modeChanged) {
        // Mounted badges rendered the OLD verb into their buttons, but a
        // click executes the CURRENT actionMode — a button reading 隐藏 must
        // never actually 拉黑. Sync the bubble's label and drop every
        // non-pending badge so the next scan re-renders with the real verb.
        bubbleApi?.setVerb(actionVerb(s.actionMode));
        for (const host of document.querySelectorAll<HTMLElement>(".xss-mount")) {
          if (host.shadowRoot?.querySelector(".xss-badge.pending")) continue;
          host.remove();
        }
        scan();
      }
    });

    // Warm local data structures
    await warmBlocklist();
    await warmLocalIndex();

    async function refreshOnlineAuth(): Promise<boolean> {
      const before = onlineAuthenticated;
      try {
        const response = (await chrome.runtime.sendMessage({ type: "auth_status" })) as {
          ok?: boolean;
          data?: { authenticated?: boolean };
        };
        onlineAuthenticated = response?.ok === true && response.data?.authenticated === true;
      } catch {
        onlineAuthenticated = false;
      }
      return before !== onlineAuthenticated;
    }
    await refreshOnlineAuth();

    const keyOf = (s: Signals) => s.userId || `h:${s.handle}`;

    /** Schedule a hide action with a 5-second undo window. `mode` overrides
     *  settings.actionMode for this one action (popover 隐藏 → "local"). */
    function scheduleHide(key: string, sig: Signals, anchor: HTMLElement, mode?: ActionMode) {
      if (pendingActions.has(key)) return; // already pending
      // Tag the row so executeHide can still find it if X recycles the node.
      const art = articleOf(anchor);
      art?.setAttribute("data-xss-key", key);
      const tweetId = art ? articleStatusId(art) : null;
      const tweetText = sig.triggeringComment || sig.recentTweets[0];
      const timer = setTimeout(() => {
        try {
          void executeHide(key, sig).catch(() => {});
        } finally {
          pendingActions.delete(key);
          // The undo window has settled even if X recycled the target or a
          // synchronous DOM lookup failed. Never leave a permanent "5秒后"
          // badge claiming an action is still pending.
          clearMounts(anchor);
        }
      }, PENDING_MS);
      pendingActions.set(key, {
        key,
        sig,
        anchor,
        timer,
        ts: Date.now(),
        ...(mode ? { mode } : {}),
        ...(tweetId ? { tweetId } : {}),
        ...(tweetText ? { tweetText } : {}),
      });
      // Update UI to show pending state
      badgeForPending(anchor, sig, mode);
    }

    /** Cancel a pending hide action (user clicked undo). */
    function cancelPending(key: string) {
      const pending = pendingActions.get(key);
      if (!pending) return;
      clearTimeout(pending.timer);
      pendingActions.delete(key);
      articleOf(pending.anchor)?.removeAttribute("data-xss-key");
      // Restore the badge to its previous state
      clearMounts(pending.anchor);
    }

    /** Execute the action (after the preview window expires, or immediately
     *  from the bubble's batch panel). The local record + visual hide always
     *  happen (so the row stays gone across navigation); if the user opted
     *  into "mute"/"block", X's native action rides on top via the user's
     *  own session (best-effort, paced). Everything up to the X call runs
     *  synchronously; the returned promise resolves once the native action
     *  settled (true = local-only mode or X action succeeded). */
    function executeHide(key: string, sig: Signals): Promise<boolean> {
      const pend = pendingActions.get(key);
      const mode = pend?.mode ?? settings.actionMode;
      // Triggering-tweet audit trail: prefer what scheduleHide captured live,
      // else the finding (bubble batch path — pending already cleared).
      const fin = findings.find((x) => (x.userId || `h:${x.handle}`) === key);
      const tweetId = pend?.tweetId ?? fin?.tweetId;
      const tweetText = pend?.tweetText ?? fin?.snippet;
      void addBlocked(key);
      if (sig.userId) void addBlocked(sig.userId);
      void addBlockRecord({
        id: key,
        handle: sig.handle,
        ...(sig.displayName ? { displayName: sig.displayName } : {}),
        ...(sig.avatarUrl ? { avatarUrl: sig.avatarUrl } : {}),
        ...(tweetId ? { tweetId } : {}),
        ...(tweetText ? { tweetText } : {}),
        source: "manual",
        ts: Date.now(),
      });
      void bumpStats({ blocks: 1 });
      void bumpStat("blocked");
      // X recycles article nodes: only hide via the captured anchor if it
      // still belongs to this account; otherwise use the tagged row, else
      // abort the DOM hide (the block itself is already recorded).
      const anchor =
        pendingActions.get(key)?.anchor ?? anchorByKey.get(key) ?? null;
      const art = articleOf(anchor);
      const sameAuthor =
        !!art && handleFromArticle(art)?.toLowerCase() === sig.handle.toLowerCase();
      // Profile badges are not inside an article. Their captured UserName
      // anchor is still the authoritative target; hideAccountSurface resolves
      // it to the profile header. Article anchors retain the author/recycling
      // guard before falling back to the tagged row.
      const target =
        sameAuthor || (!!anchor && !art)
          ? anchor
          : document.querySelector(`[data-xss-key="${CSS.escape(key)}"]`);
      if (target) hideAccountSurface(target, key);
      // If this account is a live bubble finding (a listed hit the user chose
      // to handle from the badge popover rather than the batch panel), drive
      // its row to "done" so it stops offering an actionable button and joins
      // the 已处理 record — otherwise the row stalls at "待处理" forever and is
      // dropped on the next SPA navigation.
      bubbleApi?.markManual(key, actionVerb(mode));
      // Track the not-yet-fired X action so a mid-batch navigation/reload can
      // resume it rather than leave the account locally-hidden-only (same
      // guarantee as the auto queue). Local mode makes no X call — skip.
      if (mode === "mute" || mode === "block") {
        void addPendingAction({ id: key, handle: sig.handle, action: mode, ts: Date.now() });
      }
      // Mirror the auto path: when the native X action fails, the 处理记录
      // row must say so — the user clicked 拉黑/静音 and only got a local
      // hide, and the record is the one place that can state it honestly.
      return applyXAction(mode, sig).then((ok) => {
        if (mode === "mute" || mode === "block") void clearPendingAction(key);
        if (!ok) {
          void updateBlockRecord(key, {
            reason: `手动${actionVerb(mode)}（X 动作失败，仅本地隐藏）`,
          });
        }
        return ok;
      });
    }

    function badgeForPending(anchor: HTMLElement, sig: Signals, mode?: ActionMode) {
      clearMounts(anchor);
      const verb = actionVerb(mode ?? settings.actionMode);
      mountBadge(anchor, () => {
        const el = document.createElement("span");
        el.className = "xss-badge pending";
        el.innerHTML = `<span style="color:var(--warn)">⏳ 5秒后${verb}</span>
          <button data-undo style="margin-left:6px;padding:1px 6px;border:1px solid var(--warn);background:transparent;color:var(--warn);border-radius:4px;font-size:10px;cursor:pointer">撤销</button>`;
        el.querySelector("[data-undo]")?.addEventListener("click", (e) => {
          e.stopPropagation();
          cancelPending(keyOf(sig));
        });
        return el;
      });
    }

    // ---- Visible auto-processing queue (the v0.4 爽感 path) ----
    // Auto hits do NOT vanish silently: each account is queued and worked
    // ONE AT A TIME — in-place pulsing "拉黑中" badge on the tweet, live
    // queued→processing→done row states in the bubble (which auto-opens),
    // then an animated collapse of the cell. The decision itself is recorded
    // up-front, so only the theater is deferred, never the protection.
    const AUTO_MIN_ACT_MS = 900; // every item is visibly "worked" this long
    const AUTO_SETTLE_MS = 240; // beat between items (v0.4: 180ms)
    // Roster-first: the page scan surfaces hits one by one, so the sweep
    // waits out a short gather window — the bubble fills with 排队中 rows
    // FIRST, then the cleanup walks through them. Capped so a trickle of
    // late hits can't stall the start forever.
    const AUTO_GATHER_MS = 1600;
    const AUTO_GATHER_MAX_MS = 4000;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    interface AutoItem {
      key: string;
      sig: Signals;
      action: CategoryAction;
      verb: string;
      anchor: HTMLElement;
      verdict: Verdict;
      categoryZh: string;
      tweetId?: string;
    }
    const autoQueue: AutoItem[] = [];
    // Keys owned by the queue — step 0's insta-hide must spare the cell the
    // animation is (about to be) playing on.
    const autoActing = new Set<string>();
    let autoDraining = false;

    function mountActing(anchor: HTMLElement, verb: string, queued: boolean) {
      clearMounts(anchor);
      mountBadge(anchor, () => createActingBadge(verb, queued));
    }

    /** X recycles article nodes: trust the captured anchor only while it
     *  still renders this account, else fall back to the tagged row. */
    function autoTarget(it: AutoItem): HTMLElement | null {
      const art = articleOf(it.anchor);
      const same =
        !!art && handleFromArticle(art)?.toLowerCase() === it.sig.handle.toLowerCase();
      if (same) return it.anchor;
      return document.querySelector<HTMLElement>(
        `[data-xss-key="${CSS.escape(it.key)}"]`,
      );
    }

    function enqueueAuto(it: AutoItem) {
      if (autoActing.has(it.key)) return;
      autoActing.add(it.key);
      // Record FIRST — the protection survives navigation even if the
      // animation never gets to play.
      void addBlocked(it.key);
      if (it.sig.userId) void addBlocked(it.sig.userId);
      // The 处理记录 row too: the id lands in xss:blocked above, and a record
      // is the only UI path back (恢复显示). Writing it after the paced X
      // action left a window (tab close mid-queue) that produced permanently
      // hidden accounts with no recover entry. The X-failure annotation is
      // patched in later by the drain loop.
      const tweetText = it.sig.triggeringComment || it.sig.recentTweets[0];
      void addBlockRecord({
        id: it.key,
        handle: it.sig.handle,
        ...(it.sig.displayName ? { displayName: it.sig.displayName } : {}),
        ...(it.sig.avatarUrl ? { avatarUrl: it.sig.avatarUrl } : {}),
        ...(it.tweetId ? { tweetId: it.tweetId } : {}),
        ...(tweetText ? { tweetText } : {}),
        verdict: it.verdict,
        reason: `${it.categoryZh} · 自动${it.verb}`,
        source: "auto",
        ts: Date.now(),
      });
      // Track the not-yet-fired X action separately (see PendingXAction): a
      // mid-queue reload can then tell a queued account apart from a completed
      // one — resuming it instead of falsely counting it as 已处理. Local-only
      // hides need no X call, so nothing to track.
      if (it.action === "mute" || it.action === "block") {
        void addPendingAction({
          id: it.key,
          handle: it.sig.handle,
          action: it.action,
          ts: Date.now(),
        });
      }
      void bumpStats({ blocks: 1 });
      void bumpStat("blocked");
      anchorByKey.set(it.key, it.anchor);
      articleOf(it.anchor)?.setAttribute("data-xss-key", it.key);
      mountActing(it.anchor, it.verb, true);
      bubbleApi?.markAuto(it.key, "queued", it.verb);
      autoQueue.push(it);
      scheduleDrain();
    }

    let drainTimer: ReturnType<typeof setTimeout> | undefined;
    let gatherStart = 0;
    /** Debounced sweep start: every new hit extends the gather window by
     *  AUTO_GATHER_MS, bounded by AUTO_GATHER_MAX_MS from the first hit. */
    function scheduleDrain() {
      if (autoDraining) return; // mid-sweep hits just join the tail
      const now = Date.now();
      if (!gatherStart) gatherStart = now;
      const delay = Math.min(
        AUTO_GATHER_MS,
        Math.max(0, gatherStart + AUTO_GATHER_MAX_MS - now),
      );
      clearTimeout(drainTimer);
      drainTimer = setTimeout(() => void drainAuto(), delay);
    }

    async function drainAuto() {
      if (autoDraining) return;
      autoDraining = true;
      gatherStart = 0;
      try {
        await drainAutoLoop();
      } finally {
        autoDraining = false;
      }
      // A hit that landed exactly as the loop exited would otherwise sit
      // until the next enqueue — sweep it into a fresh (short) round.
      if (autoQueue.length) scheduleDrain();
    }

    async function drainAutoLoop() {
      while (autoQueue.length) {
        const it = autoQueue.shift();
        if (!it) break;
        // One broken item (dead DOM node, render error) must not strand the
        // rest of the queue — fail it and move on.
        try {
          const t0 = Date.now();
          const acting = autoTarget(it);
          if (acting) mountActing(acting, it.verb, false);
          bubbleApi?.markAuto(it.key, "processing", it.verb);
          const xOk =
            it.action === "mute" || it.action === "block"
              ? await applyXAction(it.action, it.sig)
              : true;
          if (!xOk)
            console.warn(`[MXGA] 自动${it.verb}：X 原生动作失败`, it.sig.handle, it.sig.userId);
          // Even the instant local-hide mode dwells long enough to be SEEN.
          const dwell = AUTO_MIN_ACT_MS - (Date.now() - t0);
          if (dwell > 0) await sleep(dwell);
          // Hide the real tweet INSTANTLY — the processing theater (fade /
          // shrink / fly-into-chip) belongs to the corner bubble; animating
          // the page's own DOM competes with X's scroll/virtualizer and reads
          // as jank on the timeline.
          hideAccountSurface(autoTarget(it), it.key);
          // The action has now SETTLED (attempted) — drop its pending marker so
          // it stops being a resume candidate; only items whose queue died
          // before this point stay pending. On X failure, annotate the record.
          if (it.action === "mute" || it.action === "block") {
            void clearPendingAction(it.key);
            if (!xOk) {
              void updateBlockRecord(it.key, {
                reason: `${it.categoryZh} · 自动${it.verb}（X 动作失败，仅本地隐藏）`,
              });
            }
          }
          bubbleApi?.markAuto(it.key, xOk ? "done" : "failed", it.verb);
        } catch (e) {
          console.warn(`[MXGA] 自动${it.verb}处理异常`, it.sig.handle, e);
          try {
            bubbleApi?.markAuto(it.key, "failed", it.verb);
          } catch {
            /* bubble unavailable — the record above still stands */
          }
        } finally {
          autoActing.delete(it.key);
        }
        await sleep(AUTO_SETTLE_MS);
      }
    }

    /** Resume mute/block actions whose paced queue died with a previous page
     *  (mid-queue navigation / reload / tab close). Their local hide + record
     *  persisted, but the X-action never fired — re-run it best-effort (the
     *  x-action lock paces these across tabs), then settle the pending marker
     *  so it stops being a resume candidate. Runs once per load; each entry is
     *  attempted at most once, then cleared regardless of outcome. */
    async function resumeInterrupted(pending: PendingXAction[]) {
      // The user switched the mode to local (no more X actions) — honor that:
      // just settle the markers so these move into the normal 已处理 history.
      if (settings.actionMode === "local") {
        for (const p of pending) void clearPendingAction(p.id);
        return;
      }
      for (const p of pending.slice(0, RESUME_MAX)) {
        if (p.action !== "mute" && p.action !== "block") {
          void clearPendingAction(p.id);
          continue;
        }
        const sig = {
          handle: p.handle,
          ...(/^\d+$/.test(p.id) ? { userId: p.id } : {}),
        } as Signals;
        const ok = await applyXAction(p.action, sig).catch(() => false);
        if (!ok) {
          void updateBlockRecord(p.id, {
            reason: `自动${p.action === "block" ? "拉黑" : "静音"}（X 动作失败，仅本地隐藏）`,
          });
        }
        void clearPendingAction(p.id);
      }
    }

    function pushFinding(
      sig: Signals,
      v: Verdict,
      source: string,
      meta?: { categoryZh?: string; tweetId?: string; tier?: "confirmed" | "auto" },
    ) {
      if (!["spam", "porn_bot", "likely_spam"].includes(v.label)) return;
      const id = keyOf(sig);
      // Dedupe by key AND by handle: the same account can be scanned once
      // WITH a uid (article fiber walk) and once without (profile header),
      // producing two different keys — the bubble then listed it twice.
      const h = sig.handle.toLowerCase();
      if (
        findings.some(
          (f) => (f.userId || `h:${f.handle}`) === id || f.handle.toLowerCase() === h,
        )
      )
        return;
      const snippet = sig.triggeringComment || sig.recentTweets[0] || sig.bio;
      findings.push({
        handle: sig.handle,
        verdict: v,
        source,
        ...(meta?.categoryZh ? { categoryZh: meta.categoryZh } : {}),
        ...(meta?.tweetId ? { tweetId: meta.tweetId } : {}),
        ...(meta?.tier ? { tier: meta.tier } : {}),
        ...(sig.userId ? { userId: sig.userId } : {}),
        ...(sig.avatarUrl ? { avatarUrl: sig.avatarUrl } : {}),
        ...(sig.displayName ? { displayName: sig.displayName } : {}),
        ...(snippet ? { snippet } : {}),
      });
      if (!dismissed) bubbleApi?.update(findings);
    }

    function badgeFor(
      anchor: HTMLElement,
      key: string,
      sig: Signals,
      v: Verdict | null,
      note?: string,
      source: BadgeSource = "fresh",
    ) {
      // Anchors are kept ONLY for hit accounts (executeHide's fallback and
      // onReviewEach are the sole consumers, and both operate on findings).
      // Registering every scanned account used to pin each author's
      // unmounted article subtree for the whole page lifetime; the neutral
      // ghost badge's manual flow captures its own anchor via scheduleHide.
      if (v) anchorByKey.set(key, anchor);
      clearMounts(anchor);
      mountBadge(anchor, () =>
        createBadge(
          v,
          {
            // The popover exposes the full ladder; the clicked mode overrides
            // settings.actionMode for this one account (default = configured).
            onAct: (mode) => scheduleHide(key, sig, anchor, mode),
            onAppeal: () =>
              openAppeal({ handle: sig.handle, ...(sig.userId ? { userId: sig.userId } : {}) }),
            onReport: () => reportSpam(sig),
          },
          note,
          source,
          settings.actionMode,
        ),
      );
    }

    function markChecked(anchor: HTMLElement): void {
      clearMounts(anchor);
      mountBadge(anchor, createCheckedMarker);
    }

    function renderCached(anchor: HTMLElement, key: string, sig: Signals, c: Cached) {
      if (onlineVerdictVisibility(c.verdict) === "silent") {
        markChecked(anchor);
        return;
      }
      badgeFor(anchor, key, sig, c.verdict, undefined, "cache");
      pushFinding(sig, c.verdict, "cache");
    }

    async function renderOnlineDetection(
      anchor: HTMLElement,
      key: string,
      sig: Signals,
    ): Promise<void> {
      clearMounts(anchor);
      mountBadge(anchor, createAnalyzingBadge);
      const result = await onlineClassificationLimiter.run(async () => {
        if (!onlineAuthenticated) return { status: "unauthenticated" as const };
        return classifyAndCache(key, sig);
      });
      if (result.status === "unauthenticated") onlineAuthenticated = false;
      if (result.status !== "classified") {
        badgeFor(anchor, key, sig, null);
        return;
      }
      if (!result.cached) {
        void bumpStats({ detections: 1, label: result.verdict.label });
        void bumpStat("scanned");
      }
      if (onlineVerdictVisibility(result.verdict) === "silent") {
        markChecked(anchor);
        return;
      }
      badgeFor(
        anchor,
        key,
        sig,
        result.verdict,
        result.cached ? "在线记录命中" : "在线 AI 检测完成",
        "fresh",
      );
      pushFinding(sig, result.verdict, "online-ai");
    }

    function renderLocalIndex(
      anchor: HTMLElement,
      key: string,
      sig: Signals,
      entry: IndexEntry,
      badgeSource: BadgeSource = "list",
      ctx: ScanContext = "feed",
    ) {
      if (!hitPublicSeen.has(key)) {
        hitPublicSeen.add(key);
        void bumpStat("hitPublic");
      }
      // Triggering tweet for the audit trail (null on profile headers).
      const hitArt = articleOf(anchor);
      const hitTweetId = hitArt ? articleStatusId(hitArt) : null;
      // Auto-action decision chain (each gate independent, no cross-talk):
      //   1. ELIGIBILITY — autoEligible() in lib/auto-policy.ts: list hits
      //      per autoScope; rule hits reply-section-only; cache/fresh never.
      //      autoTierMode "badge" gates out everything not human-confirmed
      //      (auto-tier list entries AND rule hits — both are 自动收录).
      //   2. TIER CAP — capAutoTierAction(): under autoTierMode "hide",
      //      anything not human-confirmed is capped at the local hide.
      //      entry.tier (人工确认/自动收录) stays visible in the popover;
      //      /v1/check keeps the human-tier filter for legacy clients.
      //   3. MASTER SWITCH — settings.autoProcess (bubble + settings page).
      //   4. POLICY — per-category action (badge/hide/mute/block).
      // (Auto actions stay reversible from the 处理记录 tab, and mute/block
      // ride the user's own X session like the manual path.)
      const eligible = autoEligible({
        source: badgeSource,
        tier: entry.tier,
        inReply: ctx === "reply",
        autoScope: settings.autoScope,
        autoTierMode: settings.autoTierMode,
      });
      // Auto-published (non-human) list entries are capped by autoTierMode:
      // under the default "hide" they may auto-hide locally but never fire
      // the irreversible X mute/block with the user's session.
      const action = eligible
        ? capAutoTierAction(settings.categoryActions[entry.category] ?? "badge", {
            source: badgeSource,
            tier: entry.tier,
            autoTierMode: settings.autoTierMode,
          })
        : "badge";
      // 自动处理 master switch off → everything degrades to mark-only,
      // regardless of the per-category policy.
      if (action === "badge" || !settings.autoProcess) {
        badgeFor(anchor, key, sig, entry.verdict, undefined, badgeSource);
        pushFinding(sig, entry.verdict, badgeSource === "rule" ? "local-rule" : "local-index", {
          categoryZh: CATEGORY_ZH[entry.category],
          ...(hitTweetId ? { tweetId: hitTweetId } : {}),
          ...(badgeSource === "list" ? { tier: entry.tier } : {}),
        });
        return;
      }
      // Auto-processed accounts still show up in the bubble panel — as
      // display-only rows driven through markAuto (checkbox disabled,
      // button is a status chip). Chips + radar pill counts follow.
      pushFinding(sig, entry.verdict, badgeSource === "rule" ? "local-rule" : "local-index", {
        categoryZh: CATEGORY_ZH[entry.category],
        ...(hitTweetId ? { tweetId: hitTweetId } : {}),
        ...(badgeSource === "list" ? { tier: entry.tier } : {}),
      });
      const verb = action === "mute" ? "静音" : action === "block" ? "拉黑" : "隐藏";
      // The visible queue owns everything from here: records up-front, then
      // in-place badge → paced X action → animated collapse → bubble row
      // states. The 处理记录 line is written after the X action settles so it
      // can state honestly whether the native mute/block actually landed.
      enqueueAuto({
        key,
        sig,
        action,
        verb,
        anchor,
        verdict: entry.verdict,
        categoryZh: CATEGORY_ZH[entry.category],
        ...(hitTweetId ? { tweetId: hitTweetId } : {}),
      });
    }

    async function process(sig: Signals, anchor: HTMLElement, ctx: ScanContext = "feed") {
      const key = keyOf(sig);
      if (inFlight.has(key)) return; // a concurrent scan is already on it
      inFlight.add(key);
      try {
        // 0. Already blocked → hide, never render again. Exception: the cell
        //    the visible auto queue is working on (it was recorded up-front)
        //    — its animation owns the hide; OTHER cells by the same account
        //    still vanish instantly.
        // Check every id form the account may have been recorded under: the
        // same account can surface with a uid (fiber walk) or handle-only
        // (profile header), and a hit stored under one form must short-circuit
        // the other — otherwise it gets auto-processed twice and 恢复显示
        // (which deletes one id) never actually un-hides it.
        const activeBlockedKey = isBlockedSync(key)
          ? key
          : sig.userId && isBlockedSync(sig.userId)
            ? sig.userId
            : isBlockedSync(`h:${sig.handle}`)
              ? `h:${sig.handle}`
              : null;
        if (activeBlockedKey) {
          if (
            autoActing.has(key) &&
            articleOf(anchor)?.getAttribute("data-xss-key") === key
          )
            return;
          hideAccountSurface(anchor, activeBlockedKey);
          return;
        }

        // 1. Check pending undo queue — skip if already scheduled.
        if (pendingActions.has(key)) return;

        // 2. Whitelist wins over EVERYTHING below — lookupLocal excludes
        //    whitelisted accounts itself, but a v0.4-era cached spam verdict
        //    would otherwise keep red-badging an appealed account for up to
        //    30 days. Still mount the neutral badge: it keeps the manual
        //    handle available and stops scan() from revisiting the row.
        if (isWhitelisted(sig.userId, sig.handle)) {
          badgeFor(anchor, key, sig, null);
          return;
        }

        // 3. Local public index lookup (no remote requests, <50ms). Ranked
        //    ABOVE the legacy cache: a stale "legit" entry from v0.4 must not
        //    mask a since-human-confirmed list hit, and a stale "spam" entry
        //    must not demote it to mark-only (cache never auto-acts).
        const entry = lookupLocal(sig.userId, sig.handle);
        if (entry) {
          renderLocalIndex(anchor, key, sig, entry, "list", ctx);
          return;
        }

        // 4. v0.4-era persistent cache, read-only since v0.5 (spam reused
        //    as-is; legit/uncertain only if signals unchanged so new evidence
        //    can still re-trigger).
        const cached = await cacheGet(key);
        if (cached) {
          const spammy = ["spam", "porn_bot", "likely_spam"].includes(cached.verdict.label);
          if (spammy || cached.signalsHash === signalsHash(sig)) {
            renderCached(anchor, key, sig, cached);
            void bumpStats({ cacheHits: 1 });
            return;
          }
        }

        // 4.5 Maintainer-curated keyword rules, shipped with the synced list.
        // Catches first-seen template accounts (brand-new porn-bot throwaways
        // not yet on the public list) with zero upload. Whitelist already won
        // at step 2.
        const ruleHit = matchLocalRules(sig);
        if (ruleHit) {
          renderLocalIndex(
            anchor,
            key,
            sig,
            {
              userId: sig.userId ?? "",
              handle: sig.handle,
              verdict: {
                label: ruleHit.label,
                // The matched pattern never surfaces in the UI: spammers read
                // their own block screenshots, and a leaked keyword is a
                // free evasion recipe. Category only.
                confidence: 0.95,
                reasons: [`命中官方规则 · ${CATEGORY_ZH[ruleHit.category]}`],
              },
              category: ruleHit.category,
              tier: "auto", // rule hits are auto tier — reply-scope gated
              source: "community",
              updatedAt: new Date().toISOString(),
            },
            "rule",
            ctx,
          );
          return;
        }

        // 5. Local miss. Restored v0.4 behavior: a GitHub-authenticated user
        //    automatically submits the newly encountered account for online
        //    AI detection. The per-route hard cap bounds client/API spend;
        //    logged-out and overflow rows stay in the neutral manual state.
        if (
          shouldAutoClassify({
            authenticated: onlineAuthenticated,
            localResult: "unknown",
            requestsStarted: autoClassificationsStarted,
          })
        ) {
          autoClassificationsStarted += 1;
          await renderOnlineDetection(anchor, key, sig);
          return;
        }
        badgeFor(anchor, key, sig, null);
      } finally {
        inFlight.delete(key);
      }
    }

    // Persist the logged-in viewer's own handle for the options page's
    // whitelist self-service flow (apply for YOUR account only).
    let lastViewer: string | undefined;
    function captureViewer() {
      const v = viewerHandle();
      if (v && v !== lastViewer) {
        lastViewer = v;
        try {
          void chrome.storage.local.set({ "xss:viewer": { handle: v, ts: Date.now() } });
        } catch {
          /* non-fatal */
        }
      }
    }

    function scan() {
      captureViewer();
      const p = extractProfile();
      if (p) {
        const el = document.querySelector<HTMLElement>('[data-testid="UserName"]');
        if (el) {
          // Same skip rule as articles: untouched account + live mount → done.
          const hasMount = !!el.querySelector(":scope > .xss-mount");
          if (nodeHandle.get(el) !== p.handle || !hasMount) {
            if (nodeHandle.get(el) !== p.handle) clearMounts(el);
            nodeHandle.set(el, p.handle);
            void process(p, el, "profile");
          }
        }
      }
      // Account-keyed, NOT node-tagged: X virtualizes the list and recycles
      // <article> nodes, so a permanent per-node flag would skip recycled
      // (new) spam. Re-evaluate a node when its account changed or our badge
      // is missing; account-level cache/in-flight keep it cheap. Cheap key
      // first (link href only) — full extraction (fiber walk, innerText)
      // runs only for nodes that actually need (re-)processing.
      const topic = extractThreadTopic();
      // Reply detection: on a /user/status/<id> page every article whose own
      // permalink id differs from the focal id is a conversation reply — the
      // context where auto actions are allowed by default. Everything else
      // (home/list/search feeds, the focal tweet itself) is "feed".
      const focal = focalStatusId();
      for (const art of document.querySelectorAll<HTMLElement>(
        'article[data-testid="tweet"]',
      )) {
        const handle = handleFromArticle(art);
        const nameBlock = art.querySelector<HTMLElement>('[data-testid="User-Name"]');
        if (!handle || !nameBlock) continue;
        const hasMount = !!nameBlock.querySelector(":scope > .xss-mount");
        if (nodeHandle.get(art) === handle && hasMount) continue;
        const info = extractFromArticle(art);
        if (!info) continue;
        if (topic && !info.threadTopic) info.threadTopic = topic;
        if (nodeHandle.get(art) !== handle) clearMounts(nameBlock); // recycled node
        nodeHandle.set(art, handle);
        const sid = focal ? articleStatusId(art) : null;
        const ctx: ScanContext = focal && sid && sid !== focal ? "reply" : "feed";
        void process(info, nameBlock, ctx);
      }
    }

    const ui = await createShadowRootUi(ctx, {
      name: "xss-bubble",
      position: "overlay",
      anchor: "body",
      onMount(container) {
        const st = document.createElement("style");
        st.textContent = STYLE;
        container.appendChild(st);
        const bubble = createBubble({
          onProcess(keys: string[], onProgress: (key: string, ok: boolean) => void) {
            // Batch panel: the user explicitly confirmed, so act immediately
            // (no 5s undo window). Sequential await keeps the native X
            // mute/block calls on x-action's global pacing; the bubble's
            // chips/progress/rows advance on every onProgress callback.
            void (async () => {
              for (const key of keys) {
                const f = findings.find(
                  (x) => (x.userId || `h:${x.handle}`) === key,
                );
                if (!f) {
                  onProgress(key, false);
                  continue;
                }
                const sig: Signals = {
                  isProfile: false,
                  handle: f.handle,
                  displayName: f.displayName ?? "",
                  bio: "",
                  hasDefaultAvatar: false,
                  recentTweets: [],
                  ...(f.userId ? { userId: f.userId } : {}),
                  ...(f.avatarUrl ? { avatarUrl: f.avatarUrl } : {}),
                };
                // Take over any pending 5s-undo for this account — the batch
                // action supersedes the preview window.
                const pending = pendingActions.get(key);
                if (pending) {
                  clearTimeout(pending.timer);
                  pendingActions.delete(key);
                }
                const ok = await executeHide(key, sig).catch(() => false);
                onProgress(key, ok);
              }
            })();
          },
          onReviewEach() {
            const first = findings[0];
            if (first) {
              anchorByKey
                .get(first.userId || `h:${first.handle}`)
                ?.scrollIntoView({ behavior: "smooth", block: "center" });
            }
          },
          onDismiss() {
            dismissed = true;
          },
          onAppeal(appeal) {
            openAppeal(appeal);
          },
          onToggleAuto(v: boolean) {
            // Persist; the onSettingsChange listener updates `settings` (and
            // echoes the new state back into the bubble, a no-op here).
            void setSetting("autoProcess", v);
          },
        }, settings.bubblePos, actionVerb(settings.actionMode), {
          autoProcess: settings.autoProcess,
          autoCategoryCount: autoCategoryCount(settings),
          autoScopeAll: settings.autoScope === "all",
          autoExpand: settings.autoExpand,
        });
        container.appendChild(bubble.el);
        if (!settings.bubble) bubble.el.style.display = "none";
        bubbleApi = bubble;
        // The bubble's 已处理 list is SESSION-scoped: it persists across SPA
        // navigation (the content script and its in-memory archive live on),
        // but a full reload / freshly-opened X must start clean — resurrecting
        // the whole all-time history here read as "记录没清掉". The permanent
        // audit trail lives in the options 处理记录 page, not the corner bubble.
        //
        // We still read the pending-actions key: an X mute/block whose paced
        // queue died mid-flight (navigation / reload / tab close) never fired,
        // so resume it best-effort. This is protection follow-through, NOT
        // history display — resumed accounts are not seeded into 已处理.
        void getPendingActions().then((pending) => {
          if (pending.length) void resumeInterrupted(pending);
        });
        return bubble;
      },
    });
    ui.mount();

    // SPA navigation: flush pending hides (the user already chose to hide;
    // the block is recorded even if the row's DOM is gone), then drop all
    // per-page state so detached DOM nodes can be garbage-collected.
    ctx.addEventListener(window, "wxt:locationchange", () => {
      for (const [key, p] of pendingActions) {
        clearTimeout(p.timer);
        void executeHide(key, p.sig);
      }
      pendingActions.clear();
      anchorByKey.clear();
      findings = [];
      autoClassificationsStarted = 0;
      // Collapse the card and archive this page's processed rows — the
      // bubble follows the user across SPA navigations, so a stale open
      // panel over a new page reads as broken; the session's records stay
      // viewable in the 已处理 tab until a hard reload.
      bubbleApi?.pageReset();
    });

    let debounce: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => {
      clearTimeout(debounce);
      debounce = setTimeout(scan, 600);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    ctx.onInvalidated(() => {
      observer.disconnect();
      clearTimeout(debounce);
    });
    // Periodic tick so newly virtualized rows are revisited even when the
    // user stops scrolling (no new DOM mutations). ctx-bound: stops when
    // the content script is invalidated.
    ctx.setInterval(scan, 4000);
    // List / whitelist hot-swap (background sync or 立即更新): the lookup
    // maps already rebuilt via local-index's own onChanged hook, but rows
    // rendered with the OLD data keep their badge (scan skips mounted
    // nodes). Drop every neutral badge so the next scan re-evaluates the
    // page against the fresh list. Pending/hidden rows are untouched.
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") return;
        let shouldScan = false;
        if (changes["xss:ghToken"]) {
          void refreshOnlineAuth().then((changed) => {
            if (!changed || !onlineAuthenticated) return;
            for (const host of document.querySelectorAll<HTMLElement>(".xss-mount")) {
              if (host.shadowRoot?.querySelector(".xss-badge.ghost")) host.remove();
            }
            scan();
          });
        }
        if (changes[BLOCKED_KEY]) {
          const next = new Set<string>(
            (changes[BLOCKED_KEY]?.newValue as string[] | undefined) ?? [],
          );
          shouldScan = restoreAccountSurfaces(next) > 0;
        }
        if (changes[LIST_KEY] || changes[WL_KEY]) {
          for (const host of document.querySelectorAll<HTMLElement>(".xss-mount")) {
            // Badges live in the host's shadow root; keep pending-undo flows.
            if (host.shadowRoot?.querySelector(".xss-badge.pending")) continue;
            host.remove();
          }
          shouldScan = true;
        }
        if (shouldScan) scan();
      });
    } catch {
      /* non-fatal */
    }
    scan();
  },
});
