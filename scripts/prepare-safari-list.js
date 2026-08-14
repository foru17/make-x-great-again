import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// The live snapshot lives on the data-mirror branch (main's data/ froze on
// 2026-08-03), so prefer fetching it; the local checkout copy is the offline
// fallback and may be stale.
const remoteSource =
  process.env.MXGA_LIST_URL ??
  "https://raw.githubusercontent.com/foru17/make-x-great-again/data-mirror/data/blacklist/v2-lite.json";
const localSource = path.join(root, "data/blacklist/v2-lite.json");
const destination = path.join(root, "extension/public/blacklist-data.json");

if (process.argv.includes("--clean")) {
  fs.rmSync(destination, { force: true });
  process.exit(0);
}

const offline = process.argv.includes("--offline") || process.env.MXGA_LIST_OFFLINE === "1";
let raw;
let source;
if (offline) {
  source = localSource;
  raw = fs.readFileSync(localSource, "utf8");
} else {
  try {
    const res = await fetch(remoteSource);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    raw = await res.text();
    source = remoteSource;
  } catch (err) {
    console.warn(
      `WARN: fetch ${remoteSource} failed (${err.message}); ` +
        `falling back to local snapshot, which may be stale: ${localSource}`,
    );
    source = localSource;
    raw = fs.readFileSync(localSource, "utf8");
  }
}

const artifact = JSON.parse(raw);
if (artifact?.schema !== 2 || !Array.isArray(artifact.entries) || artifact.entries.length < 1000) {
  throw new Error(`invalid Safari fallback list: ${source}`);
}

// Mirror of extension/lib/list-sync.ts row validation. The published snapshot
// can carry a few stale rows with invalid handles; drop them here so the
// packaged fallback passes the extension's validator on first load. A large
// drop count means the source artifact is broken — fail the build instead.
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const USER_ID_RE = /^\d{1,32}$/;
const ENTRY_CODE_RE = /^[ps][pcgrmo](?:[ha])?$/;
const MAX_DROPPED_ROWS = 100;
const kept = artifact.entries.filter(
  (row) =>
    Array.isArray(row) &&
    row.length === 3 &&
    typeof row[0] === "string" &&
    (row[0] === "" || USER_ID_RE.test(row[0])) &&
    typeof row[1] === "string" &&
    HANDLE_RE.test(row[1]) &&
    (row[0] !== "" || row[1] !== "") &&
    typeof row[2] === "string" &&
    ENTRY_CODE_RE.test(row[2]),
);
const dropped = artifact.entries.length - kept.length;
if (dropped > MAX_DROPPED_ROWS) {
  throw new Error(`Safari fallback list has ${dropped} invalid rows (max ${MAX_DROPPED_ROWS}): ${source}`);
}
artifact.entries = kept;
if (artifact.count !== undefined) artifact.count = kept.length;

fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, JSON.stringify(artifact));
console.log(
  `Prepared Safari fallback list from ${source === remoteSource ? "data-mirror branch" : "local snapshot"}: ` +
    `${artifact.entries.length} entries ` +
    `(${dropped} invalid rows dropped), ` +
    `${(fs.statSync(destination).size / 1024 / 1024).toFixed(2)} MB`,
);
