import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const destPath = path.resolve(__dirname, "../extension/public/blacklist-data.json");

console.log("Loading compacted blacklist...");
const list = JSON.parse(fs.readFileSync(destPath, "utf-8"));
console.log("Loaded successfully. Total entries:", list.length);

// Verify some entries
// Let's test a lookup logic similar to lookupLocal
const userIdMap = new Map();
const handleMap = new Map();

for (const [userId, handle, label, confidence, reasons] of list) {
  const entry = { userId, handle, verdict: { label, confidence, reasons } };
  if (userId) userIdMap.set(userId, entry);
  if (handle) handleMap.set(handle.toLowerCase(), entry);
}

// Test case 1: Lookup by user ID
const testUserId = "2051540655185502208";
const matchById = userIdMap.get(testUserId);
console.log(`\nLookup User ID "${testUserId}":`, matchById ? "✅ MATCHED" : "❌ NOT MATCHED");
if (matchById) {
  console.log("  Handle:", matchById.handle);
  console.log("  Verdict:", matchById.verdict.label);
  console.log("  Reasons:", matchById.verdict.reasons);
}

// Test case 2: Lookup by handle
const testHandle = "clarissale23167";
const matchByHandle = handleMap.get(testHandle.toLowerCase());
console.log(`\nLookup Handle "${testHandle}":`, matchByHandle ? "✅ MATCHED" : "❌ NOT MATCHED");
if (matchByHandle) {
  console.log("  User ID:", matchByHandle.userId);
  console.log("  Verdict:", matchByHandle.verdict.label);
  console.log("  Reasons:", matchByHandle.verdict.reasons);
}

// Test case 3: Non-existent lookup
const nonExistent = "clean_user_123";
const matchClean = handleMap.get(nonExistent.toLowerCase());
console.log(
  `\nLookup non-existent "${nonExistent}":`,
  matchClean ? "❌ MATCHED (Expected: null)" : "✅ NULL (Correct)",
);
