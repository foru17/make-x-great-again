// L2 — persistent account-verdict cache (chrome.storage.local).
// Verdict is account-level, not comment-level: once we've judged an account
// we must not re-spend an LLM call when it reappears in another tweet /
// reply / session. This is the dominant cost saver.
import type { Verdict } from "./types";

const PREFIX = "xss:v1:";
const DAY = 86_400_000;

// TTL by outcome: spam doesn't reform quickly; uncertain should re-evaluate
// sooner in case more signal appears.
function ttl(label: Verdict["label"]): number {
  if (label === "spam" || label === "porn_bot") return 30 * DAY;
  if (label === "likely_spam") return 14 * DAY;
  if (label === "legit") return 14 * DAY;
  return 3 * DAY; // uncertain
}

export interface Cached {
  verdict: Verdict;
  signalsHash: string;
  model: string;
  ts: number;
  handle?: string;
  displayName?: string;
  avatarUrl?: string;
}

/** Tiny stable hash of the signals that actually drive the verdict. */
export function signalsHash(parts: {
  handle: string;
  displayName: string;
  bio: string;
  recentTweets: string[];
  triggeringComment?: string;
  hasDefaultAvatar: boolean;
  accountAgeDays?: number;
}): string {
  // triggeringComment is hashed on its own: the article path no longer
  // mirrors it into recentTweets, and a new tweet must still count as new
  // evidence for a cached legit/uncertain verdict.
  const s = JSON.stringify([
    parts.handle,
    parts.displayName,
    parts.bio,
    parts.recentTweets,
    parts.triggeringComment ?? "",
    parts.hasDefaultAvatar,
    parts.accountAgeDays ?? null,
  ]);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

const key = (id: string) => PREFIX + id;

export async function cacheGet(id: string): Promise<Cached | null> {
  try {
    const k = key(id);
    const got = await chrome.storage.local.get(k);
    const c = got[k] as Cached | undefined;
    if (!c) return null;
    if (Date.now() - c.ts > ttl(c.verdict.label)) {
      void chrome.storage.local.remove(k);
      return null;
    }
    return c;
  } catch {
    return null; // storage unavailable → behave as cache miss
  }
}

export async function cacheSet(id: string, c: Cached): Promise<void> {
  try {
    await chrome.storage.local.set({ [key(id)]: c });
  } catch {
    /* non-fatal */
  }
}
