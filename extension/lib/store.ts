// Single typed accessor over chrome.storage.local. Backward-safe: a legacy
// string[] blocklist auto-migrates to records on first read. All local, no
// PII beyond the public numeric id (governance unchanged).
import type { Verdict } from "./types";

// "list_hit"  → public-blacklist match (step 2 of content.ts)
// "cache_hit" → local cache says this account is spam (step 1 of content.ts)
// Both are auto-block sources that fire when settings.autoBlockListHits is on.
export type BlockSource = "manual" | "block_all" | "list_hit" | "cache_hit";

export interface BlockRecord {
  id: string; // userId, or h:<handle> fallback
  handle: string;
  displayName?: string;
  avatarUrl?: string;
  verdict?: Verdict;
  reason?: string;
  source: BlockSource;
  ts: number;
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

export async function addBlockRecord(rec: BlockRecord): Promise<void> {
  const list = await getBlocklist();
  if (list.some((r) => r.id === rec.id)) return;
  list.push(rec);
  await set(K_BLOCK, list);
}

export async function removeBlock(id: string): Promise<void> {
  const list = await getBlocklist();
  await set(
    K_BLOCK,
    list.filter((r) => r.id !== id),
  );
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
  const s = await getStats();
  s.detections += patch.detections ?? 0;
  s.cacheHits += patch.cacheHits ?? 0;
  s.blocks += patch.blocks ?? 0;
  if (patch.label) s.byLabel[patch.label] = (s.byLabel[patch.label] ?? 0) + 1;
  await set(K_STATS, s);
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
