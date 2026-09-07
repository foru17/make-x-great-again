// Template-repeat memory (local only).
//
// The classifier's strongest corroboration for a reply-section bot is "the
// same template posted across unrelated threads" — but a single page view only
// ever shows one comment, so the client never had that signal to give. This
// module remembers, per author, a short ring of HASHES of the triggering
// comments this browser has seen, and reports only a NUMBER: how many earlier
// sightings of this exact text there were (`templateRepeats`).
//
// Privacy: nothing but djb2 hashes and timestamps are stored, on this machine,
// bounded in size and age; the upload is one integer. No text leaves the
// device through this path.
import type { Signals } from "./types";

export const TEMPLATE_MEMORY_KEY = "xss:tpl:v1";
/** Per-author ring length. */
const PER_HANDLE = 6;
/** Total authors remembered; oldest evicted beyond this. */
const MAX_HANDLES = 3000;
/** Sightings older than this no longer count (and are pruned on write). */
const TTL_MS = 14 * 86_400_000;

interface Sighting {
  h: string; // text hash
  ts: number;
  /** Status id of the post, when known — the same post seen twice (another
   *  surface, a re-scan after a cache miss) must not count as a repeat. */
  id?: string;
}
type Store = Record<string, Sighting[]>; // handle (lower) → sightings, newest last

function hashText(t: string): string {
  const s = t.trim().toLowerCase().replace(/\s+/g, " ");
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

async function readStore(): Promise<Store> {
  try {
    const got = await chrome.storage.local.get(TEMPLATE_MEMORY_KEY);
    const v = got[TEMPLATE_MEMORY_KEY];
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Store) : {};
  } catch {
    return {};
  }
}

async function writeStore(s: Store): Promise<void> {
  try {
    await chrome.storage.local.set({ [TEMPLATE_MEMORY_KEY]: s });
  } catch {
    /* best-effort */
  }
}

let chain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

/** Record this sighting and return how many EARLIER sightings of the same
 *  text by the same author this browser remembers (0 = first time). Texts
 *  too short to be a template are not tracked. */
export function noteTemplate(
  sig: Signals,
  now = Date.now(),
  tweetId: string | null = null,
): Promise<number> {
  const text = (sig.triggeringComment ?? "").trim();
  if (text.length < 6) return Promise.resolve(0);
  return serialized(async () => {
    const store = await readStore();
    const key = sig.handle.toLowerCase();
    const h = hashText(text);
    const fresh = (store[key] ?? []).filter((s) => now - s.ts < TTL_MS);
    // Same post already recorded → report the count of OTHER sightings of
    // this text and do not add a duplicate.
    if (tweetId && fresh.some((s) => s.id === tweetId)) {
      const others = fresh.filter((s) => s.h === h && s.id !== tweetId).length;
      store[key] = fresh;
      await writeStore(store);
      return others;
    }
    const repeats = fresh.filter((s) => s.h === h).length;
    fresh.push({ h, ts: now, ...(tweetId ? { id: tweetId } : {}) });
    store[key] = fresh.slice(-PER_HANDLE);
    // Global bound: evict the authors seen longest ago.
    const keys = Object.keys(store);
    if (keys.length > MAX_HANDLES) {
      keys
        .map((k) => [k, Math.max(...(store[k] ?? []).map((s) => s.ts), 0)] as const)
        .sort((a, b) => a[1] - b[1])
        .slice(0, keys.length - MAX_HANDLES)
        .forEach(([k]) => delete store[k]);
    }
    await writeStore(store);
    return repeats;
  });
}
