// Local public-member index — shipped with the extension, loaded at startup.
// Provides O(1) lookup by numeric userId and handle. No remote requests.
import type { Verdict } from "./types";

export interface IndexEntry {
  userId: string;
  handle: string;
  verdict: Verdict;
  source: "curated" | "community";
  updatedAt: string; // ISO date
}

// ---- In-memory lookup structures ----
let userIdMap: Map<string, IndexEntry> | null = null;
let handleMap: Map<string, IndexEntry> | null = null;
let warmed = false;

/** Warm the local index at startup (asynchronous, loads blacklist-data.json). */
export async function warmLocalIndex(): Promise<void> {
  if (warmed) return;
  try {
    const url = chrome.runtime.getURL("blacklist-data.json");
    const res = await fetch(url);
    const list = (await res.json()) as [string, string, string, number, string[]][];

    userIdMap = new Map();
    handleMap = new Map();

    for (const [userId, handle, label, confidence, reasons] of list) {
      const entry: IndexEntry = {
        userId,
        handle,
        verdict: {
          label: label as any,
          confidence,
          reasons,
        },
        source: "curated",
        updatedAt: new Date().toISOString(),
      };
      if (userId) userIdMap.set(userId, entry);
      if (handle) handleMap.set(handle.toLowerCase(), entry);
    }
    warmed = true;
  } catch (e) {
    console.error("Failed to load local blacklist index:", e);
  }
}

/** Synchronous lookup by numeric userId. Returns null if not found. */
export function lookupByUserId(userId: string): IndexEntry | null {
  return userIdMap?.get(userId) ?? null;
}

/** Synchronous lookup by handle (case-insensitive). Returns null if not found. */
export function lookupByHandle(handle: string): IndexEntry | null {
  return handleMap?.get(handle.toLowerCase()) ?? null;
}

/** Lookup by userId first, fall back to handle. */
export function lookupLocal(userId?: string, handle?: string): IndexEntry | null {
  if (userId) {
    const byId = lookupByUserId(userId);
    if (byId) return byId;
  }
  if (handle) {
    return lookupByHandle(handle);
  }
  return null;
}

/** Total entries in the loaded index. */
export function indexSize(): number {
  return userIdMap ? userIdMap.size : 0;
}
