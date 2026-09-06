// Local whitelist — the user's OWN never-touch list. Highest-priority guard in
// the whole detection chain: an account here is never badged, never sent for
// online detection, never rule-matched and — the reason it exists — never
// auto-processed, even when the public list or a rule says spam.
//
// Two ways in:
//   - manual: the user adds a handle from the badge popover or the options
//     page (白名单 tab);
//   - following: accounts the viewer follows are added automatically when
//     they are seen with the viewer-follows relationship (fiber / bridge /
//     the profile follow button / the viewer's own /following page). Gated
//     by settings.followingWhitelist (default on).
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
  source: LocalWhitelistSource;
  addedAt: number;
}

interface Store {
  entries: LocalWhitelistEntry[];
}

/** Hard cap on entries — a very large following list still fits, while a
 *  runaway harvest cannot grow storage without bound. */
export const MAX_LOCAL_WHITELIST = 20_000;

const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const USER_ID_RE = /^\d{1,32}$/;

export function normalizeWhitelistHandle(raw: string | undefined | null): string | null {
  const h = (raw ?? "").trim().replace(/^@+/, "");
  return HANDLE_RE.test(h) ? h : null;
}

// In-memory mirrors for the synchronous hot-path check. Rebuilt from storage
// on warm and on every storage change (any tab / the options page).
let handles = new Set<string>();
let ids = new Set<string>();
/** The onChanged emitter we subscribed to — re-subscribe if the runtime
 *  object is swapped (test doubles); a real page only ever has one. */
let subscribedTo: unknown = null;

function rebuild(entries: LocalWhitelistEntry[]): void {
  const h = new Set<string>();
  const i = new Set<string>();
  for (const e of entries) {
    if (e?.handle) h.add(e.handle.toLowerCase());
    if (e?.userId) i.add(e.userId);
  }
  handles = h;
  ids = i;
}

function sanitize(raw: unknown): LocalWhitelistEntry[] {
  const v = raw as Partial<Store> | undefined;
  if (!v || !Array.isArray(v.entries)) return [];
  const out: LocalWhitelistEntry[] = [];
  const seen = new Set<string>();
  for (const row of v.entries as Partial<LocalWhitelistEntry>[]) {
    const handle = normalizeWhitelistHandle(row?.handle);
    if (!handle) continue;
    const k = handle.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      handle,
      ...(row.userId && USER_ID_RE.test(row.userId) ? { userId: row.userId } : {}),
      ...(typeof row.displayName === "string" && row.displayName
        ? { displayName: row.displayName.slice(0, 80) }
        : {}),
      source: row.source === "following" ? "following" : "manual",
      addedAt: typeof row.addedAt === "number" ? row.addedAt : 0,
    });
    if (out.length >= MAX_LOCAL_WHITELIST) break;
  }
  return out;
}

async function readStore(): Promise<LocalWhitelistEntry[]> {
  try {
    const got = await chrome.storage.local.get(LOCAL_WL_KEY);
    return sanitize(got[LOCAL_WL_KEY]);
  } catch {
    return [];
  }
}

async function writeStore(entries: LocalWhitelistEntry[]): Promise<void> {
  rebuild(entries); // optimistic: the hot path sees the change before the storage event
  try {
    await chrome.storage.local.set({ [LOCAL_WL_KEY]: { entries } satisfies Store });
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

export function localWhitelistSize(): number {
  return handles.size;
}

export async function listLocalWhitelist(): Promise<LocalWhitelistEntry[]> {
  const entries = await readStore();
  rebuild(entries);
  return entries.sort((a, b) => b.addedAt - a.addedAt);
}

/** Add (or enrich) an entry. Returns true when the list actually changed.
 *  A manual add of an existing following-sourced row upgrades its source so
 *  a later unfollow cannot silently drop a deliberate choice. */
export function addLocalWhitelist(input: {
  handle: string;
  userId?: string;
  displayName?: string;
  source: LocalWhitelistSource;
}): Promise<boolean> {
  return serialized(async () => {
    const handle = normalizeWhitelistHandle(input.handle);
    if (!handle) return false;
    const uid = input.userId && USER_ID_RE.test(input.userId) ? input.userId : undefined;
    const entries = await readStore();
    const k = handle.toLowerCase();
    const cur = entries.find((e) => e.handle.toLowerCase() === k);
    if (cur) {
      let changed = false;
      if (uid && !cur.userId) {
        cur.userId = uid;
        changed = true;
      }
      if (input.displayName && !cur.displayName) {
        cur.displayName = input.displayName.slice(0, 80);
        changed = true;
      }
      if (input.source === "manual" && cur.source !== "manual") {
        cur.source = "manual";
        changed = true;
      }
      if (changed) await writeStore(entries);
      else rebuild(entries);
      return changed;
    }
    if (entries.length >= MAX_LOCAL_WHITELIST) return false;
    entries.push({
      handle,
      ...(uid ? { userId: uid } : {}),
      ...(input.displayName ? { displayName: input.displayName.slice(0, 80) } : {}),
      source: input.source,
      addedAt: Date.now(),
    });
    await writeStore(entries);
    return true;
  });
}

export function removeLocalWhitelist(handle: string): Promise<boolean> {
  return serialized(async () => {
    const k = (normalizeWhitelistHandle(handle) ?? "").toLowerCase();
    if (!k) return false;
    const entries = await readStore();
    const next = entries.filter((e) => e.handle.toLowerCase() !== k);
    if (next.length === entries.length) {
      rebuild(entries);
      return false;
    }
    await writeStore(next);
    return true;
  });
}

/** Following auto-add: called from the scan path with every extracted
 *  signal set. Cheap when nothing to do (one Set lookup). */
export function noteFollowing(sig: Signals, enabled: boolean): void {
  if (!enabled || !sig.viewerFollowing || sig.viewerIsSelf) return;
  if (isLocallyWhitelisted(sig.userId, sig.handle)) return;
  void addLocalWhitelist({
    handle: sig.handle,
    ...(sig.userId ? { userId: sig.userId } : {}),
    ...(sig.displayName ? { displayName: sig.displayName } : {}),
    source: "following",
  });
}
