// Local achievement counters — what THIS user has done with the extension.
// Lives in chrome.storage.local. NOT synced to the Worker, NOT PII —
// purely a "你已经帮社区干掉 N 个号" UX feel-good signal in the popup.
//
// Bumped by the content script as the user browses:
//   - lookup hit → "命中本地名单（零成本）"
//   - hide       → "你亲手隐藏了一个"

import { withKeyLock } from "./store";

export interface LocalStats {
  /** Legacy counter from the AI era — kept for storage compatibility. */
  scanned: number;
  /** Total accounts that hit the bundled blacklist (once per account/session). */
  hitPublic: number;
  /** Total times the user clicked the in-page hide button. */
  blocked: number;
  /** First-ever use timestamp; lets us show "陪你 N 天了". */
  firstUsedAt: number;
}

const KEY = "mxga_stats_v1";

export async function getStats(): Promise<LocalStats> {
  return new Promise((resolve) => {
    chrome.storage.local.get(KEY, (got) => {
      const s = (got?.[KEY] ?? {}) as Partial<LocalStats>;
      resolve({
        scanned: s.scanned ?? 0,
        hitPublic: s.hitPublic ?? 0,
        blocked: s.blocked ?? 0,
        firstUsedAt: s.firstUsedAt ?? Date.now(),
      });
    });
  });
}

export async function bumpStatBy(
  key: keyof Omit<LocalStats, "firstUsedAt">,
  n = 1,
): Promise<void> {
  await withKeyLock(KEY, async () => {
    const cur = await getStats();
    cur[key] = (cur[key] ?? 0) + Math.max(0, Math.floor(n));
    // Set firstUsedAt the first time we bump anything from a fresh install.
    if (!cur.firstUsedAt) cur.firstUsedAt = Date.now();
    await new Promise<void>((r) => chrome.storage.local.set({ [KEY]: cur }, () => r()));
  });
}

export async function bumpStat(key: keyof Omit<LocalStats, "firstUsedAt">): Promise<void> {
  await bumpStatBy(key, 1);
}
