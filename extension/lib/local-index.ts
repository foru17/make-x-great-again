// Local public-member index — shipped with the extension, loaded at startup.
// Provides O(1) lookup by numeric userId and handle. No remote requests.
// The index is a small, curated list of known spam accounts.
import type { Verdict } from "./types";

export interface IndexEntry {
  userId: string;
  handle: string;
  verdict: Verdict;
  source: "curated" | "community";
  updatedAt: string; // ISO date
}

// ---- Embedded public index (curated subset; full list fetched at build time) ----
// This is a minimal seed. In production, a build script would embed the full
// published list from the curation service into this file.
const SEED_INDEX: IndexEntry[] = [
  // Example entries — replace with actual curated list at build time.
  // Each entry has a numeric userId (reliable) and a handle (fallback).
];

// ---- In-memory lookup structures ----
let userIdMap: Map<string, IndexEntry> | null = null;
let handleMap: Map<string, IndexEntry> | null = null;
let warmed = false;

function buildMaps() {
  userIdMap = new Map();
  handleMap = new Map();
  for (const entry of SEED_INDEX) {
    userIdMap.set(entry.userId, entry);
    handleMap.set(entry.handle.toLowerCase(), entry);
  }
}

/** Warm the local index at startup (synchronous, <50ms). */
export function warmLocalIndex(): void {
  if (warmed) return;
  buildMaps();
  warmed = true;
}

/** Synchronous lookup by numeric userId. Returns null if not found. */
export function lookupByUserId(userId: string): IndexEntry | null {
  if (!warmed) warmLocalIndex();
  return userIdMap?.get(userId) ?? null;
}

/** Synchronous lookup by handle (case-insensitive). Returns null if not found. */
export function lookupByHandle(handle: string): IndexEntry | null {
  if (!warmed) warmLocalIndex();
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
  if (!warmed) warmLocalIndex();
  return SEED_INDEX.length;
}
