import { isBlockedSync, warm as warmBlocklist, addBlocked } from "../lib/blocklist";
import { BRAND } from "../lib/brand";
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

function articleOf(node: Element | null): HTMLElement | null {
  return (node?.closest("article") as HTMLElement) ?? null;
}

/** Find a currently-rendered tweet authored by this account. */
function findArticleFor(_userId?: string, handle?: string): HTMLElement | null {
  for (const art of document.querySelectorAll<HTMLElement>(
    'article[data-testid="tweet"]',
  )) {
    if (handle) {
      const nb = art.querySelector('[data-testid="User-Name"]');
      if (
        nb &&
        [...nb.querySelectorAll<HTMLAnchorElement>('a[href^="/"]')].some(
          (a) => (a.getAttribute("href") ?? "").toLowerCase() === `/${handle.toLowerCase()}`,
        )
      )
        return art;
    }
  }
  return null;
}

function hideTweet(node: Element | null) {
  const cell =
    node?.closest('[data-testid="cellInnerDiv"]') ?? node?.closest("article");
  if (cell instanceof HTMLElement) cell.style.display = "none";
}

// X web's long-standing public bearer (same one the site itself uses).
const X_BEARER =
  "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
const ct0 = () => (document.cookie.match(/ct0=([^;]+)/)?.[1] ?? "");

/**
 * Real X block via the site's own authenticated endpoint, using the user's
 * existing session (same first-party request the Block button makes). This
 * is the user-initiated action they explicitly asked for: it blocks on
 * their X account so it syncs to every browser/client. Falls back to DOM
 * automation only if this fails.
 */
async function apiBlock(userId?: string, handle?: string): Promise<boolean> {
  try {
    const body = new URLSearchParams();
    if (userId && /^\d+$/.test(userId)) body.set("user_id", userId);
    else if (handle) body.set("screen_name", handle);
    else return false;
    const res = await fetch("https://x.com/i/api/1.1/blocks/create.json", {
      method: "POST",
      credentials: "include",
      headers: {
        authorization: X_BEARER,
        "x-csrf-token": ct0(),
        "x-twitter-auth-type": "OAuth2Session",
        "x-twitter-active-user": "yes",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const waitFor = async <T>(fn: () => T, tries = 24, gap = 80): Promise<T | null> => {
  for (let i = 0; i < tries; i++) {
    const v = fn();
    if (v) return v;
    await sleep(gap);
  }
  return null;
};

/**
 * PRIMARY block path: drive X's OWN block UI (caret → Block → confirm). X's
 * own JS issues the correctly-signed request (incl. the per-request
 * transaction id we can't forge), so it genuinely blocks on the account and
 * syncs to every client. Returns true ONLY when the confirm was clicked and
 * the dialog closed (real success — never a false positive).
 *
 * `trigger` may be:
 *  - an `<article>` element (feed / reply tree): we look for `[data-testid="caret"]`
 *  - the profile header (when the user is ON the target's profile page): we
 *    fall back to `[data-testid="userActions"]` which opens the same menu.
 */
async function nativeBlock(trigger: HTMLElement): Promise<boolean> {
  try {
    // Tweet caret first; profile "..." button second.
    const opener =
      trigger.querySelector<HTMLElement>('[data-testid="caret"]') ??
      document.querySelector<HTMLElement>('[data-testid="userActions"]');
    if (!opener) return false;
    opener.click();
    const item = await waitFor(() => {
      const direct = document.querySelector<HTMLElement>(
        '[data-testid="block"], [role="menuitem"][data-testid="block"]',
      );
      if (direct) return direct;
      const items = document.querySelectorAll<HTMLElement>(
        '[role="menuitem"], [data-testid="Dropdown"] [role="menuitem"]',
      );
      return [...items].find((m) => /\bblock\b|屏蔽|封锁|拉黑/i.test(m.innerText)) ?? null;
    });
    if (!item) {
      document.body.click(); // close the menu
      return false;
    }
    item.click();
    const confirm = await waitFor(() =>
      document.querySelector<HTMLElement>('[data-testid="confirmationSheetConfirm"]'),
    );
    if (!confirm) return false;
    confirm.click();
    // Real success: the confirm sheet goes away.
    const gone = await waitFor(
      () => !document.querySelector('[data-testid="confirmationSheetConfirm"]'),
      20,
      80,
    );
    return !!gone;
  } catch {
    return false;
  }
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
function mountStatus(anchor: HTMLElement, kind: "analyzing" | "pending") {
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
  sr.append(st, createStatusBadge(kind));
  anchor.appendChild(host);
}
const mountPending = (a: HTMLElement) => mountStatus(a, "pending");

export default defineContentScript({
  matches: ["https://x.com/*", "https://twitter.com/*"],
  cssInjectionMode: "ui",
  async main(ctx) {
    let bubbleApi: ReturnType<typeof createBubble> | null = null;
    let dismissed = false;
    let canReport = false;
    const inflight = new Map<string, Promise<void>>(); // L0 in-flight de-dup
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

    window.addEventListener("mxga:x-users", (ev) => {
      if (!(ev instanceof CustomEvent) || typeof ev.detail !== "string") return;
      try {
        const payload = JSON.parse(ev.detail) as { users?: Parameters<typeof ingestGraphqlUsers>[0] };
        if (payload.users && ingestGraphqlUsers(payload.users)) setTimeout(scan, 0);
      } catch {
        /* ignore malformed page events */
      }
    });

    function pushFinding(sig: Signals, v: Verdict) {
      if (!["spam", "porn_bot", "likely_spam"].includes(v.label)) return;
      const id = sig.userId || sig.handle;
      if (findings.some((f) => (f.userId || f.handle) === id)) return;
      const snippet = sig.triggeringComment || sig.recentTweets[0] || sig.bio;
      findings.push({
        handle: sig.handle,
        verdict: v,
        ...(sig.userId ? { userId: sig.userId } : {}),
        ...(sig.avatarUrl ? { avatarUrl: sig.avatarUrl } : {}),
        ...(sig.displayName ? { displayName: sig.displayName } : {}),
        ...(snippet ? { snippet } : {}),
      });
      if (!dismissed) bubbleApi?.update(findings);
    }

    /** Returns true only if the account was REALLY blocked on X. */
    // The ONLY reliable real block = drive X's own UI so X's JS issues the
    // request with its per-request x-client-transaction-id (can't be forged
    // or replayed). API call is a best-effort fallback that usually fails.
    async function tryRealBlock(sig: Signals): Promise<boolean> {
      let art =
        articleOf(anchorByKey.get(sig.userId || `h:${sig.handle}`) ?? null) ??
        findArticleFor(sig.userId, sig.handle);
      if (art) {
        art.scrollIntoView({ block: "center" });
        await sleep(300);
        art = findArticleFor(sig.userId, sig.handle) ?? art;
      }
      if (art && (await nativeBlock(art))) return true;

      // Profile-page fallback: when we're ON the target's profile page and
      // no in-DOM tweet exists for them yet, drive the profile header's
      // "..." (userActions) menu instead. The handle in `location.pathname`
      // must match; otherwise we'd risk blocking whoever's page we're on.
      const onProfile = location.pathname.match(/^\/([^/]+)(?:\/|$)/)?.[1]?.toLowerCase();
      if (onProfile && sig.handle.toLowerCase() === onProfile) {
        const userActions = document.querySelector<HTMLElement>('[data-testid="userActions"]');
        if (userActions && (await nativeBlock(userActions))) return true;
      }

      return apiBlock(sig.userId, sig.handle);
    }

    async function finalizeBlocked(
      key: string,
      sig: Signals,
      source: "manual" | "list_hit" | "cache_hit" = "manual",
    ) {
      await addBlocked(key);
      if (sig.userId) await addBlocked(sig.userId);
      const f = findings.find((x) => (x.userId || x.handle) === (sig.userId || sig.handle));
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
      // Skip the confirm_spam re-report on auto-block paths:
      //  - "list_hit"  : account is already publicly confirmed (that's how
      //    we got here); another confirm adds no evidence.
      //  - "cache_hit" : the user did not just take an explicit per-account
      //    action — they enabled a blanket setting. We treat the block as a
      //    private hygiene action, not a human-confirm signal to the public
      //    DB (otherwise toggling auto-block would inflate reporter counts
      //    based on stale local cache).
      // Manual blocks DO send confirm_spam — that's the user's explicit
      // per-account "yes, this is spam" signal.
      if (source === "manual") {
        void send({ type: "confirm_spam", signals: sig });
      }
      const i = findings.findIndex((x) => (x.userId || x.handle) === (sig.userId || sig.handle));
      if (i >= 0) findings.splice(i, 1);
      if (!dismissed) bubbleApi?.update(findings);
    }

    async function blockAccount(key: string, sig: Signals): Promise<boolean> {
      if (await tryRealBlock(sig)) {
        await finalizeBlocked(key, sig);
        return true;
      }
      const f0 = findings.find((x) => (x.userId || x.handle) === (sig.userId || sig.handle));
      if (f0) f0.blockFailed = true;
      if (!dismissed) bubbleApi?.update(findings);
      return false;
    }

    // ---- Durable, non-blocking, rate-limit-aware bulk block queue ----
    // "manual"    → user clicked block / bulk-block button
    // "list_hit"  → autoBlockListHits + public-blacklist match (step 2)
    // "cache_hit" → autoBlockListHits + local cache says spam (step 1)
    type QSource = "manual" | "list_hit" | "cache_hit";
    type QItem = { key: string; sig: Signals; tries: number; source: QSource };
    let queue: QItem[] = [];
    let draining = false;
    const QK = "xss:blockQueue";
    const persistQ = () =>
      chrome.storage.local.set({
        [QK]: queue.map((q) => ({ key: q.key, sig: q.sig, tries: q.tries, source: q.source })),
      });

    async function drain() {
      if (draining) return;
      draining = true;
      while (queue.length) {
        const it = queue[0];
        if (!it) break;
        bubbleApi?.setScanning(queue.length); // progress: 拉黑中 N
        const ok = await tryRealBlock(it.sig).catch(() => false);
        if (ok) {
          await finalizeBlocked(it.key, it.sig, it.source);
          // Mark the finding as done so the next card render strikes it out
          // (gives the user feedback that progress is happening — otherwise
          // the "处理中…" button reads as stuck on profile pages where each
          // block takes ~2s).
          const f = findings.find(
            (x) => (x.userId || x.handle) === (it.sig.userId || it.sig.handle),
          );
          if (f) f.blocked = true;
          queue.shift();
          await persistQ();
          if (!dismissed) bubbleApi?.update(findings);
          await sleep(1800); // pace: stay under X's block rate limit
        } else {
          it.tries++;
          if (it.tries >= 6) {
            const f = findings.find(
              (x) => (x.userId || x.handle) === (it.sig.userId || it.sig.handle),
            );
            if (f) f.blockFailed = true;
            queue.shift();
            if (!dismissed) bubbleApi?.update(findings);
          } else {
            // X rate-limited / not found yet → exponential backoff, keep it.
            await sleep(Math.min(30000, 2000 * 2 ** it.tries));
          }
          await persistQ();
        }
      }
      draining = false;
      bubbleApi?.setScanning(0);
      // Final card refresh — re-enables the "处理中…" button or shows the
      // empty state once the queue is fully drained.
      if (!dismissed) bubbleApi?.update(findings);
    }

    function enqueueBlocks(
      items: { key: string; sig: Signals }[],
      source: QSource = "manual",
    ) {
      for (const x of items) {
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
          }));
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
    async function reportAccount(sig: Signals) {
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
      enqueueBlocks([{ key, sig }], source);
      clearMounts(anchor); // the cell collapses once the queue's finalizeBlocked runs
      return true;
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
      mountBadge(anchor, () =>
        createBadge(
          v,
          {
            onBlock: () => void blockAccount(key, sig),
            onHide: () => hideTweet(anchor),
            onReport: () => reportAccount(sig),
            onAppeal: () => window.open(APPEAL_URL, "_blank", "noopener"),
            onCheck: () => void classify(anchor, key, sig),
            canReport,
          },
          note,
          source,
        ),
      );
    }

    function renderCached(anchor: HTMLElement, key: string, sig: Signals, c: Cached) {
      badgeFor(anchor, key, sig, c.verdict, undefined, "cache");
      pushFinding(sig, c.verdict);
    }

    async function classify(anchor: HTMLElement, key: string, sig: Signals) {
      const running = inflight.get(key);
      if (running) return running;
      mountStatus(anchor, "analyzing"); // animated shimmer while AI works
      const p = (async () => {
        const { isProfile: _p, ...rest } = sig;
        const resp = await send<{ record: CurationRecord; idResolved: boolean }>({
          type: "classify",
          signals: rest,
        });
        if (!resp.ok || !resp.data) return;
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
      inflight.set(key, p);
      try {
        await p;
      } finally {
        inflight.delete(key);
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
        clearMounts(anchor);
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
        const r = await send<{ hit: CurationRecord | null }>({
          type: "lookup",
          userId: sig.userId,
        });
        if (r.ok && r.data?.hit) {
          const hitVerdict = r.data.hit.verdict;
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
            void blockAccount(f.userId || `h:${f.handle}`, {
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
        }, settings.bubblePos);
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
