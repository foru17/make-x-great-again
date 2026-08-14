// Remote blocklist sync — replaces the old bundled blacklist-data.json.
//
// The extension package ships NO list. The background service worker
// downloads the compact "lite" artifact (schema v2, ~4.8MB raw / ~1.5MB on
// the wire) from the official public source and caches it in
// chrome.storage.local; content scripts read the cache and hot-swap via
// storage.onChanged. Privacy stance is unchanged: this is a read-only GET of
// a public artifact — nothing about the user or their browsing is uploaded.
import { BRAND } from "./brand";
import { getSettings } from "./settings";

/** Lite artifact row: [x_user_id ("" when handle-only), handle, "<label><category>"] */
export type LiteRow = [string, string, string];

export interface StoredList {
  version: string;
  fetchedAt: number; // epoch ms of the successful download
  count: number;
  entries: LiteRow[];
  /** Maintainer-curated blacklist keyword rules shipped with the artifact:
   *  [pattern, fieldCode, labelCode+categoryCode]. Absent in older caches. */
  rules?: [string, string, string][];
}

export const LIST_KEY = "xss:list:v2";
export const WL_KEY = "xss:whitelist:v1";

/** Official whitelist row: [x_user_id ("" when unknown), handle]. Accounts
 *  on it are NEVER badged / auto-processed — the safety valve against
 *  blacklist false positives. */
export interface StoredWhitelist {
  fetchedAt: number;
  count: number;
  entries: [string, string][];
}

// Refuse to overwrite a good cached list with a suspiciously tiny one — a
// half-deployed or corrupted artifact must not wipe local protection.
const MIN_SANE_ENTRIES = 1000;

interface ListMeta {
  version?: string;
  artifacts?: { lite?: string } | null;
}

interface LiteArtifact {
  schema?: number;
  version?: string;
  count?: number;
  entries?: unknown;
  rules?: unknown;
}

const MAX_LITE_BYTES = 25 * 1024 * 1024;
const MAX_WHITELIST_BYTES = 2 * 1024 * 1024;
const MAX_META_BYTES = 64 * 1024;
const MAX_LIST_ENTRIES = 250_000;
const MAX_RULES = 10_000;
// A published snapshot can contain a handful of stale database rows whose
// handle is no longer a valid X handle. The sync path may quarantine at most
// this many rows; larger damage still rejects the artifact wholesale.
const MAX_DROPPED_ENTRY_ROWS = 100;
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const USER_ID_RE = /^\d{1,32}$/;
const ENTRY_CODE_RE = /^[ps][pcgrmo](?:[ha])?$/;
const RULE_FIELD_RE = /^[hdbta]$/;
const RULE_CODE_RE = /^[ps][pcgrmo]$/;
const ARTIFACT_PATH_RE = /^\/v1\/artifacts\/[A-Za-z0-9._-]+$/;

type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

function validIdentity(uid: unknown, handle: unknown): boolean {
  return (
    typeof uid === "string" &&
    (uid === "" || USER_ID_RE.test(uid)) &&
    typeof handle === "string" &&
    HANDLE_RE.test(handle) &&
    (uid !== "" || handle !== "")
  );
}

/** Parse the untrusted lite artifact. Validation is strict by default.
 *  The network-sync path can opt into quarantining a small bounded number of
 *  malformed identity rows so one stale server record does not block every
 *  otherwise-valid list update. */
export function validateLiteArtifact(
  raw: unknown,
  options: { dropInvalidEntries?: boolean } = {},
): ValidationResult<{
  version?: string;
  entries: LiteRow[];
  rules?: [string, string, string][];
  droppedEntries: number;
}> {
  if (!raw || typeof raw !== "object") return { ok: false, error: "artifact is not an object" };
  const lite = raw as LiteArtifact;
  if (lite.schema !== 2 || !Array.isArray(lite.entries)) {
    return { ok: false, error: "unexpected lite schema" };
  }
  if (lite.entries.length > MAX_LIST_ENTRIES) return { ok: false, error: "too many entries" };
  if (
    lite.version !== undefined &&
    (typeof lite.version !== "string" ||
      lite.version.length < 1 ||
      lite.version.length > 128 ||
      !/^[A-Za-z0-9._-]+$/.test(lite.version))
  ) {
    return { ok: false, error: "invalid version" };
  }
  if (
    lite.count !== undefined &&
    (!Number.isSafeInteger(lite.count) || lite.count !== lite.entries.length)
  ) {
    return { ok: false, error: "entry count mismatch" };
  }
  const entries: LiteRow[] = [];
  let droppedEntries = 0;
  for (const row of lite.entries) {
    if (
      !Array.isArray(row) ||
      row.length !== 3 ||
      !validIdentity(row[0], row[1]) ||
      typeof row[2] !== "string" ||
      !ENTRY_CODE_RE.test(row[2])
    ) {
      if (!options.dropInvalidEntries) return { ok: false, error: "invalid entry row" };
      droppedEntries++;
      if (droppedEntries > MAX_DROPPED_ENTRY_ROWS) {
        return { ok: false, error: "too many invalid entry rows" };
      }
      continue;
    }
    // Validation does not mutate rows, so retain the compact tuple instead
    // of allocating a second 100k+ array graph. This matters on iOS, where
    // every active X tab has a tighter memory budget.
    entries.push(row as LiteRow);
  }
  let rules: [string, string, string][] | undefined;
  if (lite.rules !== undefined) {
    if (!Array.isArray(lite.rules) || lite.rules.length > MAX_RULES) {
      return { ok: false, error: "invalid rules collection" };
    }
    rules = [];
    for (const row of lite.rules) {
      if (
        !Array.isArray(row) ||
        row.length !== 3 ||
        typeof row[0] !== "string" ||
        row[0].trim().length < 1 ||
        row[0].length > 200 ||
        typeof row[1] !== "string" ||
        !RULE_FIELD_RE.test(row[1]) ||
        typeof row[2] !== "string" ||
        !RULE_CODE_RE.test(row[2])
      ) {
        return { ok: false, error: "invalid rule row" };
      }
      rules.push([row[0], row[1], row[2]]);
    }
  }
  return { ok: true, value: { version: lite.version, entries, rules, droppedEntries } };
}

export function validateWhitelist(raw: unknown): ValidationResult<[string, string][]> {
  if (!raw || typeof raw !== "object") return { ok: false, error: "whitelist is not an object" };
  const list = (raw as { list?: unknown }).list;
  if (!Array.isArray(list) || list.length > MAX_LIST_ENTRIES) {
    return { ok: false, error: "invalid whitelist collection" };
  }
  const entries: [string, string][] = [];
  for (const row of list) {
    if (!row || typeof row !== "object") return { ok: false, error: "invalid whitelist row" };
    const { x_user_id: rawUid = "", handle } = row as {
      x_user_id?: unknown;
      handle?: unknown;
    };
    const uid = rawUid == null ? "" : rawUid;
    if (!validIdentity(uid, handle)) return { ok: false, error: "invalid whitelist identity" };
    entries.push([uid as string, handle as string]);
  }
  return { ok: true, value: entries };
}

/** Buffer only bounded JSON responses; decompressed bytes count toward the cap. */
export async function readJsonBounded(response: Response, maxBytes: number): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("response too large");
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error("response too large");
    return JSON.parse(text);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("response too large");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally {
    reader.releaseLock();
  }
}

export async function getStoredList(): Promise<StoredList | null> {
  try {
    const got = await chrome.storage.local.get(LIST_KEY);
    const v = got[LIST_KEY] as StoredList | undefined;
    return v && Array.isArray(v.entries) ? v : null;
  } catch {
    return null;
  }
}

export async function getStoredWhitelist(): Promise<StoredWhitelist | null> {
  try {
    const got = await chrome.storage.local.get(WL_KEY);
    const v = got[WL_KEY] as StoredWhitelist | undefined;
    return v && Array.isArray(v.entries) ? v : null;
  } catch {
    return null;
  }
}

export async function edgeBase(): Promise<string> {
  const s = await getSettings();
  return (s.edgeBase || BRAND.edgeBase).replace(/\/+$/, "");
}

export interface SyncResult {
  updated: boolean;
  version?: string;
  black?: number;
  white?: number;
  error?: string;
}

let syncing: Promise<SyncResult> | null = null;

/** Download the latest lite blacklist (when the published version changed,
 *  or always with force) plus the official whitelist (tiny — refreshed on
 *  every attempt). Serialized: concurrent callers share one in-flight sync. */
export function syncList(force = false) {
  if (!syncing) {
    syncing = doSync(force).finally(() => {
      syncing = null;
    });
  }
  return syncing;
}

// /v1/whitelist is a since/limit cursor API. Page through it until a short
// page — a bare no-param fetch once stored only the server's DEFAULT page
// (500 rows) as the whole whitelist while the real set had grown past 2000,
// silently dropping FP protection for everyone whitelisted since (2026-08-14).
const WL_PAGE_LIMIT = 2000;
const WL_MAX_PAGES = 20; // hard fuse: 40k rows is far beyond any plausible set

async function syncWhitelist(base: string): Promise<number | undefined> {
  try {
    const entries: [string, string][] = [];
    let since = 0;
    for (let page = 0; page < WL_MAX_PAGES; page++) {
      const res = await fetch(`${base}/v1/whitelist?since=${since}&limit=${WL_PAGE_LIMIT}`, {
        cache: "no-cache",
      });
      if (!res.ok) return undefined;
      const raw = await readJsonBounded(res, MAX_WHITELIST_BYTES);
      const validated = validateWhitelist(raw);
      if (!validated.ok) return undefined;
      entries.push(...validated.value);
      const meta = raw as { latestAt?: number };
      // Short page → done. Cursor not advancing → server can't page; stop
      // rather than loop on identical requests.
      if (
        validated.value.length < WL_PAGE_LIMIT ||
        typeof meta.latestAt !== "number" ||
        meta.latestAt <= since
      ) {
        break;
      }
      since = meta.latestAt;
    }
    // Shrink-to-empty guard (the whitelist twin of MIN_SANE_ENTRIES): the
    // whitelist is the last line of defense against blacklist false
    // positives, so a server bug returning [] must not wipe a working cache.
    // An empty response only sticks when we never had entries to begin with.
    if (entries.length === 0) {
      const prev = await getStoredWhitelist();
      if (prev && prev.entries.length > 0) return undefined;
    }
    const next: StoredWhitelist = { fetchedAt: Date.now(), count: entries.length, entries };
    await chrome.storage.local.set({ [WL_KEY]: next });
    return entries.length;
  } catch {
    return undefined; // whitelist refresh is best-effort; keep the old cache
  }
}

async function doSync(force: boolean): Promise<SyncResult> {
  try {
    const base = await edgeBase();
    // Whitelist first: it is a few KB and must stay fresh even when the
    // blacklist version hasn't moved (an appeal that whitelists someone
    // should reach clients on the next sync, not the next list release).
    const white = await syncWhitelist(base);

    const metaRes = await fetch(`${base}/v1/list/meta`, { cache: "no-cache" });
    if (!metaRes.ok) return { updated: false, white, error: `meta ${metaRes.status}` };
    const meta = (await readJsonBounded(metaRes, MAX_META_BYTES)) as ListMeta;
    const litePath = meta.artifacts?.lite;
    if (!litePath || !ARTIFACT_PATH_RE.test(litePath)) {
      return { updated: false, white, error: "invalid lite artifact path" };
    }

    const stored = await getStoredList();
    if (!force && stored && meta.version && stored.version === meta.version) {
      return { updated: false, version: stored.version, black: stored.count, white };
    }

    const liteRes = await fetch(`${base}${litePath}`);
    if (!liteRes.ok) return { updated: false, white, error: `lite ${liteRes.status}` };
    const validated = validateLiteArtifact(
      await readJsonBounded(liteRes, MAX_LITE_BYTES),
      { dropInvalidEntries: true },
    );
    if (!validated.ok) return { updated: false, white, error: validated.error };
    const { entries, rules, version } = validated.value;
    if (entries.length < MIN_SANE_ENTRIES) {
      return { updated: false, white, error: `implausibly small list (${entries.length})` };
    }

    const next: StoredList = {
      version: version ?? meta.version ?? `n${entries.length}`,
      fetchedAt: Date.now(),
      count: entries.length,
      entries,
      ...(rules ? { rules } : {}),
    };
    await chrome.storage.local.set({ [LIST_KEY]: next });
    return { updated: true, version: next.version, black: next.count, white };
  } catch (e) {
    return { updated: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const STALE_MS = 24 * 3600_000;

/** Sync only when the cache is missing or older than a day (startup path —
 *  cheap no-op on every browser launch in between). */
export async function syncIfStale(): Promise<void> {
  const stored = await getStoredList();
  if (!stored || Date.now() - stored.fetchedAt > STALE_MS) await syncList();
}
