// Backup & migration — export the user's OWN local data to a JSON file and
// import it on another browser / profile.
//
// What travels (all of it user-authored or user-earned, nothing secret):
//   settings · local whitelist · custom rules + disabled official rules ·
//   hidden accounts (fast-path ids + 处理记录) · local stats ·
//   optionally the detection cache (account verdicts; can be large).
// What NEVER travels: the GitHub token / login, the synced public lists (they
// re-sync in minutes), the rule-hit telemetry queue, pending X actions, the
// template memory, the viewer capture. A backup file must be safe to share.
//
// Import validates every field (a hostile or hand-edited file can set only
// known keys to known-shaped values), never writes the excluded keys, and
// either MERGES (union of lists, counters summed) or REPLACES per section.
import { type Cached } from "./cache";
import { SPAM_CATEGORIES } from "./category";
import {
  CUSTOM_RULES_KEY,
  type CustomRule,
  DISABLED_RULES_KEY,
  validateCustomRules,
} from "./local-rules";
import {
  LOCAL_WL_KEY,
  type LocalWhitelistEntry,
  MAX_LOCAL_WHITELIST,
  sanitizeLocalWhitelist,
} from "./local-whitelist";
import { DEFAULTS, SETTINGS_KEY, type Settings, getSettings } from "./settings";
import type { BlockRecord } from "./store";
import type { Label, Verdict } from "./types";

export const BACKUP_FORMAT = "mxga-backup";
export const BACKUP_VERSION = 1;

/** Storage keys touched by backup — the single place that decides scope. */
const KEYS = {
  settings: SETTINGS_KEY,
  whitelist: LOCAL_WL_KEY,
  customRules: CUSTOM_RULES_KEY,
  disabledRules: DISABLED_RULES_KEY,
  blockedIds: "xss:blocked",
  blockRecords: "xss:blocklist:v2",
  stats: "xss:stats",
  localStats: "mxga_stats_v1",
} as const;
const CACHE_PREFIX = "xss:v1:";

export interface BackupData {
  settings?: Partial<Settings>;
  localWhitelist?: LocalWhitelistEntry[];
  customRules?: CustomRule[];
  disabledRules?: string[];
  hidden?: { ids: string[]; records: BlockRecord[] };
  stats?: {
    detections?: number;
    cacheHits?: number;
    blocks?: number;
    byLabel?: Record<string, number>;
    scanned?: number;
    hitPublic?: number;
    blocked?: number;
    firstUsedAt?: number;
  };
  cache?: Record<string, Cached>;
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  extensionVersion: string;
  data: BackupData;
}

export interface BackupSummary {
  settings: boolean;
  localWhitelist: number;
  customRules: number;
  disabledRules: number;
  hiddenIds: number;
  hiddenRecords: number;
  stats: boolean;
  cache: number;
}

export type BackupSection = keyof BackupSummary;
export type ImportMode = "merge" | "replace";

export interface ExportOptions {
  includeCache?: boolean;
  includeStats?: boolean;
}

const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const HIDDEN_ID_RE = /^(\d{1,32}|h:[A-Za-z0-9_]{1,15})$/;
const LABELS = new Set<Label>(["spam", "porn_bot", "likely_spam", "uncertain", "legit"]);
const BLOCK_SOURCES = new Set(["manual", "auto", "block_all", "list_hit", "cache_hit"]);
const MAX_HIDDEN = 50_000;
const MAX_CACHE = 20_000;
const MAX_DISABLED = 5_000;

async function storageGet(keys: string[] | null): Promise<Record<string, unknown>> {
  try {
    return (await chrome.storage.local.get(keys as never)) as unknown as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function storageSet(obj: Record<string, unknown>): Promise<void> {
  if (!Object.keys(obj).length) return;
  await chrome.storage.local.set(obj);
}

function extensionVersion(): string {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return "unknown";
  }
}

// ---- export -----------------------------------------------------------------

export async function exportBackup(opts: ExportOptions = {}): Promise<BackupFile> {
  const includeStats = opts.includeStats ?? true;
  const includeCache = opts.includeCache ?? false;
  const got = await storageGet(includeCache ? null : Object.values(KEYS));
  const settings = await getSettings();
  const data: BackupData = {
    settings,
    localWhitelist: sanitizeLocalWhitelist(got[KEYS.whitelist]),
    customRules: validateCustomRules(got[KEYS.customRules]),
    disabledRules: sanitizeDisabled(got[KEYS.disabledRules]),
    hidden: sanitizeHidden(got[KEYS.blockedIds], got[KEYS.blockRecords]),
  };
  if (includeStats) {
    const s = (got[KEYS.stats] ?? {}) as Record<string, unknown>;
    const l = (got[KEYS.localStats] ?? {}) as Record<string, unknown>;
    data.stats = sanitizeStats({ ...s, ...l });
  }
  if (includeCache) {
    const cache: Record<string, Cached> = {};
    for (const [k, v] of Object.entries(got)) {
      if (!k.startsWith(CACHE_PREFIX)) continue;
      const c = sanitizeCached(v);
      if (c) cache[k.slice(CACHE_PREFIX.length)] = c;
      if (Object.keys(cache).length >= MAX_CACHE) break;
    }
    data.cache = cache;
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    extensionVersion: extensionVersion(),
    data,
  };
}

export function backupFileName(now = new Date()): string {
  return `mxga-backup-${now.toISOString().slice(0, 10)}.json`;
}

// ---- validation ---------------------------------------------------------------

function sanitizeDisabled(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of raw) {
    if (typeof p !== "string") continue;
    const t = p.trim();
    if (!t || t.length > 200 || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_DISABLED) break;
  }
  return out;
}

function sanitizeVerdict(raw: unknown): Verdict | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const v = raw as Partial<Verdict>;
  if (!v.label || !LABELS.has(v.label)) return undefined;
  const confidence =
    typeof v.confidence === "number" && Number.isFinite(v.confidence)
      ? Math.min(1, Math.max(0, v.confidence))
      : 0;
  const reasons = Array.isArray(v.reasons)
    ? v.reasons.filter((r): r is string => typeof r === "string").slice(0, 6).map((r) => r.slice(0, 300))
    : [];
  return { label: v.label, confidence, reasons };
}

function sanitizeRecord(raw: unknown): BlockRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<BlockRecord>;
  if (typeof r.id !== "string" || !HIDDEN_ID_RE.test(r.id)) return null;
  const handle =
    typeof r.handle === "string" && HANDLE_RE.test(r.handle)
      ? r.handle
      : r.id.startsWith("h:")
        ? r.id.slice(2)
        : null;
  if (!handle) return null;
  const verdict = sanitizeVerdict(r.verdict);
  return {
    id: r.id,
    handle,
    ...(typeof r.displayName === "string" ? { displayName: r.displayName.slice(0, 80) } : {}),
    ...(typeof r.avatarUrl === "string" && /^https:\/\/pbs\.twimg\.com\//.test(r.avatarUrl)
      ? { avatarUrl: r.avatarUrl.slice(0, 300) }
      : {}),
    ...(verdict ? { verdict } : {}),
    ...(typeof r.reason === "string" ? { reason: r.reason.slice(0, 200) } : {}),
    ...(typeof r.tweetId === "string" && /^\d{1,32}$/.test(r.tweetId) ? { tweetId: r.tweetId } : {}),
    ...(typeof r.tweetText === "string" ? { tweetText: r.tweetText.slice(0, 500) } : {}),
    source: typeof r.source === "string" && BLOCK_SOURCES.has(r.source) ? r.source : "manual",
    ts: typeof r.ts === "number" && Number.isFinite(r.ts) ? r.ts : Date.now(),
  };
}

function sanitizeHidden(idsRaw: unknown, recordsRaw: unknown): { ids: string[]; records: BlockRecord[] } {
  const ids = new Set<string>();
  const records: BlockRecord[] = [];
  const seenRec = new Set<string>();
  if (Array.isArray(recordsRaw)) {
    for (const raw of recordsRaw) {
      const rec = sanitizeRecord(raw);
      if (!rec || seenRec.has(rec.id)) continue;
      seenRec.add(rec.id);
      records.push(rec);
      ids.add(rec.id);
      if (records.length >= MAX_HIDDEN) break;
    }
  }
  if (Array.isArray(idsRaw)) {
    for (const id of idsRaw) {
      if (typeof id === "string" && HIDDEN_ID_RE.test(id)) ids.add(id);
      if (ids.size >= MAX_HIDDEN) break;
    }
  }
  return { ids: [...ids], records };
}

function sanitizeStats(raw: unknown): NonNullable<BackupData["stats"]> {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  const byLabel: Record<string, number> = {};
  if (s.byLabel && typeof s.byLabel === "object") {
    for (const [k, v] of Object.entries(s.byLabel as Record<string, unknown>)) {
      if (LABELS.has(k as Label)) byLabel[k] = num(v);
    }
  }
  return {
    detections: num(s.detections),
    cacheHits: num(s.cacheHits),
    blocks: num(s.blocks),
    byLabel,
    scanned: num(s.scanned),
    hitPublic: num(s.hitPublic),
    blocked: num(s.blocked),
    ...(typeof s.firstUsedAt === "number" && s.firstUsedAt > 0 ? { firstUsedAt: s.firstUsedAt } : {}),
  };
}

function sanitizeCached(raw: unknown): Cached | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Partial<Cached>;
  const verdict = sanitizeVerdict(c.verdict);
  if (!verdict || typeof c.ts !== "number" || !Number.isFinite(c.ts)) return null;
  return {
    verdict,
    signalsHash: typeof c.signalsHash === "string" ? c.signalsHash.slice(0, 32) : "",
    model: typeof c.model === "string" ? c.model.slice(0, 64) : "import",
    ts: c.ts,
    ...(typeof c.handle === "string" && HANDLE_RE.test(c.handle) ? { handle: c.handle } : {}),
    ...(typeof c.displayName === "string" ? { displayName: c.displayName.slice(0, 80) } : {}),
    ...(typeof c.avatarUrl === "string" && /^https:\/\/pbs\.twimg\.com\//.test(c.avatarUrl)
      ? { avatarUrl: c.avatarUrl.slice(0, 300) }
      : {}),
  };
}

const ACTION_MODES = new Set(["local", "mute", "block"]);
const CATEGORY_ACTIONS = new Set(["badge", "hide", "mute", "block"]);
const AUTO_SCOPES = new Set(["replies", "all"]);
const AUTO_TIERS = new Set(["badge", "hide", "full"]);
const BUBBLE_POS = new Set(["tr", "br"]);

/** Keep only known settings keys with values of the right shape; a hand-
 *  edited file cannot inject unknown keys or off-enum values. */
export function sanitizeSettings(raw: unknown): Partial<Settings> {
  if (!raw || typeof raw !== "object") return {};
  const s = raw as Record<string, unknown>;
  const out: Partial<Settings> = {};
  const bool = (k: keyof Settings) => {
    if (typeof s[k] === "boolean") (out as Record<string, unknown>)[k] = s[k];
  };
  for (const k of [
    "enabled",
    "bubble",
    "autoProcess",
    "autoExpand",
    "officialRulesEnabled",
    "ruleTelemetry",
    "followingWhitelist",
  ] as const) {
    bool(k);
  }
  if (typeof s.actionMode === "string" && ACTION_MODES.has(s.actionMode)) out.actionMode = s.actionMode as Settings["actionMode"];
  if (typeof s.autoScope === "string" && AUTO_SCOPES.has(s.autoScope)) out.autoScope = s.autoScope as Settings["autoScope"];
  if (typeof s.autoTierMode === "string" && AUTO_TIERS.has(s.autoTierMode)) out.autoTierMode = s.autoTierMode as Settings["autoTierMode"];
  if (typeof s.bubblePos === "string" && BUBBLE_POS.has(s.bubblePos)) out.bubblePos = s.bubblePos as Settings["bubblePos"];
  if (typeof s.edgeBase === "string" && (s.edgeBase === "" || /^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(s.edgeBase))) {
    out.edgeBase = s.edgeBase.slice(0, 200);
  }
  if (s.categoryActions && typeof s.categoryActions === "object") {
    const ca: Partial<Settings["categoryActions"]> = {};
    for (const cat of SPAM_CATEGORIES) {
      const v = (s.categoryActions as Record<string, unknown>)[cat];
      if (typeof v === "string" && CATEGORY_ACTIONS.has(v)) ca[cat] = v as Settings["categoryActions"][typeof cat];
    }
    if (Object.keys(ca).length) out.categoryActions = { ...DEFAULTS.categoryActions, ...ca };
  }
  return out;
}

/** Parse + validate a backup file's text. Never throws. */
export function parseBackup(
  text: string,
): { ok: true; file: BackupFile; summary: BackupSummary } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "不是有效的 JSON 文件" };
  }
  if (!raw || typeof raw !== "object") return { ok: false, error: "文件内容不是备份对象" };
  const f = raw as Partial<BackupFile>;
  if (f.format !== BACKUP_FORMAT) return { ok: false, error: "不是 MXGA 备份文件（format 不匹配）" };
  if (typeof f.version !== "number" || f.version > BACKUP_VERSION) {
    return { ok: false, error: `备份版本 ${String(f.version)} 高于当前扩展支持的 ${BACKUP_VERSION}，请先升级扩展` };
  }
  const d = (f.data && typeof f.data === "object" ? f.data : {}) as Record<string, unknown>;
  const data: BackupData = {};
  if (d.settings !== undefined) data.settings = sanitizeSettings(d.settings);
  if (d.localWhitelist !== undefined) data.localWhitelist = sanitizeLocalWhitelist({ entries: d.localWhitelist });
  if (d.customRules !== undefined) data.customRules = validateCustomRules(d.customRules);
  if (d.disabledRules !== undefined) data.disabledRules = sanitizeDisabled(d.disabledRules);
  if (d.hidden && typeof d.hidden === "object") {
    const h = d.hidden as Record<string, unknown>;
    data.hidden = sanitizeHidden(h.ids, h.records);
  }
  if (d.stats !== undefined) data.stats = sanitizeStats(d.stats);
  if (d.cache && typeof d.cache === "object") {
    const cache: Record<string, Cached> = {};
    for (const [k, v] of Object.entries(d.cache as Record<string, unknown>)) {
      if (!HIDDEN_ID_RE.test(k)) continue;
      const c = sanitizeCached(v);
      if (c) cache[k] = c;
      if (Object.keys(cache).length >= MAX_CACHE) break;
    }
    data.cache = cache;
  }
  const file: BackupFile = {
    format: BACKUP_FORMAT,
    version: f.version,
    exportedAt: typeof f.exportedAt === "string" ? f.exportedAt.slice(0, 40) : "",
    extensionVersion: typeof f.extensionVersion === "string" ? f.extensionVersion.slice(0, 20) : "",
    data,
  };
  return { ok: true, file, summary: summarize(file) };
}

export function summarize(file: BackupFile): BackupSummary {
  const d = file.data;
  return {
    settings: !!d.settings && Object.keys(d.settings).length > 0,
    localWhitelist: d.localWhitelist?.length ?? 0,
    customRules: d.customRules?.length ?? 0,
    disabledRules: d.disabledRules?.length ?? 0,
    hiddenIds: d.hidden?.ids.length ?? 0,
    hiddenRecords: d.hidden?.records.length ?? 0,
    stats: !!d.stats,
    cache: d.cache ? Object.keys(d.cache).length : 0,
  };
}

// ---- import ------------------------------------------------------------------

/** Apply a parsed backup. `mode` = merge (union lists, sum counters) or
 *  replace (overwrite each present section). Only the keys in KEYS (+ the
 *  cache prefix) are ever written. Returns what was applied. */
export async function importBackup(
  file: BackupFile,
  mode: ImportMode,
  sections: Partial<Record<BackupSection, boolean>> = {},
): Promise<BackupSummary> {
  const want = (s: BackupSection) => sections[s] !== false;
  const d = file.data;
  const writes: Record<string, unknown> = {};
  const applied: BackupSummary = {
    settings: false,
    localWhitelist: 0,
    customRules: 0,
    disabledRules: 0,
    hiddenIds: 0,
    hiddenRecords: 0,
    stats: false,
    cache: 0,
  };
  const cur = await storageGet(Object.values(KEYS));

  if (d.settings && want("settings") && Object.keys(d.settings).length) {
    const current = await getSettings();
    writes[KEYS.settings] = {
      ...current,
      ...d.settings,
      categoryActions: { ...current.categoryActions, ...(d.settings.categoryActions ?? {}) },
    };
    applied.settings = true;
  }

  if (d.localWhitelist && want("localWhitelist")) {
    const existing = mode === "merge" ? sanitizeLocalWhitelist(cur[KEYS.whitelist]) : [];
    const byHandle = new Map(existing.map((e) => [e.handle.toLowerCase(), e]));
    let added = 0;
    for (const e of d.localWhitelist) {
      const k = e.handle.toLowerCase();
      const prev = byHandle.get(k);
      if (!prev) {
        if (byHandle.size >= MAX_LOCAL_WHITELIST) break;
        byHandle.set(k, e);
        added += 1;
      } else if (e.source === "manual" && prev.source !== "manual") {
        byHandle.set(k, { ...prev, source: "manual" });
      } else if (e.userId && !prev.userId) {
        byHandle.set(k, { ...prev, userId: e.userId });
      }
    }
    writes[KEYS.whitelist] = { entries: [...byHandle.values()] };
    applied.localWhitelist = mode === "merge" ? added : d.localWhitelist.length;
  }

  if (d.customRules && want("customRules")) {
    const existing = mode === "merge" ? validateCustomRules(cur[KEYS.customRules]) : [];
    const merged = validateCustomRules([...existing, ...d.customRules]);
    writes[KEYS.customRules] = merged;
    applied.customRules = merged.length - existing.length;
  }

  if (d.disabledRules && want("disabledRules")) {
    const existing = mode === "merge" ? sanitizeDisabled(cur[KEYS.disabledRules]) : [];
    const merged = sanitizeDisabled([...existing, ...d.disabledRules]);
    writes[KEYS.disabledRules] = merged;
    applied.disabledRules = merged.length - existing.length;
  }

  if (d.hidden && want("hiddenIds")) {
    const existing =
      mode === "merge" ? sanitizeHidden(cur[KEYS.blockedIds], cur[KEYS.blockRecords]) : { ids: [], records: [] };
    const ids = new Set(existing.ids);
    const recIds = new Set(existing.records.map((r) => r.id));
    const records = [...existing.records];
    let addedIds = 0;
    let addedRecs = 0;
    for (const rec of d.hidden.records) {
      if (recIds.has(rec.id) || records.length >= MAX_HIDDEN) continue;
      recIds.add(rec.id);
      records.push(rec);
      addedRecs += 1;
    }
    for (const id of d.hidden.ids) {
      if (ids.has(id) || ids.size >= MAX_HIDDEN) continue;
      ids.add(id);
      addedIds += 1;
    }
    for (const rec of records) ids.add(rec.id);
    writes[KEYS.blockedIds] = [...ids];
    writes[KEYS.blockRecords] = records;
    applied.hiddenIds = addedIds;
    applied.hiddenRecords = addedRecs;
  }

  if (d.stats && want("stats")) {
    const inc = d.stats;
    const curS = sanitizeStats({
      ...((cur[KEYS.stats] as object) ?? {}),
      ...((cur[KEYS.localStats] as object) ?? {}),
    });
    const add = (a: number | undefined, b: number | undefined) =>
      mode === "merge" ? (a ?? 0) + (b ?? 0) : (b ?? 0);
    const byLabel: Record<string, number> = mode === "merge" ? { ...curS.byLabel } : {};
    for (const [k, v] of Object.entries(inc.byLabel ?? {})) byLabel[k] = (byLabel[k] ?? 0) + v;
    writes[KEYS.stats] = {
      detections: add(curS.detections, inc.detections),
      cacheHits: add(curS.cacheHits, inc.cacheHits),
      blocks: add(curS.blocks, inc.blocks),
      byLabel,
    };
    writes[KEYS.localStats] = {
      scanned: add(curS.scanned, inc.scanned),
      hitPublic: add(curS.hitPublic, inc.hitPublic),
      blocked: add(curS.blocked, inc.blocked),
      firstUsedAt: Math.min(curS.firstUsedAt ?? Number.POSITIVE_INFINITY, inc.firstUsedAt ?? Number.POSITIVE_INFINITY) ||
        Date.now(),
    };
    if (!Number.isFinite(writes[KEYS.localStats] && (writes[KEYS.localStats] as { firstUsedAt: number }).firstUsedAt)) {
      (writes[KEYS.localStats] as { firstUsedAt: number }).firstUsedAt = Date.now();
    }
    applied.stats = true;
  }

  if (d.cache && want("cache")) {
    const existingKeys = new Set(
      mode === "merge" ? Object.keys(await storageGet(null)).filter((k) => k.startsWith(CACHE_PREFIX)) : [],
    );
    let n = 0;
    for (const [id, c] of Object.entries(d.cache)) {
      const k = CACHE_PREFIX + id;
      if (existingKeys.has(k)) continue;
      writes[k] = c;
      n += 1;
    }
    applied.cache = n;
  }

  await storageSet(writes);
  return applied;
}
