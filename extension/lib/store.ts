// Single typed accessor over chrome.storage.local. Backward-safe: a legacy
// string[] blocklist auto-migrates to records on first read. All local, no
// PII beyond the public numeric id (governance unchanged).
import { removeBlocked } from "./blocklist";
import type { Verdict } from "./types";

// "manual"    → user clicked 隐藏 on a badge / bubble
// "auto"      → per-category action policy fired on a public-blacklist hit
// "list_hit"  → public-blacklist match (step 2 of content.ts)
// "cache_hit" → local cache says this account is spam (step 1 of content.ts)
// (Legacy sources from the auto-block era are kept for old stored records.)
export type BlockSource = "manual" | "auto" | "block_all" | "list_hit" | "cache_hit";

export interface BlockRecord {
  id: string; // userId, or h:<handle> fallback
  handle: string;
  displayName?: string;
  avatarUrl?: string;
  verdict?: Verdict;
  reason?: string;
  /** The tweet/reply that triggered the action — audit trail so the user
   *  can revisit the scene (https://x.com/<handle>/status/<tweetId>).
   *  Absent when the action happened without a tweet context (profile
   *  header, cross-page batch after DOM recycling). */
  tweetId?: string;
  /** Snapshot of the triggering text — survives tweet deletion. */
  tweetText?: string;
  source: BlockSource;
  ts: number;
}

/** An X mute/block that was committed locally (row hidden + id recorded) but
 *  whose PACED X-action hasn't settled yet. Tracked in its OWN storage key —
 *  NOT on the block record — because getBlocklist()'s legacy migration
 *  synthesizes bare records from the fast-path id set and would strip a field
 *  living on the record. A leftover entry after a page load means the in-queue
 *  died before the X call fired: the account got only a local hide, must not
 *  be shown as 已处理, and must be resumed. */
export interface PendingXAction {
  id: string;
  handle: string;
  action: "mute" | "block";
  ts: number;
}

/** Permalink of the triggering tweet, when recorded. */
export function tweetUrl(r: Pick<BlockRecord, "handle" | "tweetId">): string | null {
  return r.tweetId
    ? `https://x.com/${encodeURIComponent(r.handle)}/status/${r.tweetId}`
    : null;
}

export interface Stats {
  detections: number; // total LLM classifications performed
  cacheHits: number; // LLM calls saved by the L2 cache
  blocks: number;
  byLabel: Record<string, number>;
}

const K_BLOCK = "xss:blocklist:v2";
const K_BLOCK_LEGACY = "xss:blocked";
const K_STATS = "xss:stats";
const K_PENDING = "xss:pending-actions";

type LockCapableNavigator = Navigator & {
  locks?: {
    request<T>(name: string, callback: () => T | Promise<T>): Promise<T>;
  };
};

const lockChains = new Map<string, Promise<unknown>>();

/** Serialize storage RMW operations for this key. Web Locks cover tabs that
 * share the same origin/storage bucket only; an X content script does not
 * share its LockManager with the extension options page or another origin. */
export async function withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const locks =
    typeof navigator === "undefined"
      ? undefined
      : (navigator as LockCapableNavigator).locks;
  if (locks) return locks.request(`mxga-store:${key}`, fn);

  const previous = lockChains.get(key) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  lockChains.set(key, run.catch(() => {}));
  return run;
}

async function get<T>(key: string, fallback: T): Promise<T> {
  try {
    const g = await chrome.storage.local.get(key);
    return (g[key] as T) ?? fallback;
  } catch {
    return fallback;
  }
}
async function set(key: string, val: unknown): Promise<void> {
  try {
    await chrome.storage.local.set({ [key]: val });
  } catch {
    /* non-fatal */
  }
}

async function getStrict<T>(key: string, fallback: T): Promise<T> {
  const stored = await chrome.storage.local.get(key);
  return (stored[key] as T) ?? fallback;
}

async function setStrict(key: string, val: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: val });
}

export async function getBlocklist(): Promise<BlockRecord[]> {
  const v2 = await get<BlockRecord[] | null>(K_BLOCK, null);
  if (v2) return v2;
  // migrate legacy string[] of ids
  const legacy = await get<string[]>(K_BLOCK_LEGACY, []);
  const migrated: BlockRecord[] = legacy.map((id) => ({
    id,
    handle: id.startsWith("h:") ? id.slice(2) : id,
    source: "manual",
    ts: Date.now(),
  }));
  if (migrated.length) await set(K_BLOCK, migrated);
  return migrated;
}

export async function addBlockRecords(recs: BlockRecord[]): Promise<void> {
  if (!recs.length) return;
  await withKeyLock(K_BLOCK, async () => {
    const v2 = await getStrict<BlockRecord[] | null>(K_BLOCK, null);
    let migrated = false;
    let list: BlockRecord[];
    if (v2) {
      list = v2;
    } else {
      const legacy = await getStrict<string[]>(K_BLOCK_LEGACY, []);
      list = legacy.map((id) => ({
        id,
        handle: id.startsWith("h:") ? id.slice(2) : id,
        source: "manual",
        ts: Date.now(),
      }));
      migrated = list.length > 0;
    }

    const ids = new Set(list.map((record) => record.id));
    let added = false;
    for (const rec of recs) {
      if (ids.has(rec.id)) continue;
      ids.add(rec.id);
      list.push(rec);
      added = true;
    }
    if (added || migrated) await setStrict(K_BLOCK, list);
  });
}

export async function addBlockRecord(rec: BlockRecord): Promise<void> {
  try {
    await addBlockRecords([rec]);
  } catch {
    /* non-fatal for legacy single-record callers */
  }
}

export async function updateBlockRecord(
  id: string,
  patch: Partial<Omit<BlockRecord, "id">>,
): Promise<void> {
  await withKeyLock(K_BLOCK, async () => {
    const list = await getBlocklist();
    const i = list.findIndex((r) => r.id === id);
    const rec = list[i];
    if (!rec) return;
    const merged: BlockRecord = { ...rec, ...patch };
    // A patch value of undefined means "clear this field" (e.g. settling
    // pendingAction) — drop the key rather than persisting an undefined.
    for (const k of Object.keys(patch) as (keyof typeof patch)[]) {
      if (patch[k] === undefined) delete merged[k];
    }
    list[i] = merged;
    await set(K_BLOCK, list);
  });
}

function withPendingLock<T>(fn: () => Promise<T>): Promise<T> {
  return withKeyLock(K_PENDING, fn);
}

export async function getPendingActions(): Promise<PendingXAction[]> {
  return get<PendingXAction[]>(K_PENDING, []);
}

/** Record an X action that's been committed locally but not yet fired. */
export async function addPendingAction(p: PendingXAction): Promise<void> {
  return withPendingLock(async () => {
    const list = await getPendingActions();
    if (list.some((x) => x.id === p.id)) return;
    list.push(p);
    await set(K_PENDING, list);
  });
}

/** Settle a pending X action (fired or abandoned) — remove it. */
export async function clearPendingAction(id: string): Promise<void> {
  return withPendingLock(async () => {
    const list = await getPendingActions();
    const next = list.filter((x) => x.id !== id);
    if (next.length !== list.length) await set(K_PENDING, next);
  });
}

export async function removeBlock(id: string): Promise<void> {
  await withKeyLock(K_BLOCK, async () => {
    const list = await getBlocklist();
    await set(
      K_BLOCK,
      list.filter((r) => r.id !== id),
    );
  });
  // Also reconcile the fast-path id set (xss:blocked) that content.ts hides
  // by — otherwise un-hiding never takes effect on X pages. Acquire its lock
  // only after releasing K_BLOCK so the two independent locks cannot deadlock.
  await removeBlocked(id);
}

export async function blockedIdSet(): Promise<Set<string>> {
  return new Set((await getBlocklist()).map((r) => r.id));
}

export async function getStats(): Promise<Stats> {
  return get<Stats>(K_STATS, {
    detections: 0,
    cacheHits: 0,
    blocks: 0,
    byLabel: {},
  });
}

export async function bumpStats(patch: Partial<Stats> & { label?: string }): Promise<void> {
  await withKeyLock(K_STATS, async () => {
    const s = await getStats();
    s.detections += patch.detections ?? 0;
    s.cacheHits += patch.cacheHits ?? 0;
    s.blocks += patch.blocks ?? 0;
    if (patch.label) s.byLabel[patch.label] = (s.byLabel[patch.label] ?? 0) + 1;
    await set(K_STATS, s);
  });
}

/** Clear all local extension data (privacy). */
export async function clearAllLocal(): Promise<void> {
  try {
    await chrome.storage.local.clear();
  } catch {
    /* non-fatal */
  }
}

export interface CacheRow {
  id: string;
  handle: string;
  displayName?: string;
  avatarUrl?: string;
  verdict: Verdict;
  model: string;
  ts: number;
}

/** All L2 cache entries (keys prefixed xss:v1:) for the cache browser. */
export async function getCacheRows(): Promise<CacheRow[]> {
  try {
    const all = await chrome.storage.local.get(null);
    const rows: CacheRow[] = [];
    for (const [k, v] of Object.entries(all)) {
      if (!k.startsWith("xss:v1:")) continue;
      const c = v as {
        verdict: Verdict;
        model: string;
        ts: number;
        handle?: string;
        displayName?: string;
        avatarUrl?: string;
      };
      if (!c?.verdict) continue;
      rows.push({
        id: k.slice("xss:v1:".length),
        handle: c.handle ?? k.slice("xss:v1:".length),
        verdict: c.verdict,
        model: c.model,
        ts: c.ts,
        ...(c.displayName ? { displayName: c.displayName } : {}),
        ...(c.avatarUrl ? { avatarUrl: c.avatarUrl } : {}),
      });
    }
    return rows.sort((a, b) => b.ts - a.ts);
  } catch {
    return [];
  }
}
