// Local persistent blocklist. Once the user blocks an account it is hidden
// on every page forever and never re-rendered / re-analyzed / re-requested
// (the strongest short-circuit + the user-confirm signal for the public DB).
export const BLOCKED_KEY = "xss:blocked";

let mem: Set<string> | null = null;

// Keep the in-memory set in sync across contexts: when the options page
// un-hides an account (or another tab hides one), every open X tab must see
// the change without a reload.
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[BLOCKED_KEY]) {
      mem = new Set<string>((changes[BLOCKED_KEY]?.newValue as string[]) ?? []);
    }
  });
} catch {
  /* not running in an extension context (e.g. tests) — non-fatal */
}

async function load(): Promise<Set<string>> {
  if (mem) return mem;
  try {
    const got = await chrome.storage.local.get(BLOCKED_KEY);
    mem = new Set<string>((got[BLOCKED_KEY] as string[]) ?? []);
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
  const s = await load();
  if (s.has(id)) return;
  s.add(id);
  try {
    await chrome.storage.local.set({ [BLOCKED_KEY]: [...s] });
  } catch {
    /* non-fatal */
  }
}

export async function removeBlocked(id: string): Promise<void> {
  const s = await load();
  if (!s.delete(id)) return;
  try {
    await chrome.storage.local.set({ [BLOCKED_KEY]: [...s] });
  } catch {
    /* non-fatal */
  }
}
