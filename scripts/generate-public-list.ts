#!/usr/bin/env tsx
import { readFileSync } from "node:fs";
import { generatePublicList } from "../src/public-list/generate.ts";

const [version, sourceCommit] = process.argv.slice(2);

if (!version || !sourceCommit) {
  console.error("Usage: tsx scripts/generate-public-list.ts <version> <sourceCommit>");
  console.error("  version      – SemVer tag, e.g. v1.0.0");
  console.error("  sourceCommit – Git SHA of the code that produced this release");
  process.exit(1);
}

const sourcePath = process.env.CURATION_DB_PATH ?? ".curation-db/records.jsonl";
const outDir = process.env.PUBLIC_LIST_DIR ?? "public-list";

const result = generatePublicList({ sourcePath, outDir, version, sourceCommit });

console.log("✅ Public list generated");
console.log(`   meta.json      → ${result.metaPath} (${result.metaSizeBytes} bytes)`);
console.log(`   index.json     → ${result.indexPath} (${result.indexSizeBytes} bytes)`);
console.log(`   shards/        → ${result.shardDir} (${result.totalEntries} entries)`);
console.log(`   removedCount   → ${result.removedCount}`);
