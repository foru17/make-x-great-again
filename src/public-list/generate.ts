import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CurationRecord } from "../schema.ts";
import { add, createBloomFilter, serialize } from "./bloom.ts";
import { BloomIndex, Meta, type PublicEntry, ShardManifest } from "./schema.ts";

export interface GenerateOptions {
  /** Path to the private JSONL curation DB (one CurationRecord per line). */
  sourcePath: string;
  /** Output directory for the public list (will create data/shards/ inside). */
  outDir: string;
  /** SemVer version tag for this release. */
  version: string;
  /** Git commit SHA of the source code that produced this release. */
  sourceCommit: string;
  /** Number of shards (default 256). */
  shardCount?: number;
  /** Verdict labels eligible for public list (default ["spam","porn_bot"]). */
  eligibleLabels?: ReadonlyArray<"spam" | "porn_bot" | "likely_spam" | "uncertain" | "legit">;
  /** Minimum review status required (default "human_confirmed"). */
  minReviewStatus?: "auto_pending_review" | "human_confirmed" | "human_rejected";
}

export interface GenerateResult {
  metaPath: string;
  indexPath: string;
  shardDir: string;
  totalEntries: number;
  removedCount: number;
  indexSizeBytes: number;
  metaSizeBytes: number;
}

/**
 * Read the private curation DB, filter to human-confirmed entries,
 * dedupe by userId (latest createdAt wins), hash-shard, and write
 * public list artefacts.
 *
 * Returns paths and sizes so the caller can validate or commit.
 */
export function generatePublicList(opts: GenerateOptions): GenerateResult {
  const {
    sourcePath,
    outDir,
    version,
    sourceCommit,
    shardCount = 256,
    eligibleLabels = ["spam", "porn_bot"],
    minReviewStatus = "human_confirmed",
  } = opts;

  // 1. Read & parse
  const records = readCurationDb(sourcePath);

  // 2. Filter to eligible, confirmed entries
  const eligible = records.filter(
    (r) => r.reviewStatus === minReviewStatus && eligibleLabels.includes(r.verdict.label),
  );

  // 3. Deduplicate by userId — latest createdAt wins
  const byId = new Map<string, CurationRecord>();
  for (const r of eligible) {
    const existing = byId.get(r.userId);
    if (!existing || r.createdAt > existing.createdAt) {
      byId.set(r.userId, r);
    }
  }

  // 4. Convert to PublicEntry and sort by numeric id
  const entries: PublicEntry[] = Array.from(byId.values())
    .map((r) => ({
      id: r.userId,
      h: r.handle,
      v: r.verdict.label as "spam" | "porn_bot",
      c: Math.round(r.verdict.confidence * 100) / 100,
      r: r.verdict.reasons.slice(0, 6),
      t: new Date(r.createdAt).getTime(),
    }))
    .sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));

  // 5. Build bloom filter
  const filter = createBloomFilter();
  for (const e of entries) add(filter, e.id);
  const index = BloomIndex.parse({
    schema: 1,
    ...serialize(filter),
  });

  // 6. Shard by hash bucket. Rebuild data/ from scratch so removed or
  // successfully appealed accounts cannot survive as stale shard files.
  const dataDir = join(outDir, "data");
  rmSync(dataDir, { recursive: true, force: true });
  const shardDir = join(dataDir, "shards");
  mkdirSync(shardDir, { recursive: true });
  const shards = new Map<string, PublicEntry[]>();
  for (const e of entries) {
    const bucket = hashBucket(e.id, shardCount);
    const list = shards.get(bucket) ?? [];
    list.push(e);
    shards.set(bucket, list);
  }
  for (const [bucket, list] of shards) {
    const manifest = ShardManifest.parse({ schema: 1, bucket, count: list.length, list });
    writeFileSync(join(shardDir, `${bucket}.json`), JSON.stringify(manifest, null, 2), "utf8");
  }

  // 7. Write index.json
  const indexPath = join(dataDir, "index.json");
  writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf8");

  // 8. Write meta.json
  const meta = Meta.parse({
    schema: 1,
    version,
    generatedAt: Date.now(),
    sourceCommit,
    count: entries.length,
    shardCount,
    removedCount: (opts["removedCount" as keyof GenerateOptions] as number | undefined) ?? 0,
  });
  const metaPath = join(dataDir, "meta.json");
  writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");

  return {
    metaPath,
    indexPath,
    shardDir,
    totalEntries: entries.length,
    removedCount: meta.removedCount,
    indexSizeBytes: Buffer.byteLength(JSON.stringify(index), "utf8"),
    metaSizeBytes: Buffer.byteLength(JSON.stringify(meta), "utf8"),
  };
}

function readCurationDb(path: string): CurationRecord[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const out: CurationRecord[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as CurationRecord);
    } catch {
      // Skip malformed lines; the caller can warn if needed.
    }
  }
  return out;
}

/**
 * FNV-1a 32-bit hash of a numeric string, returned as a hex bucket id.
 * Avoids JavaScript BigInt precision issues by hashing the string directly.
 */
export function hashBucket(userId: string, shardCount: number): string {
  let hash = 2166136261;
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  const idx = Math.abs(hash | 0) % shardCount;
  return idx.toString(16).padStart(2, "0");
}
