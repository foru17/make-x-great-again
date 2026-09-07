// Local whitelist — the user's OWN never-touch list. Highest-priority guard in
// the whole detection chain: an account here is never badged, never sent for
// online detection, never rule-matched and — the reason it exists — never
// auto-processed, even when the public list or a rule says spam.
//
// Two ways in:
//   - manual: the user adds a handle from the badge popover or the options
//     page (白名单 tab);
//   - following: accounts the viewer follows are added automatically when
//     they are seen with the viewer-follows relationship (X's own `following`
//     flag via the fiber bridge, the profile follow button, the Following
//     feed, the viewer's own /following page). Gated by
//     settings.followingWhitelist (default on).
//
// One way to say "not this one": removing an entry also records the handle
// as EXCLUDED from automatic re-adding — otherwise a followed account the
// user deliberately removed would be back on the next scroll. A manual add
// lifts the exclusion; the options page can clear all exclusions.
//
// Stored only on this machine (chrome.storage.local); never uploaded, never
// part of any telemetry or report. Mirrors the official whitelist's shape of
// protection (see local-index.ts isWhitelisted) but is fully user-owned.
import type { Signals } from "./types";

export const LOCAL_WL_KEY = "xss:whitelist:local";
export type LocalWhitelistSource = "manual" | "following";

export interface LocalWhitelistEntry {
  /** Original-case handle, no leading @. */
  handle: string;
  userId?: string;
  displayName?: string;
  /** Profile image as rendered on X (pbs.twimg.com only), for the list UI. */
  avatarUrl?: string;
  source: LocalWhitelistSource;
  addedAt: number;
}

export interface LocalWhitelistStore {
  entries: LocalWhitelistEntry[];
  /** Lower-cased handles the user removed — never auto-added again. */
  excluded: string[];
}

/** Hard cap on entries — a very large following list still fits, while a
 *  runaway harvest cannot grow storage without bound. */
export const MAX_LOCAL_WHITELIST = 20_000;
const MAX_EXCLUDED = 5_000;

const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const USER_ID_RE = /^\d{1,32}$/;
const AVATAR_RE = /^https:\/\/pbs\.twimg\.com\/[^\s"'<>]{1,300}$/;

export function normalizeWhitelistHandle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const h = raw.trim().replace(/^@+/, "");
  return HANDLE_RE.test(h) ? h : null;
}

// In-memory mirrors for the synchronous hot-path check. Rebuilt from storage
// on warm and on every storage change (any tab / the options page).
let handles = new Set<string>();
let ids = new Set<string>();
let excludedSet = new Set<string>();
/** The onChanged emitter we subscribed to — re-subscribe if the runtime
 *  object is swapped (test doubles); a real page only ever has one. */
let subscribedTo: unknown = null;

function rebuild(store: LocalWhitelistStore): void {
  const h = new Set<string>();
  const i = new Set<string>();
  for (const e of store.entries) {
    if (e?.handle) h.add(e.handle.toLowerCase());
    if (e?.userId) i.add(e.userId);
  }
  handles = h;
  ids = i;
  excludedSet = new Set(store.excluded);
}

function sanitizeEntries(raw: unknown): LocalWhitelistEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: LocalWhitelistEntry[] = [];
  const seen = new Set<string>();
  for (const row of raw as Partial<LocalWhitelistEntry>[]) {
    const handle = normalizeWhitelistHandle(row?.handle);
    if (!handle) continue;
    const k = handle.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      handle,
      ...(typeof row.userId === "string" && USER_ID_RE.test(row.userId) ? { userId: row.userId } : {}),
      ...(typeof row.displayName === "string" && row.displayName
        ? { displayName: row.displayName.slice(0, 80) }
        : {}),
      ...(typeof row.avatarUrl === "string" && AVATAR_RE.test(row.avatarUrl)
        ? { avatarUrl: row.avatarUrl }
        : {}),
      source: row.source === "following" ? "following" : "manual",
      addedAt: typeof row.addedAt === "number" && Number.isFinite(row.addedAt) && row.addedAt >= 0 ? row.addedAt : 0,
    });
    if (out.length >= MAX_LOCAL_WHITELIST) break;
  }
  return out;
}

function sanitizeExcluded(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    const h = normalizeWhitelistHandle(typeof v === "string" ? v : undefined);
    if (!h) continue;
    const k = h.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
    if (out.length >= MAX_EXCLUDED) break;
  }
  return out;
}

function sanitize(raw: unknown): LocalWhitelistStore {
  const v = (raw && typeof raw === "object" ? raw : {}) as Partial<LocalWhitelistStore>;
  return { entries: sanitizeEntries(v.entries), excluded: sanitizeExcluded(v.excluded) };
}

/** Validate an untrusted list (storage, backup file) into clean entries. */
export function sanitizeLocalWhitelist(raw: unknown): LocalWhitelistEntry[] {
  return sanitize(raw).entries;
}

/** Validate an untrusted exclusion list (backup file). */
export function sanitizeLocalWhitelistExcluded(raw: unknown): string[] {
  return sanitizeExcluded(raw);
}

async function readStore(): Promise<LocalWhitelistStore> {
  try {
    const got = await chrome.storage.local.get(LOCAL_WL_KEY);
    return sanitize(got[LOCAL_WL_KEY]);
  } catch {
    return { entries: [], excluded: [] };
  }
}

async function writeStore(store: LocalWhitelistStore): Promise<void> {
  rebuild(store); // optimistic: the hot path sees the change before the storage event
  try {
    await chrome.storage.local.set({ [LOCAL_WL_KEY]: store });
  } catch {
    /* storage unavailable — the in-memory mirror still protects this page */
  }
}

// storage.local has no transactions; serialize read-modify-writes so a
// burst of following-harvest adds can't drop each other's rows.
let chain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

/** Replace the whole list (backup import). Exclusions are replaced too when
 *  given, otherwise kept. */
export function replaceLocalWhitelist(
  entries: LocalWhitelistEntry[],
  excluded?: string[],
): Promise<void> {
  return serialized(async () => {
    const cur = await readStore();
    await writeStore(sanitize({ entries, excluded: excluded ?? cur.excluded }));
  });
}

/** Load the list into memory and keep it in sync across tabs/pages. */
export async function warmLocalWhitelist(): Promise<void> {
  rebuild(await readStore());
  try {
    const emitter = chrome.storage.onChanged;
    if (subscribedTo === emitter) return;
    subscribedTo = emitter;
    emitter.addListener((changes, area) => {
      if (area !== "local" || !changes[LOCAL_WL_KEY]) return;
      rebuild(sanitize(changes[LOCAL_WL_KEY].newValue));
    });
  } catch {
    /* no storage events (tests) — warm() reloads are enough */
  }
}

/** Synchronous membership check — the hot-path guard. Either identity form
 *  matches: a handle-only sighting must still be protected when the entry
 *  was stored with a uid, and vice versa. */
export function isLocallyWhitelisted(userId?: string, handle?: string): boolean {
  if (userId && ids.has(userId)) return true;
  if (handle && handles.has(handle.toLowerCase())) return true;
  return false;
}

/** The user removed this account before — automatic paths must leave it out. */
export function isExcludedFromAuto(handle?: string): boolean {
  return !!handle && excludedSet.has(handle.toLowerCase());
}

export function localWhitelistSize(): number {
  return handles.size;
}

export async function listLocalWhitelist(): Promise<LocalWhitelistEntry[]> {
  const store = await readStore();
  rebuild(store);
  return store.entries.sort((a, b) => b.addedAt - a.addedAt);
}

export async function listExcluded(): Promise<string[]> {
  const store = await readStore();
  rebuild(store);
  return store.excluded;
}

/** Forget every exclusion — followed accounts may be auto-added again. */
export function clearExcluded(): Promise<void> {
  return serialized(async () => {
    const store = await readStore();
    await writeStore({ entries: store.entries, excluded: [] });
  });
}

/** Add (or enrich) an entry. Returns true when the list actually changed.
 *  A manual add of an existing following-sourced row upgrades its source so
 *  a later unfollow cannot silently drop a deliberate choice; a manual add
 *  also lifts a previous exclusion. An automatic ("following") add of an
 *  excluded handle is refused. */
export function addLocalWhitelist(input: {
  handle: string;
  userId?: string;
  displayName?: string;
  avatarUrl?: string;
  source: LocalWhitelistSource;
}): Promise<boolean> {
  return serialized(async () => {
    const handle = normalizeWhitelistHandle(input.handle);
    if (!handle) return false;
    const k = handle.toLowerCase();
    const uid = input.userId && USER_ID_RE.test(input.userId) ? input.userId : undefined;
    const avatar = input.avatarUrl && AVATAR_RE.test(input.avatarUrl) ? input.avatarUrl : undefined;
    const store = await readStore();
    const excludedIdx = store.excluded.indexOf(k);
    if (excludedIdx >= 0) {
      if (input.source !== "manual") {
        rebuild(store);
        return false;
      }
      store.excluded.splice(excludedIdx, 1);
    }
    const cur = store.entries.find((e) => e.handle.toLowerCase() === k);
    if (cur) {
      let changed = excludedIdx >= 0;
      if (uid && !cur.userId) {
        cur.userId = uid;
        changed = true;
      }
      if (input.displayName && !cur.displayName) {
        cur.displayName = input.displayName.slice(0, 80);
        changed = true;
      }
      if (avatar && cur.avatarUrl !== avatar) {
        cur.avatarUrl = avatar;
        changed = true;
      }
      if (input.source === "manual" && cur.source !== "manual") {
        cur.source = "manual";
        changed = true;
      }
      if (changed) await writeStore(store);
      else rebuild(store);
      return changed;
    }
    if (store.entries.length >= MAX_LOCAL_WHITELIST) {
      rebuild(store);
      return false;
    }
    store.entries.push({
      handle,
      ...(uid ? { userId: uid } : {}),
      ...(input.displayName ? { displayName: input.displayName.slice(0, 80) } : {}),
      ...(avatar ? { avatarUrl: avatar } : {}),
      source: input.source,
      addedAt: Date.now(),
    });
    await writeStore(store);
    return true;
  });
}

/** Remove an entry AND remember the handle as excluded from automatic
 *  re-adding (the user said "not this one"). */
export function removeLocalWhitelist(handle: string): Promise<boolean> {
  return serialized(async () => {
    const k = (normalizeWhitelistHandle(handle) ?? "").toLowerCase();
    if (!k) return false;
    const store = await readStore();
    const next = store.entries.filter((e) => e.handle.toLowerCase() !== k);
    if (next.length === store.entries.length) {
      rebuild(store);
      return false;
    }
    const excluded = store.excluded.includes(k) ? store.excluded : [...store.excluded, k].slice(-MAX_EXCLUDED);
    await writeStore({ entries: next, excluded });
    return true;
  });
}

/** Following auto-add: called from the scan path with every extracted
 *  signal set. Cheap when nothing to do (one or two Set lookups). */
export function noteFollowing(sig: Signals, enabled: boolean): void {
  if (!enabled || !sig.viewerFollowing || sig.viewerIsSelf) return;
  if (isLocallyWhitelisted(sig.userId, sig.handle) || isExcludedFromAuto(sig.handle)) return;
  void addLocalWhitelist({
    handle: sig.handle,
    ...(sig.userId ? { userId: sig.userId } : {}),
    ...(sig.displayName ? { displayName: sig.displayName } : {}),
    ...(sig.avatarUrl ? { avatarUrl: sig.avatarUrl } : {}),
    source: "following",
  });
}
