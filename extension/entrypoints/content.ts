import { isBlockedSync, warm as warmBlocklist, addBlocked } from "../lib/blocklist";
import { BRAND } from "../lib/brand";
import { onSettingsChange, getSettings } from "../lib/settings";
import { bumpStats } from "../lib/store";
import { bumpStat } from "../lib/stats";
import { type Cached, cacheGet, cacheSet, signalsHash } from "../lib/cache";
import {
  AUTO_THRESHOLD,
  extractFromArticle,
  extractProfile,
  extractThreadTopic,
  heuristic,
} from "../lib/detect";
import { lookupLocal, warmLocalIndex, type IndexEntry } from "../lib/local-index";
import type { Signals, Verdict } from "../lib/types";
import {
  type BadgeSource,
  type Finding,
  STYLE,
  createBadge,
  createBubble,
  createStatusBadge,
} from "../lib/ui";

async function submitAppeal(sig: Signals): Promise<void> {
  try {
    const s = await getSettings();
    const base = s.edgeBase || BRAND.edgeBase;
    await fetch(`${base}/v1/appeal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        handle: sig.handle,
        ...(sig.userId ? { userId: sig.userId } : {}),
        reason: "extension appeal button",
      }),
    });
  } catch (err) {
    console.warn("[mxga] appeal failed", err);
  }
}

/** Send a message to the background script (admin-only: GitHub auth, health). */
function send<T = unknown>(msg: unknown): Promise<{ ok: boolean; data?: T; error?: string }> {
  return new Promise((r) =>
    chrome.runtime.sendMessage(msg, (resp: { ok: boolean; data?: T; error?: string } | undefined) =>
      r(resp ?? { ok: false }),
    ),
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r));

function articleOf(node: Element | null): HTMLElement | null {
  return (node?.closest("article") as HTMLElement) ?? null;
}

function hideTweet(node: Element | null) {
  const cell =
    node?.closest('[data-testid="cellInnerDiv"]') ?? node?.closest("article");
  if (cell instanceof HTMLElement) cell.style.display = "none";
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

// ---- 5-second preview undo queue (PENDING_MS) ----
const PENDING_MS = 5000;

interface PendingAction {
  key: string;
  sig: Signals;
  anchor: HTMLElement;
  timer: ReturnType<typeof setTimeout>;
  ts: number;
}

const pendingActions = new Map<string, PendingAction>();

/** Schedule a hide action with a 5-second undo window. */
function scheduleHide(key: string, sig: Signals, anchor: HTMLElement) {
  if (pendingActions.has(key)) return; // already pending
  const timer = setTimeout(() => {
    executeHide(key, sig, anchor);
    pendingActions.delete(key);
  }, PENDING_MS);
  pendingActions.set(key, { key, sig, anchor, timer, ts: Date.now() });
  // Update UI to show pending state
  badgeForPending(anchor, sig);
}

/** Cancel a pending hide action (user clicked undo). */
function cancelPending(key: string) {
  const pending = pendingActions.get(key);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingActions.delete(key);
  // Restore the badge to its previous state
  clearMounts(pending.anchor);
}

/** Execute the actual hide after the preview window expires. */
function executeHide(key: string, sig: Signals, _anchor: HTMLElement) {
  void addBlocked(key);
  if (sig.userId) void addBlocked(sig.userId);
  void bumpStats({ blocks: 1 });
  void bumpStat("blocked");
  hideTweet(
    pendingActions.get(key)?.anchor ??
      document.querySelector(`[data-xss-key="${key}"]`),
  );
}

function badgeForPending(anchor: HTMLElement, sig: Signals) {
  clearMounts(anchor);
  mountBadge(anchor, () => {
    const el = document.createElement("span");
    el.className = "xss-badge pending";
    el.innerHTML = `<span style="color:var(--warn)">⏳ 5秒后隐藏</span>
      <button data-undo style="margin-left:6px;padding:1px 6px;border:1px solid var(--warn);background:transparent;color:var(--warn);border-radius:4px;font-size:10px;cursor:pointer">撤销</button>`;
    el.querySelector("[data-undo]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      cancelPending(sig.userId || `h:${sig.handle}`);
    });
    return el;
  });
}

export default defineContentScript({
  matches: ["https://x.com/*", "https://twitter.com/*"],
  cssInjectionMode: "ui",
  async main(ctx) {
    let bubbleApi: ReturnType<typeof createBubble> | null = null;
    let dismissed = false;
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

    // Warm local data structures
    await warmBlocklist();
    await warmLocalIndex();

    const isReplyContext = () => /^\/[^/]+\/status\/\d+/.test(location.pathname);
    const keyOf = (s: Signals) => s.userId || `h:${s.handle}`;

    function pushFinding(sig: Signals, v: Verdict, source: string) {
      if (!["spam", "porn_bot", "likely_spam"].includes(v.label)) return;
      const id = sig.userId || sig.handle;
      if (findings.some((f) => (f.userId || f.handle) === id)) return;
      const snippet = sig.triggeringComment || sig.recentTweets[0] || sig.bio;
      findings.push({
        handle: sig.handle,
        verdict: v,
        source,
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
      clearMounts(anchor);
      mountBadge(anchor, () =>
        createBadge(
          v,
          {
            onHide: () => scheduleHide(key, sig, anchor),
            onAppeal: () => void submitAppeal(sig),
          },
          note,
          source,
        ),
      );
    }

    function renderCached(anchor: HTMLElement, key: string, sig: Signals, c: Cached) {
      badgeFor(anchor, key, sig, c.verdict, undefined, "cache");
      pushFinding(sig, c.verdict, "cache");
    }

    function renderLocalIndex(anchor: HTMLElement, key: string, sig: Signals, entry: IndexEntry) {
      badgeFor(anchor, key, sig, entry.verdict, undefined, "list");
      pushFinding(sig, entry.verdict, "local-index");
      void bumpStat("hitPublic");
    }

    async function process(sig: Signals, anchor: HTMLElement) {
      const key = keyOf(sig);
      anchorByKey.set(key, anchor);

      // 0. Already blocked → hide, never render again.
      if (isBlockedSync(key) || (sig.userId && isBlockedSync(sig.userId))) {
        hideTweet(anchor);
        return;
      }

      // 1. Check pending undo queue — skip if already scheduled.
      if (pendingActions.has(key)) return;

      // 2. Persistent cache (spam reused as-is; legit/uncertain only if signals
      //    unchanged so new evidence can still re-trigger).
      const cached = await cacheGet(key);
      if (cached) {
        const spammy = ["spam", "porn_bot", "likely_spam"].includes(cached.verdict.label);
        if (spammy || cached.signalsHash === signalsHash(sig)) {
          renderCached(anchor, key, sig, cached);
          void bumpStats({ cacheHits: 1 });
          return;
        }
      }

      // 3. Local public index lookup (no remote requests, <50ms).
      const entry = lookupLocal(sig.userId, sig.handle);
      if (entry) {
        renderLocalIndex(anchor, key, sig, entry);
        return;
      }

      // 4. Local public list did not match. Just show neutral/unhit state.
      badgeFor(anchor, key, sig, null);
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
          onHideAll(keys: string[]) {
            // Schedule all hides with 5s undo window
            for (const key of keys) {
              const anchor = anchorByKey.get(key);
              if (anchor) {
                // Find the signals from findings
                const f = findings.find(
                  (x) => (x.userId || `h:${x.handle}`) === key,
                );
                if (f) {
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
                  scheduleHide(key, sig, anchor);
                }
              }
            }
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
