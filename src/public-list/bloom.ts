import { createHash } from "node:crypto";

/**
 * Zero-dependency Bloom filter using SHA-256 double-hashing.
 * Portable: runs in Node, Deno, Bun, and any modern browser (Web Crypto).
 *
 * Parameters are tuned for ~10k entries at 1% false-positive rate:
 *   m = 95850 bits  (~12 KB)
 *   k = 7 hashes
 *
 * For larger sets, the caller can scale m linearly with n.
 */

export interface BloomFilter {
  m: number;
  k: number;
  n: number;
  bits: Uint8Array;
}

const DEFAULT_M = 95850;
const DEFAULT_K = 7;

export function createBloomFilter(m = DEFAULT_M, k = DEFAULT_K): BloomFilter {
  return { m, k, n: 0, bits: new Uint8Array(Math.ceil(m / 8)) };
}

/** Insert a key (string) into the filter. */
export function add(filter: BloomFilter, key: string): void {
  const { m, k } = filter;
  const hashes = hashPair(key);
  for (let i = 0; i < k; i++) {
    const idx = (hashes.h1 + i * hashes.h2) % m;
    setBit(filter.bits, idx);
  }
  filter.n += 1;
}

/** Test whether a key is *probably* in the set. */
export function test(filter: BloomFilter, key: string): boolean {
  const { m, k } = filter;
  const hashes = hashPair(key);
  for (let i = 0; i < k; i++) {
    const idx = (hashes.h1 + i * hashes.h2) % m;
    if (!getBit(filter.bits, idx)) return false;
  }
  return true;
}

/** Serialize to the wire format used in index.json. */
export function serialize(filter: BloomFilter): { k: number; m: number; n: number; bits: string } {
  return {
    k: filter.k,
    m: filter.m,
    n: filter.n,
    bits: Buffer.from(filter.bits).toString("base64"),
  };
}

/** Deserialize from the wire format. */
export function deserialize(data: { k: number; m: number; n: number; bits: string }): BloomFilter {
  const bits = Buffer.from(data.bits, "base64");
  return { m: data.m, k: data.k, n: data.n, bits };
}

// ---- internals ----

function setBit(bits: Uint8Array, idx: number): void {
  const byteIdx = idx >> 3;
  const bitMask = 1 << (idx & 7);
  bits[byteIdx] = (bits[byteIdx] ?? 0) | bitMask;
}

function getBit(bits: Uint8Array, idx: number): boolean {
  const byteIdx = idx >> 3;
  return ((bits[byteIdx] ?? 0) & (1 << (idx & 7))) !== 0;
}

/** Produce two 32-bit hashes from a single SHA-256 digest (double-hashing). */
function hashPair(key: string): { h1: number; h2: number } {
  const digest = createHash("sha256").update(key, "utf8").digest();
  const h1 = digest.readUInt32BE(0);
  const h2 = digest.readUInt32BE(4);
  // Ensure non-negative 32-bit ints
  return { h1: h1 >>> 0, h2: h2 >>> 0 };
}
