// L2 — persistent account-verdict cache (chrome.storage.local).
// Verdict is account-level, not comment-level: once we've judged an account
// we must not re-spend an LLM call when it reappears in another tweet /
// reply / session. This is the dominant cost saver.
import type { Signals, Verdict } from "./types";

const PREFIX = "xss:v1:";
const DAY = 86_400_000;

// TTL by outcome. Spam used to be kept for 30 days: one wrong verdict then
// fixed a red mark on an account for a month, across every later tweet, with
// no re-look (2026-09-04 audit). A week is long enough to spare the LLM call
// on a bot that keeps showing up, short enough that a mistake heals; day-old
// spam entries are also re-checked against the edge (content.ts renderCached).
function ttl(label: Verdict["label"]): number {
  if (label === "spam" || label === "porn_bot") return 7 * DAY;
  if (label === "likely_spam") return 7 * DAY;
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

/** Counters drift on every render (a follower gained, a post made); hashing
 *  them raw would make an ACCOUNT-level cache miss on every view. Bucket by
 *  powers of two — a legit account stays "the same account" until it grows
 *  (or shrinks) by half, which is when the model's read could change. */
function bucket(n: number | undefined): number | null {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  return n < 2 ? n : Math.round(Math.log2(n) * 2);
}

/** Tiny stable hash of the ACCOUNT evidence that drives the verdict.
 *
 *  This key answers "have we already judged this account on this evidence"
 *  — it is what lets a legit account cost one online check instead of one
 *  per thread. So it deliberately excludes per-VIEW context (threadTopic,
 *  surface, isReply, replyTo, rootAuthor, templateRepeats, translation
 *  flag): those change with every thread the account appears in, and the
 *  edge already hashes the full model input with its own status TTLs. What
 *  is in: identity text, the triggering text, avatar/verification facts,
 *  and bucketed counters. */
export function signalsHash(parts: Pick<Signals, "handle" | "displayName" | "bio" | "recentTweets" | "hasDefaultAvatar"> & Partial<Signals>): string {
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
    parts.avatarSource ?? null,
    parts.isVerified ?? false,
    parts.location ?? "",
    bucket(parts.accountAgeDays === undefined ? undefined : Math.floor(parts.accountAgeDays / 30)),
    bucket(parts.followersCount),
    bucket(parts.followingCount),
    bucket(parts.statusesCount),
    bucket(parts.mediaCount),
    bucket(parts.favouritesCount),
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
