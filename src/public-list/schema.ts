import { z } from "zod";

/**
 * Public list schema — the minimal, forkable, versioned black/gray list.
 * Every field is intentionally small so the full bloom index stays in
 * the low-tens-of-KB range and the per-shard JSONs are easy to CDN-cache.
 */

export const PublicEntry = z.object({
  /** X numeric user id — immutable, the blocklist key. */
  id: z.string().regex(/^\d+$/, "id must be numeric X user id"),
  /** @handle (mutable, informational only). */
  h: z.string().min(1),
  /** Verdict label — only spam / porn_bot make it into the public list. */
  v: z.enum(["spam", "porn_bot"]),
  /** Confidence 0..1 (rounded to 2 decimals to save bytes). */
  c: z.number().min(0).max(1),
  /** 1–6 short reasons (max 80 chars each). */
  r: z.array(z.string().min(1).max(80)).min(1).max(6),
  /** Unix ms timestamp when the entry was human-confirmed. */
  t: z.number().int().nonnegative(),
});
export type PublicEntry = z.infer<typeof PublicEntry>;

export const Meta = z.object({
  /** Schema version of the public list format. */
  schema: z.literal(1),
  /** SemVer tag of this release. */
  version: z.string().min(1),
  /** Unix ms timestamp when the release was generated. */
  generatedAt: z.number().int().nonnegative(),
  /** Git commit SHA of the source code that produced this release. */
  sourceCommit: z.string().min(1),
  /** Total number of entries across all shards. */
  count: z.number().int().nonnegative(),
  /** Number of shards (must match files under data/shards/). */
  shardCount: z.number().int().nonnegative(),
  /** Number of entries that were removed since the previous release. */
  removedCount: z.number().int().nonnegative().default(0),
});
export type Meta = z.infer<typeof Meta>;

export const BloomIndex = z.object({
  /** Schema version of the index format. */
  schema: z.literal(1),
  /** Number of hash functions used. */
  k: z.number().int().positive(),
  /** Number of bits in the filter. */
  m: z.number().int().positive(),
  /** Total entries that were inserted. */
  n: z.number().int().nonnegative(),
  /** Base64-encoded bit array (little-endian, byte-aligned). */
  bits: z.string().min(1),
});
export type BloomIndex = z.infer<typeof BloomIndex>;

export const ShardManifest = z.object({
  /** Schema version of the shard format. */
  schema: z.literal(1),
  /** Hex bucket id (00–ff for 256 shards). */
  bucket: z.string().regex(/^[0-9a-f]{2}$/),
  /** Number of entries in this shard. */
  count: z.number().int().nonnegative(),
  /** Entries sorted by numeric id ascending. */
  list: z.array(PublicEntry),
});
export type ShardManifest = z.infer<typeof ShardManifest>;
