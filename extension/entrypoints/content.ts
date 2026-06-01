import { isBlockedSync, warm as warmBlocklist, addBlocked } from "../lib/blocklist";
import { BRAND } from "../lib/brand";
import { actionApiPath, type ModerationAction } from "../lib/moderation-action";
import { onSettingsChange, getSettings } from "../lib/settings";
import { addBlockRecord, bumpStats } from "../lib/store";
import { type Cached, cacheGet, cacheSet, signalsHash } from "../lib/cache";
import { isWhitelisted, loadWhitelistOnce } from "../lib/whitelist-cache";
import {
  AUTO_THRESHOLD,
  extractFromArticle,
  extractProfile,
  extractThreadTopic,
  heuristic,
  ingestGraphqlUsers,
} from "../lib/detect";
import type { BgResponse, CurationRecord, Signals, Verdict } from "../lib/types";
import {
  type BadgeSource,
  type Finding,
  STYLE,
  createBadge,
  createBubble,
  createStatusBadge,
} from "../lib/ui";

const APPEAL_URL = BRAND.appealNewIssue;

function send<T = unknown>(msg: unknown): Promise<BgResponse & { data?: T }> {
  return new Promise((r) =>
    chrome.runtime.sendMessage(msg, (resp: (BgResponse & { data?: T }) | undefined) =>
      r(resp ?? { ok: false }),
    ),
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function hideTweet(node: Element | null) {
  const cell =
    node?.closest('[data-testid="cellInnerDiv"]') ?? node?.closest("article");
  if (cell instanceof HTMLElement) cell.style.display = "none";
}

// X web's long-standing public bearer (same one the site itself uses).
const FALLBACK_X_BEARER =
  "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
const ct0 = () => (document.cookie.match(/ct0=([^;]+)/)?.[1] ?? "");

const ACCOUNT_ACTION_DELAY_MS = 1200;
const ACCOUNT_ACTION_JITTER_MS = 700;
const BLOCK_SUCCESS_SETTLE_MS = 180;
const BLOCK_SHORT_COOLDOWN_EVERY = 45;
const BLOCK_SHORT_COOLDOWN_MS = 8_000;
const BLOCK_LONG_COOLDOWN_EVERY = 120;
const BLOCK_LONG_COOLDOWN_MS = 60_000;
const BLOCK_RATE_LIMIT_COOLDOWN_MS = 45_000;
const BLOCK_TRANSIENT_COOLDOWN_MS = 8_000;
const LS_LAST_BLOCK = "mxga:last-x-block-api";
const LS_BLOCK_ROUND = "mxga:x-block-round";
const BLOCK_LOCK_NAME = "mxga-x-block-api";

interface BlockRound {
  count: number;
  cooldownUntil: number;
}

interface AccountActionAttempt {
  ok: boolean;
  status?: number;
  retryable?: boolean;
  retryAfterMs?: number;
}

type LockCapableNavigator = Navigator & {
  locks?: {
    request<T>(name: string, callback: () => T | Promise<T>): Promise<T>;
  };
};

function blockApiOrigin() {
  return location.hostname.endsWith("twitter.com") ? "https://twitter.com" : "https://x.com";
}

function normalizeBlockHandle(handle?: string) {
  return String(handle ?? "").trim().replace(/^@+/, "");
}

function storageNumber(key: string) {
  try {
    return Number(localStorage.getItem(key) || 0) || 0;
  } catch {
    return 0;
  }
}

function setStorageNumber(key: string, value: number) {
  try {
    localStorage.setItem(key, String(Math.max(0, Math.floor(value))));
  } catch {
    /* localStorage can be blocked; per-tab pacing still applies */
  }
}

function readBlockRound(): BlockRound {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_BLOCK_ROUND) || "{}") as Partial<BlockRound>;
    return {
      count: Math.max(0, Number(raw.count || 0) || 0),
      cooldownUntil: Math.max(0, Number(raw.cooldownUntil || 0) || 0),
    };
  } catch {
    return { count: 0, cooldownUntil: 0 };
  }
}

function writeBlockRound(round: BlockRound) {
  try {
    localStorage.setItem(
      LS_BLOCK_ROUND,
      JSON.stringify({
        count: Math.max(0, Number(round.count || 0) || 0),
        cooldownUntil: Math.max(0, Number(round.cooldownUntil || 0) || 0),
      }),
    );
  } catch {
    /* non-fatal */
  }
}

function nextBlockCooldown(count: number) {
  if (count > 0 && count % BLOCK_LONG_COOLDOWN_EVERY === 0) return BLOCK_LONG_COOLDOWN_MS;
  if (count > 0 && count % BLOCK_SHORT_COOLDOWN_EVERY === 0) return BLOCK_SHORT_COOLDOWN_MS;
  return 0;
}

function parseRetryAfterMs(value: string | null) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

function recordBlockBackoff(ms: number) {
  if (ms <= 0) return;
  const round = readBlockRound();
  writeBlockRound({
    ...round,
    cooldownUntil: Math.max(round.cooldownUntil, Date.now() + ms),
  });
}

function recordBlockFailure(attempt: AccountActionAttempt) {
  if (attempt.status === 429) {
    recordBlockBackoff(attempt.retryAfterMs ?? BLOCK_RATE_LIMIT_COOLDOWN_MS);
  } else if (attempt.retryable) {
    recordBlockBackoff(BLOCK_TRANSIENT_COOLDOWN_MS);
  }
}

function retryDelayForAttempt(attempt: AccountActionAttempt, tries: number) {
  if (!attempt.retryable) return 0;
  if (attempt.status === 429) {
    return Math.min(60_000, attempt.retryAfterMs ?? BLOCK_RATE_LIMIT_COOLDOWN_MS);
  }
  return Math.min(12_000, 900 * 2 ** Math.max(0, tries - 1));
}

async function waitForBlockSlot() {
  while (true) {
    const round = readBlockRound();
    const cooldownRemaining = round.cooldownUntil - Date.now();
    if (cooldownRemaining > 0) {
      await sleep(Math.min(1000, cooldownRemaining));
      continue;
    }

    const lastAt = storageNumber(LS_LAST_BLOCK);
    const jitter = Math.floor(Math.random() * ACCOUNT_ACTION_JITTER_MS);
    const remaining = lastAt + ACCOUNT_ACTION_DELAY_MS + jitter - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(1000, remaining));
  }
  setStorageNumber(LS_LAST_BLOCK, Date.now());
}

function recordBlockSuccess() {
  const round = readBlockRound();
  const count = round.count + 1;
  const cooldownMs = nextBlockCooldown(count);
  writeBlockRound({
    count,
    cooldownUntil: cooldownMs ? Date.now() + cooldownMs : 0,
  });
}

async function withBlockLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (navigator as LockCapableNavigator).locks;
  return locks ? locks.request(BLOCK_LOCK_NAME, fn) : fn();
}

/** Silent X account action via the first-party mute/block endpoints. */
async function apiAccountAction(
  action: ModerationAction,
  userId?: string,
  handle?: string,
): Promise<AccountActionAttempt> {
  try {
    const csrf = ct0();
    if (!csrf) return { ok: false, retryable: false };
    const screenName = normalizeBlockHandle(handle);
    const body = new URLSearchParams();
    if (screenName) body.set("screen_name", screenName);
    else if (userId && /^\d+$/.test(userId)) body.set("user_id", userId);
    else return { ok: false, retryable: false };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch(`${blockApiOrigin()}${actionApiPath(action)}`, {
      method: "POST",
      credentials: "include",
      signal: controller.signal,
      headers: {
        authorization: FALLBACK_X_BEARER,
        "x-csrf-token": csrf,
        "x-twitter-auth-type": "OAuth2Session",
        "x-twitter-active-user": "yes",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    }).finally(() => clearTimeout(timer));
    const status = res.status;
    return {
      ok: res.ok,
      status,
      retryAfterMs: parseRetryAfterMs(res.headers.get("retry-after")),
      retryable: status === 408 || status === 425 || status === 429 || status >= 500,
    };
  } catch {
    return { ok: false, retryable: true };
  }
}

async function coordinatedAccountAction(
  action: ModerationAction,
  userId?: string,
  handle?: string,
): Promise<AccountActionAttempt> {
  return withBlockLock(async () => {
    await waitForBlockSlot();
    const attempt = await apiAccountAction(action, userId, handle);
    if (attempt.ok) recordBlockSuccess();
    else recordBlockFailure(attempt);
    return attempt;
  });
}

/** Each inline badge gets its own shadow host so X CSS can't touch it. */
function mountBadge(anchor: HTMLElement, build: () => HTMLElement) {
  const host = document.createElement("span");
  host.className = "xss-mount";
  host.style.display = "inline-flex";
  host.style.alignItems = "center";
  host.style.verticalAlign = "middle";
  host.style.flex = "0 0 auto";
  host.style.maxWidth = "none";
  host.style.lineHeight = "1";
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

/** Lightweight "queued" marker — NOT a final mount, so scan() revisits it
 *  once the token bucket refills (newly loaded comments never get stuck). */
function mountStatus(
  anchor: HTMLElement,
  kind: "analyzing" | "pending" | "blocking",
  actions?: Parameters<typeof createStatusBadge>[1],
) {
  const cls = kind === "pending" ? "xss-pending" : "xss-mount";
  if (anchor.querySelector(`:scope > .${cls}`)) return;
  const host = document.createElement("span");
  host.className = cls; // pending = NOT final, scan() will revisit
  host.style.display = "inline-flex";
  host.style.alignItems = "center";
  host.style.verticalAlign = "middle";
  host.style.flex = "0 0 auto";
  host.style.maxWidth = "none";
  host.style.lineHeight = "1";
  const sr = host.attachShadow({ mode: "open" });
  const st = document.createElement("style");
  st.textContent = STYLE;
  sr.append(st, createStatusBadge(kind, actions));
  anchor.appendChild(host);
}
const mountPending = (a: HTMLElement) => mountStatus(a, "pending");
function mountBlocking(anchor: HTMLElement, actions?: Parameters<typeof createStatusBadge>[1]) {
  clearMounts(anchor);
  mountStatus(anchor, "blocking", actions);
}

export default defineContentScript({
  matches: ["https://x.com/*", "https://twitter.com/*"],
  cssInjectionMode: "ui",
  async main(ctx) {
    let bubbleApi: ReturnType<typeof createBubble> | null = null;
    let dismissed = false;
    let canReport = false;
    type InflightClassify = { promise: Promise<void>; requestId: string; canceled: boolean };
    const inflight = new Map<string, InflightClassify>(); // L0 in-flight de-dup
    const anchorByKey = new Map<string, HTMLElement>();
    const nodeKey = new WeakMap<HTMLElement, string>(); // virtualization-safe
    const findings: Finding[] = [];
    let active = 0;
    // Token bucket instead of a hard per-page cap: sustained ~20/min, burst
    // 40. Scrolling more keeps detecting (refills); never permanently stuck.
    // Cache + L0 de-dup keep repeats free, so this only bounds bursts.
    const TOK_CAP = 40;
    let tokens = TOK_CAP;
    setInterval(() => {
      tokens = Math.min(TOK_CAP, tokens + 1);
    }, 3000);
    const takeToken = () => (tokens > 0 ? (tokens--, true) : false);

    let settings = await getSettings();
    if (!settings.enabled) return; // master off → don't init (applies next load)
    onSettingsChange((s) => {
      settings = s;
    });

    await warmBlocklist();
    // L0a — pull the maintainer whitelist mirror into memory so the gate
    // check in classify() is synchronous. Cheap (one chrome.storage read).
    await loadWhitelistOnce();
    void send<{ login?: string }>({ type: "gh_status" }).then((r) => {
      const nextCanReport = !!r.ok && !!r.data?.login;
      if (nextCanReport !== canReport) {
        canReport = nextCanReport;
        document
          .querySelectorAll<HTMLElement>('[data-testid="User-Name"]')
          .forEach(clearMounts);
        setTimeout(scan, 0);
      }
    });
    const isReplyContext = () => /^\/[^/]+\/status\/\d+/.test(location.pathname);
    const keyOf = (s: Signals) => s.userId || `h:${s.handle}`;
    type QSource = "manual" | "list_hit" | "cache_hit";
    type QItem = {
      key: string;
      sig: Signals;
      tries: number;
      source: QSource;
      verdict?: Verdict;
    };
    const LOOKUP_BATCH_DELAY_MS = 80;
    const LOOKUP_BATCH_MAX = 100;
    const lookupResolvers = new Map<string, (hit: CurationRecord | null) => void>();
    const lookupInflight = new Map<string, Promise<CurationRecord | null>>();
    let lookupTimer: ReturnType<typeof setTimeout> | undefined;

    function scheduleLookupFlush() {
      if (lookupTimer) return;
      lookupTimer = setTimeout(() => {
        lookupTimer = undefined;
        void flushLookupBatch();
      }, LOOKUP_BATCH_DELAY_MS);
    }

    async function flushLookupBatch() {
      const batch = [...lookupResolvers.entries()].slice(0, LOOKUP_BATCH_MAX);
      if (!batch.length) return;
      for (const [id] of batch) lookupResolvers.delete(id);
      if (lookupResolvers.size) scheduleLookupFlush();

      const userIds = batch.map(([id]) => id);
      const resp = await send<{ hits: Record<string, CurationRecord> }>({
        type: "lookup_batch",
        userIds,
      }).catch(() => ({ ok: false }) as BgResponse & { data?: { hits: Record<string, CurationRecord> } });
      const hits = resp.ok ? (resp.data?.hits ?? {}) : {};
      for (const [id, resolve] of batch) resolve(hits[id] ?? null);
    }

    function lookupPublicHit(userId: string): Promise<CurationRecord | null> {
      const existing = lookupInflight.get(userId);
      if (existing) return existing;
      const p = new Promise<CurationRecord | null>((resolve) => {
        lookupResolvers.set(userId, resolve);
        if (lookupResolvers.size >= LOOKUP_BATCH_MAX) {
          if (lookupTimer) {
            clearTimeout(lookupTimer);
            lookupTimer = undefined;
          }
          void flushLookupBatch();
        } else {
          scheduleLookupFlush();
        }
      });
      lookupInflight.set(userId, p);
      void p.finally(() => lookupInflight.delete(userId));
      return p;
    }

    window.addEventListener("mxga:x-users", (ev) => {
      if (!(ev instanceof CustomEvent) || typeof ev.detail !== "string") return;
      try {
        const payload = JSON.parse(ev.detail) as { users?: Parameters<typeof ingestGraphqlUsers>[0] };
        if (payload.users && ingestGraphqlUsers(payload.users)) setTimeout(scan, 0);
      } catch {
        /* ignore malformed page events */
      }
    });

    function findFinding(sig: Signals) {
      return findings.find((x) =>
        sig.userId
          ? x.userId === sig.userId
          : x.handle.toLowerCase() === sig.handle.toLowerCase(),
      );
    }

    function pushFinding(
      sig: Signals,
      v: Verdict,
      opts: {
        allowAnyLabel?: boolean;
        blockSource?: QSource;
        blockQueued?: boolean;
        blockActive?: boolean;
        blockFailed?: boolean;
        blocked?: boolean;
      } = {},
    ) {
      if (!opts.allowAnyLabel && !["spam", "porn_bot", "likely_spam"].includes(v.label)) {
        return null;
      }
      let finding = findFinding(sig);
      const snippet = sig.triggeringComment || sig.recentTweets[0] || sig.bio;
      if (!finding) {
        finding = {
          handle: sig.handle,
          verdict: v,
          ...(sig.userId ? { userId: sig.userId } : {}),
          ...(sig.avatarUrl ? { avatarUrl: sig.avatarUrl } : {}),
          ...(sig.displayName ? { displayName: sig.displayName } : {}),
          ...(snippet ? { snippet } : {}),
        };
        findings.push(finding);
      } else {
        finding.verdict = v;
        if (sig.userId && !finding.userId) finding.userId = sig.userId;
        if (sig.avatarUrl && !finding.avatarUrl) finding.avatarUrl = sig.avatarUrl;
        if (sig.displayName && !finding.displayName) finding.displayName = sig.displayName;
        if (snippet && !finding.snippet) finding.snippet = snippet;
      }
      if (opts.blockSource) finding.blockSource = opts.blockSource;
      if (opts.blockQueued !== undefined) finding.blockQueued = opts.blockQueued;
      if (opts.blockActive !== undefined) finding.blockActive = opts.blockActive;
      if (opts.blockFailed !== undefined) finding.blockFailed = opts.blockFailed;
      if (opts.blocked !== undefined) finding.blocked = opts.blocked;
      if (!dismissed) bubbleApi?.update(findings);
      return finding;
    }

    /** Returns true only if the account action really completed on X. */
    // Keep this path silent: call X's own account mute/block endpoint with
    // the user's first-party session and the page's csrf/auth headers, then
    // pace requests globally so bulk cleanup does not hammer X from multiple
    // tabs. "Mute" here is X account mute: hide this user's posts.
    async function tryAccountAction(sig: Signals): Promise<AccountActionAttempt> {
      return coordinatedAccountAction(settings.moderationAction, sig.userId, sig.handle);
    }

    async function finalizeAccountAction(
      key: string,
      sig: Signals,
      source: QSource = "manual",
    ) {
      await addBlocked(key);
      if (sig.userId) await addBlocked(sig.userId);
      const f = findFinding(sig);
      await addBlockRecord({
        id: key,
        handle: sig.handle,
        source,
        ts: Date.now(),
        ...(sig.displayName ? { displayName: sig.displayName } : {}),
        ...(sig.avatarUrl ? { avatarUrl: sig.avatarUrl } : {}),
        ...(f?.verdict ? { verdict: f.verdict, reason: f.verdict.reasons[0] } : {}),
      });
      await bumpStats({ blocks: 1 });
      hideTweet(anchorByKey.get(key) ?? null);
      // Skip the confirm_spam re-report on auto paths:
      //  - "list_hit"  : account is already publicly confirmed (that's how
      //    we got here); another confirm adds no evidence.
      //  - "cache_hit" : the user did not just take an explicit per-account
      //    action — they enabled a blanket setting. We treat the block as a
      //    private hygiene action, not a human-confirm signal to the public
      //    DB (otherwise toggling auto-block would inflate reporter counts
      //    based on stale local cache).
      // Manual blocks DO send confirm_spam — that's the user's explicit
      // per-account "yes, this is spam" signal. Manual mutes stay local-only:
      // account mute is a softer private hide action, not public curation.
      if (source === "manual" && settings.moderationAction === "block") {
        void send({ type: "confirm_spam", signals: sig });
      }
      if (f) {
        f.blocked = true;
        f.blockQueued = false;
        f.blockActive = false;
        f.blockFailed = false;
        f.blockSource = source;
      }
      if (!dismissed) bubbleApi?.update(findings);
    }

    async function runAccountAction(key: string, sig: Signals): Promise<boolean> {
      cancelClassify(key);
      const active = findFinding(sig);
      if (active) {
        active.blockQueued = false;
        active.blockActive = true;
        active.blockFailed = false;
        active.blockSource = "manual";
        if (!dismissed) bubbleApi?.update(findings);
      }
      const attempt = await tryAccountAction(sig);
      if (attempt.ok) {
        await finalizeAccountAction(key, sig);
        return true;
      }
      const f0 = findFinding(sig);
      if (f0) {
        f0.blockQueued = false;
        f0.blockActive = false;
        f0.blockFailed = true;
      }
      if (!dismissed) bubbleApi?.update(findings);
      return false;
    }

    // ---- Durable, non-blocking, rate-limit-aware bulk block queue ----
    // "manual"    → user clicked block / bulk-block button
    // "list_hit"  → autoBlockListHits + public-blacklist match (step 2)
    // "cache_hit" → autoBlockListHits + local cache says spam (step 1)
    let queue: QItem[] = [];
    let draining = false;
    const QK = "xss:blockQueue";
    const persistQ = () =>
      chrome.storage.local.set({
        [QK]: queue.map((q) => ({
          key: q.key,
          sig: q.sig,
          tries: q.tries,
          source: q.source,
          verdict: q.verdict,
        })),
      });

    async function drain() {
      if (draining) return;
      draining = true;
      while (queue.length) {
        const it = queue[0];
        if (!it) break;
        const activeFinding = findFinding(it.sig);
        if (activeFinding) {
          activeFinding.blockQueued = false;
          activeFinding.blockActive = true;
          activeFinding.blockFailed = false;
          if (!dismissed) bubbleApi?.update(findings);
        }
        const attempt = await tryAccountAction(it.sig).catch(
          (): AccountActionAttempt => ({ ok: false, retryable: true }),
        );
        if (attempt.ok) {
          await finalizeAccountAction(it.key, it.sig, it.source);
          queue.shift();
          await persistQ();
          if (!dismissed) bubbleApi?.update(findings);
          await sleep(BLOCK_SUCCESS_SETTLE_MS);
        } else {
          it.tries++;
          if (!attempt.retryable || it.tries >= 6) {
            const f = findFinding(it.sig);
            if (f) {
              f.blockQueued = false;
              f.blockActive = false;
              f.blockFailed = true;
            }
            queue.shift();
            if (!dismissed) bubbleApi?.update(findings);
          } else {
            const f = findFinding(it.sig);
            if (f) {
              f.blockQueued = true;
              f.blockActive = false;
              f.blockFailed = false;
              if (!dismissed) bubbleApi?.update(findings);
            }
            // X rate-limited / transiently unavailable → adaptive backoff,
            // but keep normal successful runs quick.
            await sleep(retryDelayForAttempt(attempt, it.tries));
          }
          await persistQ();
        }
      }
      draining = false;
      // Final card refresh — re-enables the "处理中…" button or shows the
      // empty state once the queue is fully drained.
      if (!dismissed) bubbleApi?.update(findings);
    }

    function enqueueBlocks(
      items: { key: string; sig: Signals; verdict?: Verdict }[],
      source: QSource = "manual",
    ) {
      for (const x of items) {
        if (x.verdict) {
          pushFinding(x.sig, x.verdict, {
            allowAnyLabel: source === "list_hit",
            blockQueued: true,
            blockActive: false,
            blockFailed: false,
            blockSource: source,
          });
        }
        if (!queue.some((q) => q.key === x.key)) queue.push({ ...x, tries: 0, source });
      }
      void persistQ();
      void drain(); // non-blocking; returns immediately
    }

    // Resume a queue interrupted by reload/navigation. Older persisted items
    // may lack `source` (pre-autoBlockListHits builds) — default them to
    // "manual" so the drain loop keeps the same behavior it had before.
    void chrome.storage.local.get(QK).then((g) => {
      const saved = g[QK] as Partial<QItem>[] | undefined;
      if (saved?.length) {
        queue = saved
          .filter((q): q is QItem & { source?: QSource } => !!q.key && !!q.sig)
          .map((q) => ({
            key: q.key,
            sig: q.sig,
            tries: q.tries ?? 0,
            source: q.source ?? "manual",
            ...(q.verdict ? { verdict: q.verdict } : {}),
          }));
        queue.forEach((q) => {
          if (q.verdict) {
            pushFinding(q.sig, q.verdict, {
              allowAnyLabel: q.source === "list_hit",
              blockQueued: true,
              blockActive: false,
              blockFailed: false,
              blockSource: q.source,
            });
          }
        });
        void drain();
      }
    });

    // De-dup the "已扫"counter — a single account may render a badge
    // multiple times (recycled DOM node) and we don't want a double-count.
    const scannedKeys = new Set<string>();
    const ignoredKeys = new Set<string>();
    // Keys for which we've already enqueued a list_hit auto-block. Without
    // this, scan() would re-fire the public /v1/check lookup on every tick
    // (every ~600ms via MutationObserver) until the paced block queue
    // actually drains and addBlocked() makes step 0b short-circuit. Cheap
    // local guard, no persistence — restored block queue items can no-op
    // re-enqueue safely anyway.
    const autoBlockingKeys = new Set<string>();
    function tallyScan(key: string) {
      if (scannedKeys.has(key)) return;
      scannedKeys.add(key);
      bubbleApi?.bumpScanned();
    }
    function isViewerKnownIgnored(sig: Signals) {
      return (
        sig.viewerIsSelf ||
        sig.viewerFollowing ||
        sig.viewerBlocking ||
        sig.viewerMuting ||
        sig.viewerFollowRequestSent
      );
    }
    function dropFinding(sig: Signals) {
      const id = sig.userId || sig.handle;
      const i = findings.findIndex((f) => (f.userId || f.handle) === id);
      if (i >= 0) {
        findings.splice(i, 1);
        if (!dismissed) bubbleApi?.update(findings);
      }
    }
    function cancelClassify(key: string) {
      const running = inflight.get(key);
      if (!running || running.canceled) return;
      running.canceled = true;
      void send({ type: "cancel_classify", requestId: running.requestId });
    }

    async function reportAccount(key: string, sig: Signals) {
      cancelClassify(key);
      const resp = await send({ type: "report_spam", signals: sig });
      if (!resp.ok) throw new Error(resp.error || "上报失败");
    }
    /**
     * Silent auto-block routing — shared by step 1 (cache) and step 2 (list).
     *
     * Two source-dependent rules:
     *   list_hit  → `/v1/check` server-side filters to status='human_confirmed'
     *               rows only. Being returned IS the confirmation; the verdict
     *               label is metadata about what the AI originally thought.
     *               An admin can blacklist an "uncertain 35%" account, and
     *               when they do, auto-block MUST still fire — otherwise the
     *               whole feature looks broken on admin-curated entries. So
     *               for list_hit we IGNORE verdict.label entirely.
     *   cache_hit → the local cache reflects this device's prior LLM judgment,
     *               which is NOT a human-confirmed signal. Auto-block only on
     *               spammy labels (spam / porn_bot / likely_spam) — never on
     *               an "uncertain" or "legit" cache row the user themselves
     *               would have been free to ignore.
     *
     * Bug history (v0.3):
     *   - First cut filtered by verdict.label in both branches. That meant
     *     admin-blacklisted "uncertain"-labeled accounts (a real case in
     *     prod: see Mary @Mary1463962 / Mark @Mark76056378472) were never
     *     auto-blocked even though the public list contained them.
     *   - Earlier cut only checked the list at step 2 — but step 1 cache
     *     short-circuits first, so anyone with prior LLM cache for the
     *     account never reached step 2 at all.
     *
     * Returns true if this account is now owned by the auto-block queue —
     * the caller MUST return immediately without rendering badges, pushing
     * findings, or doing any further work for this key.
     */
    function tryAutoBlock(
      key: string,
      sig: Signals,
      verdict: Verdict,
      anchor: HTMLElement,
      source: "list_hit" | "cache_hit",
    ): boolean {
      if (!settings.autoBlockListHits) return false;
      if (source === "cache_hit") {
        const spammy = ["spam", "porn_bot", "likely_spam"].includes(verdict.label);
        if (!spammy) return false;
      }
      autoBlockingKeys.add(key);
      tallyScan(key); // count it in the bubble's "已扫" total
      enqueueBlocks([{ key, sig, verdict }], source);
      mountBlocking(anchor, badgeActions(anchor, key, sig)); // the cell collapses once finalizeAccountAction runs
      return true;
    }
    function badgeActions(anchor: HTMLElement, key: string, sig: Signals) {
      return {
        onBlock: () => void runAccountAction(key, sig),
        onHide: () => hideTweet(anchor),
        onReport: () => reportAccount(key, sig),
        onAppeal: () => window.open(APPEAL_URL, "_blank", "noopener"),
        onCheck: () => void classify(anchor, key, sig),
        canReport,
        action: settings.moderationAction,
      };
    }

    function badgeFor(
      anchor: HTMLElement,
      key: string,
      sig: Signals,
      v: Verdict | null,
      note?: string,
      source: BadgeSource = "fresh",
    ) {
      tallyScan(key);
      clearMounts(anchor);
      mountBadge(anchor, () => createBadge(v, badgeActions(anchor, key, sig), note, source));
    }

    function renderCached(anchor: HTMLElement, key: string, sig: Signals, c: Cached) {
      badgeFor(anchor, key, sig, c.verdict, undefined, "cache");
      pushFinding(sig, c.verdict);
    }

    async function classify(anchor: HTMLElement, key: string, sig: Signals) {
      const running = inflight.get(key);
      if (running) return running.promise;
      mountStatus(anchor, "analyzing", badgeActions(anchor, key, sig)); // animated shimmer while AI works
      const requestId = crypto.randomUUID();
      const state: InflightClassify = {
        requestId,
        canceled: false,
        promise: Promise.resolve(),
      };
      const p = (async () => {
        const { isProfile: _p, ...rest } = sig;
        const resp = await send<{ record: CurationRecord; idResolved: boolean }>({
          type: "classify",
          requestId,
          signals: rest,
        });
        if (state.canceled || !resp.ok || !resp.data) return;
        const current = inflight.get(key);
        if (!current || current.requestId !== requestId || current.canceled) return;
        const { record, idResolved } = resp.data;
        badgeFor(anchor, key, sig, record.verdict, idResolved ? undefined : "数字ID未解析，handle 兜底", "fresh");
        pushFinding(sig, record.verdict);
        void bumpStats({ detections: 1, label: record.verdict.label });
        void cacheSet(key, {
          verdict: record.verdict,
          signalsHash: signalsHash(sig),
          model: record.model,
          ts: Date.now(),
          handle: sig.handle,
          ...(sig.displayName ? { displayName: sig.displayName } : {}),
          ...(sig.avatarUrl ? { avatarUrl: sig.avatarUrl } : {}),
        });
      })();
      state.promise = p;
      inflight.set(key, state);
      try {
        await p;
      } finally {
        const current = inflight.get(key);
        if (current?.requestId === requestId) inflight.delete(key);
      }
    }

    async function process(sig: Signals, anchor: HTMLElement) {
      const key = keyOf(sig);
      anchorByKey.set(key, anchor);

      // 0. Viewer-owned / viewer-followed / viewer-muted accounts are out
      // of scope for MXGA: do not lookup, classify, report, or show badges.
      if (isViewerKnownIgnored(sig)) {
        ignoredKeys.add(key);
        clearMounts(anchor);
        dropFinding(sig);
        return;
      }

      // 0b. Already blocked → hide, never render/analyze/request again.
      if (isBlockedSync(key) || (sig.userId && isBlockedSync(sig.userId))) {
        hideTweet(anchor);
        return;
      }

      // 0c. Already enqueued for silent auto-block on an earlier tick — the
      //     paced drain queue owns it; skip cache / list / LLM work so we
      //     don't repeat lookups or stack up badges while finalizeBlocked
      //     is still pending. Once drain succeeds, addBlocked() makes 0b
      //     short-circuit instead.
      if (autoBlockingKeys.has(key)) {
        mountBlocking(anchor, badgeActions(anchor, key, sig));
        return;
      }

      // 0a. Maintainer whitelist (L0a) — admin-curated accounts that
      //     should never be touched by AI. Local mirror is refreshed every
      //     6h in the bg worker; miss = unknown = fall through normally.
      //     UX: source="whitelist" makes the badge a visible green ✓
      //     so the user knows this is *vetted* (not "we just didn't bother").
      if (isWhitelisted(sig.handle, sig.userId)) {
        badgeFor(anchor, key, sig, null, undefined, "whitelist");
        return;
      }

      // 1. Persistent cache (spam reused as-is; legit/uncertain only if signals
      //    unchanged so new evidence can still re-trigger).
      const cached = await cacheGet(key);
      if (cached) {
        // 1a. autoBlockListHits power-user opt-in: a cached-spammy verdict
        //     is the system's own prior judgment that this account is spam.
        //     Without this branch, anyone who had ever LLM-classified spam
        //     before enabling the toggle would see auto-block do nothing on
        //     those accounts — they'd short-circuit at renderCached below.
        if (tryAutoBlock(key, sig, cached.verdict, anchor, "cache_hit")) return;
        const spammy = ["spam", "porn_bot", "likely_spam"].includes(cached.verdict.label);
        if (spammy || cached.signalsHash === signalsHash(sig)) {
          renderCached(anchor, key, sig, cached);
          void bumpStats({ cacheHits: 1 }); // an LLM call saved
          return;
        }
      }

      // 2. Public/known list (no LLM).
      if (sig.userId) {
        const hit = await lookupPublicHit(sig.userId);
        if (hit) {
          const hitVerdict = hit.verdict;
          // 2a. autoBlockListHits power-user opt-in: public-blacklist hits
          //     are community-confirmed spam, so block silently on every
          //     page the user visits, no card / badge / click required.
          if (tryAutoBlock(key, sig, hitVerdict, anchor, "list_hit")) return;
          badgeFor(anchor, key, sig, hitVerdict, undefined, "list");
          pushFinding(sig, hitVerdict);
          return;
        }
      }

      // 3 + 4. New account → LLM. Reply section lowers the heuristic
      //        threshold but never bypasses it — old established accounts
      //        with no promo language are short-circuited as likely-legit
      //        WITHOUT spending an LLM call. This is the core fix for the
      //        admin queue being flooded with established accounts that
      //        happened to appear in reply zones.
      if (inflight.has(key)) return;
      const h = heuristic(sig);
      // Implicit trust: account > 2y old AND heuristic finds nothing
      // suspicious (score < 0.15 = no promo/link/random handle / no low
      // followers). Skip the LLM entirely; treat as quietly-clean.
      const ageDays = sig.accountAgeDays;
      const isEstablished = typeof ageDays === "number" && ageDays > 730;
      if (isEstablished && h.score < 0.15) {
        badgeFor(anchor, key, sig, null); // looks legit, manual check still available
        return;
      }
      // Reply context lowers the bar (catches subtle bots in replies) but
      // still honors heuristic; main timeline keeps the stricter 0.5.
      const threshold =
        settings.replyAuto && isReplyContext() ? 0.25 : AUTO_THRESHOLD;
      const wantAuto = h.score >= threshold;
      if (!wantAuto) {
        badgeFor(anchor, key, sig, null); // clean-looking → manual check
        return;
      }
      if (!takeToken()) {
        // Out of burst budget. Mark PENDING (not final) so the next scan /
        // periodic tick reprocesses it as tokens refill — newly loaded
        // comments are never permanently skipped.
        mountPending(anchor);
        return;
      }
      active++;
      bubbleApi?.setScanning(active);
      void classify(anchor, key, sig).finally(() => {
        active--;
        bubbleApi?.setScanning(active);
      });
    }

    function scan() {
      const p = extractProfile();
      if (p) {
        const el = document.querySelector<HTMLElement>('[data-testid="UserName"]');
        if (el) void process(p, el);
      }
      // Account-keyed, NOT node-tagged: X virtualizes the list and recycles
      // <article> nodes, so a permanent per-node flag would skip recycled
      // (new) spam. Re-evaluate a node when its account changed or our badge
      // is missing; account-level cache/in-flight keep it cheap.
      const topic = extractThreadTopic();
      for (const art of document.querySelectorAll<HTMLElement>(
        'article[data-testid="tweet"]',
      )) {
        const info = extractFromArticle(art);
        const nameBlock = art.querySelector<HTMLElement>('[data-testid="User-Name"]');
        if (!info || !nameBlock) continue;
        if (topic && !info.threadTopic) info.threadTopic = topic;
        const key = keyOf(info);
        const hasMount = !!nameBlock.querySelector(":scope > .xss-mount");
        if (nodeKey.get(art) === key) {
          if (ignoredKeys.has(key)) continue;
          if (hasMount && !isViewerKnownIgnored(info)) continue;
        }
        if (nodeKey.get(art) !== key) clearMounts(nameBlock); // recycled node
        nodeKey.set(art, key);
        void process(info, nameBlock);
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
          onBlockAll(fs: Finding[]) {
            // Non-blocking: enqueue all; a durable paced queue drains in the
            // background (survives reload, backs off on X's rate limit).
            enqueueBlocks(
              fs.map((f) => ({
                key: f.userId || `h:${f.handle}`,
                verdict: f.verdict,
                sig: {
                  isProfile: false as const,
                  handle: f.handle,
                  displayName: f.displayName ?? "",
                  bio: "",
                  hasDefaultAvatar: false,
                  recentTweets: [],
                  ...(f.userId ? { userId: f.userId } : {}),
                  ...(f.avatarUrl ? { avatarUrl: f.avatarUrl } : {}),
                },
              })),
            );
          },
          onBlockOne(f: Finding) {
            void runAccountAction(f.userId || `h:${f.handle}`, {
              isProfile: false,
              handle: f.handle,
              displayName: "",
              bio: "",
              hasDefaultAvatar: false,
              recentTweets: [],
              ...(f.userId ? { userId: f.userId } : {}),
            });
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
        }, settings.bubblePos, settings.moderationAction);
        container.appendChild(bubble.el);
        if (!settings.bubble) bubble.el.style.display = "none";
        bubbleApi = bubble;
        return bubble;
      },
    });
    ui.mount();

    let t: ReturnType<typeof setTimeout>;
    new MutationObserver(() => {
      clearTimeout(t);
      t = setTimeout(scan, 600);
    }).observe(document.documentElement, { childList: true, subtree: true });
    // Periodic tick so the pending queue drains as tokens refill, even
    // when the user stops scrolling (no new DOM mutations).
    setInterval(scan, 4000);
    scan();
  },
});
