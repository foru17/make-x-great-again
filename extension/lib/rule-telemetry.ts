// Anonymous OFFICIAL-rule-hit telemetry (background-owned).
//
// Purpose: local rule hits are otherwise invisible to the shared service —
// the wave a rule catches on one user's timeline never reaches the public
// list. This module reports the HIT ITSELF so the maintainer can see which
// rules fire and review the caught accounts.
//
// Privacy contract (mirrors the settings-page copy — keep them in sync):
//   - payload rows are ONLY {matched official pattern, spam account handle,
//     spam account numeric id, category} — the spam account's public identity,
//     never the reporting user's (no auth, no fingerprint, no page context);
//   - gated by settings.ruleTelemetry (visible switch, on by default);
//   - custom rules NEVER report (enforced at the content-script call site AND
//     server-side, where unknown patterns are dropped);
//   - server-side these rows land in an isolated stats table — they cannot
//     create queue entries or blacklist rows (红线: the extension never
//     auto-publishes; a human promotes stats rows explicitly).
//
// Transport discipline: dedup by (pattern, handle) with a 7-day sent memory,
// batch ≤50 rows, flush on a 30-minute alarm or queue pressure — one tab
// hitting a spam wave must not turn into a request per rendered tweet.
import { edgeBase } from "./list-sync";
import { getSettings } from "./settings";

export interface RuleHitReport {
  pattern: string;
  handle: string;
  xUserId?: string;
  category?: string;
}

export const RULE_HITS_STORE_KEY = "xss:rulehits:v1";
const MAX_QUEUE = 500;
const MAX_SENT_KEYS = 2000;
const SENT_TTL_MS = 7 * 86_400_000;
const FLUSH_BATCH = 50;
/** Queue length that triggers an eager flush ahead of the alarm. */
const FLUSH_PRESSURE = 20;

const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const USER_ID_RE = /^\d{1,32}$/;

interface QueueRow {
  p: string; // pattern
  h: string; // handle (original case)
  u: string; // x_user_id ("" unknown)
  c: string; // category ("" unknown)
  ts: number;
}

interface Store {
  queue: QueueRow[];
  /** dedup key -> epoch ms last successfully reported */
  sent: Record<string, number>;
}

const keyOf = (pattern: string, handle: string) => `${pattern}${handle.toLowerCase()}`;

async function readStore(): Promise<Store> {
  try {
    const got = await chrome.storage.local.get(RULE_HITS_STORE_KEY);
    const v = got[RULE_HITS_STORE_KEY] as Partial<Store> | undefined;
    return {
      queue: Array.isArray(v?.queue) ? (v.queue as QueueRow[]) : [],
      sent: v?.sent && typeof v.sent === "object" ? (v.sent as Record<string, number>) : {},
    };
  } catch {
    return { queue: [], sent: {} };
  }
}

async function writeStore(s: Store): Promise<void> {
  try {
    await chrome.storage.local.set({ [RULE_HITS_STORE_KEY]: s });
  } catch {
    /* storage unavailable — telemetry is strictly best-effort */
  }
}

function pruneSent(sent: Record<string, number>, now: number): Record<string, number> {
  let entries = Object.entries(sent).filter(([, ts]) => now - ts < SENT_TTL_MS);
  if (entries.length > MAX_SENT_KEYS) {
    entries = entries.sort((a, b) => b[1] - a[1]).slice(0, MAX_SENT_KEYS);
  }
  return Object.fromEntries(entries);
}

// storage.local has no transactions; serialize every read-modify-write so two
// racing rule-hit messages can't overwrite each other's queue append.
let chain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

/** Queue an official-rule hit. Returns true when a flush is now warranted
 *  (queue pressure) — the background decides whether to run it. */
export function enqueueRuleHit(hit: RuleHitReport): Promise<boolean> {
  return serialized(async () => {
    const settings = await getSettings();
    if (!settings.ruleTelemetry) return false;
    const handle = hit.handle?.trim() ?? "";
    const pattern = hit.pattern?.trim() ?? "";
    if (!HANDLE_RE.test(handle) || !pattern || pattern.length > 200) return false;
    const uid = hit.xUserId && USER_ID_RE.test(hit.xUserId) ? hit.xUserId : "";
    const now = Date.now();
    const store = await readStore();
    store.sent = pruneSent(store.sent, now);
    const k = keyOf(pattern, handle);
    if (store.sent[k] !== undefined) return false;
    if (store.queue.some((r) => keyOf(r.p, r.h) === k)) return false;
    store.queue.push({ p: pattern, h: handle, u: uid, c: hit.category ?? "", ts: now });
    if (store.queue.length > MAX_QUEUE) store.queue = store.queue.slice(-MAX_QUEUE);
    await writeStore(store);
    return store.queue.length >= FLUSH_PRESSURE;
  });
}

/** POST up to one batch of queued hits. Failures keep the queue for the next
 *  alarm tick; successes move keys into the sent memory. */
export function flushRuleHits(): Promise<void> {
  return serialized(async () => {
    const settings = await getSettings();
    if (!settings.ruleTelemetry) return;
    const store = await readStore();
    if (!store.queue.length) return;
    const batch = store.queue.slice(0, FLUSH_BATCH);
    let ok = false;
    try {
      const base = await edgeBase();
      const res = await fetch(`${base}/v1/rule-hits`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hits: batch.map((r) => ({
            pattern: r.p,
            handle: r.h,
            ...(r.u ? { xUserId: r.u } : {}),
            ...(r.c ? { category: r.c } : {}),
          })),
        }),
      });
      // 4xx = the server rejected the batch shape/content — retrying the same
      // rows forever is pointless, so treat it as consumed. Only network
      // errors / 5xx / 429 keep the batch queued.
      ok = res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429);
    } catch {
      ok = false;
    }
    if (!ok) return;
    const now = Date.now();
    store.sent = pruneSent(store.sent, now);
    for (const r of batch) store.sent[keyOf(r.p, r.h)] = now;
    store.queue = store.queue.slice(batch.length);
    await writeStore(store);
  });
}
