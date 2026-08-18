// Local persistent blocklist. Once the user blocks an account it is hidden
// on every page forever and never re-rendered / re-analyzed / re-requested
// (the strongest short-circuit + the user-confirm signal for the public DB).
const KEY = "xss:blocked";

let mem: Set<string> | null = null;
const optimisticAdds = new Set<string>();

type LockCapableNavigator = Navigator & {
  locks?: {
    request<T>(name: string, callback: () => T | Promise<T>): Promise<T>;
  };
};

const lockChains = new Map<string, Promise<unknown>>();
async function withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
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

// Keep the in-memory set in sync across contexts: when the options page
// un-hides an account (or another tab hides one), every open X tab must see
// the change without a reload.
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[KEY]) {
      mem = new Set<string>((changes[KEY]?.newValue as string[]) ?? []);
      for (const id of optimisticAdds) mem.add(id);
    }
  });
} catch {
  /* not running in an extension context (e.g. tests) — non-fatal */
}

async function load(): Promise<Set<string>> {
  if (mem) return mem;
  try {
    const got = await chrome.storage.local.get(KEY);
    mem = new Set<string>((got[KEY] as string[]) ?? []);
  } catch {
    mem = new Set();
  }
  return mem;
}

export async function isBlocked(id: string): Promise<boolean> {
  return (await load()).has(id);
}

/** Synchronous check once the set is warm (after the first load()). */
export function isBlockedSync(id: string): boolean {
  return mem ? mem.has(id) : false;
}

export async function warm(): Promise<void> {
  await load();
}

export async function addBlocked(id: string): Promise<void> {
  try {
    await addBlockedMany([id]);
  } catch {
    /* non-fatal for legacy single-id callers */
  }
}

export async function addBlockedMany(ids: string[]): Promise<void> {
  const unique = [...new Set(ids)];
  if (!unique.length) return;

  // Keep the synchronous fast path optimistic: callers often intentionally
  // do not await persistence, while process() immediately checks this set.
  if (!mem) mem = new Set();
  for (const id of unique) {
    optimisticAdds.add(id);
    mem.add(id);
  }

  try {
    await withKeyLock(KEY, async () => {
      const got = await chrome.storage.local.get(KEY);
      const authoritative = new Set<string>((got[KEY] as string[]) ?? []);
      for (const id of unique) authoritative.add(id);
      await chrome.storage.local.set({ [KEY]: [...authoritative] });
      mem = new Set([...authoritative, ...optimisticAdds]);
    });
  } finally {
    for (const id of unique) optimisticAdds.delete(id);
  }
}

export async function removeBlocked(id: string): Promise<void> {
  try {
    await withKeyLock(KEY, async () => {
      const got = await chrome.storage.local.get(KEY);
      const authoritative = new Set<string>((got[KEY] as string[]) ?? []);
      if (!authoritative.delete(id)) {
        mem = authoritative;
        return;
      }
      await chrome.storage.local.set({ [KEY]: [...authoritative] });
      mem = authoritative;
    });
  } catch {
    /* non-fatal */
  }
}
