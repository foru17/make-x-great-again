import { isBlockedSync, warm as warmBlocklist, addBlocked } from "../lib/blocklist";
import { BRAND } from "../lib/brand";
import { onSettingsChange, getSettings } from "../lib/settings";
import { addBlockRecord, bumpStats } from "../lib/store";
import { type Cached, cacheGet, cacheSet, signalsHash } from "../lib/cache";
import {
  AUTO_THRESHOLD,
  extractFromArticle,
  extractProfile,
  extractThreadTopic,
  heuristic,
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

/** Find a currently-rendered tweet authored by this account (by numeric id
 *  from the avatar URL, else by the @handle profile link). */
function findArticleFor(userId?: string, handle?: string): HTMLElement | null {
  for (const art of document.querySelectorAll<HTMLElement>(
    'article[data-testid="tweet"]',
  )) {
    if (userId) {
      const img = art.querySelector<HTMLImageElement>('img[src*="profile_images/"]');
      if (img?.src.match(/profile_images\/(\d+)\//)?.[1] === userId) return art;
    }
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
 */
async function nativeBlock(art: HTMLElement): Promise<boolean> {
  try {
    const caret = art.querySelector<HTMLElement>('[data-testid="caret"]');
    if (!caret) return false;
    caret.click();
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
    const isReplyContext = () => /^\/[^/]+\/status\/\d+/.test(location.pathname);
    const keyOf = (s: Signals) => s.userId || `h:${s.handle}`;

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
      return apiBlock(sig.userId, sig.handle);
    }

    async function finalizeBlocked(key: string, sig: Signals) {
      await addBlocked(key);
      if (sig.userId) await addBlocked(sig.userId);
      const f = findings.find((x) => (x.userId || x.handle) === (sig.userId || sig.handle));
      await addBlockRecord({
        id: key,
        handle: sig.handle,
        source: "manual",
        ts: Date.now(),
        ...(sig.displayName ? { displayName: sig.displayName } : {}),
        ...(sig.avatarUrl ? { avatarUrl: sig.avatarUrl } : {}),
        ...(f?.verdict ? { verdict: f.verdict, reason: f.verdict.reasons[0] } : {}),
      });
      await bumpStats({ blocks: 1 });
      hideTweet(anchorByKey.get(key) ?? null);
      void send({ type: "confirm_spam", signals: sig }); // human-confirm signal
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
    type QItem = { key: string; sig: Signals; tries: number };
    let queue: QItem[] = [];
    let draining = false;
    const QK = "xss:blockQueue";
    const persistQ = () =>
      chrome.storage.local.set({ [QK]: queue.map((q) => ({ key: q.key, sig: q.sig, tries: q.tries })) });

    async function drain() {
      if (draining) return;
      draining = true;
      while (queue.length) {
        const it = queue[0];
        if (!it) break;
        bubbleApi?.setScanning(queue.length); // progress: 拉黑中 N
        const ok = await tryRealBlock(it.sig).catch(() => false);
        if (ok) {
          await finalizeBlocked(it.key, it.sig);
          queue.shift();
          await persistQ();
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
    }

    function enqueueBlocks(items: { key: string; sig: Signals }[]) {
      for (const x of items) {
        if (!queue.some((q) => q.key === x.key)) queue.push({ ...x, tries: 0 });
      }
      void persistQ();
      void drain(); // non-blocking; returns immediately
    }

    // Resume a queue interrupted by reload/navigation.
    void chrome.storage.local.get(QK).then((g) => {
      const saved = g[QK] as QItem[] | undefined;
      if (saved?.length) {
        queue = saved;
        void drain();
      }
    });

    function badgeFor(
      anchor: HTMLElement,
      key: string,
      sig: Signals,
      v: Verdict | null,
      note?: string,
      source: BadgeSource = "fresh",
    ) {
      clearMounts(anchor);
      mountBadge(anchor, () =>
        createBadge(
          v,
          {
            onBlock: () => void blockAccount(key, sig),
            onHide: () => hideTweet(anchor),
            onReport: () => void send({ type: "confirm_spam", signals: sig }),
            onAppeal: () => window.open(APPEAL_URL, "_blank", "noopener"),
            onCheck: () => void classify(anchor, key, sig),
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

      // 0. Already blocked → hide, never render/analyze/request again.
      if (isBlockedSync(key) || (sig.userId && isBlockedSync(sig.userId))) {
        hideTweet(anchor);
        return;
      }

      // 1. Persistent cache (spam reused as-is; legit/uncertain only if signals
      //    unchanged so new evidence can still re-trigger).
      const cached = await cacheGet(key);
      if (cached) {
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
          badgeFor(anchor, key, sig, r.data.hit.verdict, undefined, "list");
          pushFinding(sig, r.data.hit.verdict);
          return;
        }
      }

      // 3 + 4. New account → LLM. Reply section lowers the heuristic
      //        threshold but never bypasses it — old established accounts
      //        with no promo language are short-circuited as likely-legit
      //        WITHOUT spending an LLM call. This is the core fix for the
      //        admin queue being flooded with established accounts that
      //        happened to appear in reply zones (LUO-32 / Wave 11).
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
        if (nodeKey.get(art) === key && hasMount) continue;
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
    // Periodic tick so the pending backlog drains as tokens refill, even
    // when the user stops scrolling (no new DOM mutations).
    setInterval(scan, 4000);
    scan();
  },
});
