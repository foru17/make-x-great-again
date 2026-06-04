import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcPath = path.resolve(__dirname, "../data/blacklist/v1.json");
const destPath = path.resolve(__dirname, "../extension/public/blacklist-data.json");

console.log("Reading raw blacklist from:", srcPath);
const rawData = fs.readFileSync(srcPath, "utf-8");
const parsed = JSON.parse(rawData);

console.log("Found raw entries count:", parsed.list.length);

// Extract only necessary fields for extension lookup:
// [x_user_id, handle, verdict_label, confidence, reasons]
const compacted = parsed.list.map((item) => {
  return [
    item.x_user_id || "",
    item.handle || "",
    item.verdict_label || "spam",
    item.confidence ?? 1,
    item.reasons || [],
  ];
});

console.log("Writing compacted blacklist to:", destPath);
fs.mkdirSync(path.dirname(destPath), { recursive: true });
fs.writeFileSync(destPath, JSON.stringify(compacted), "utf-8");

console.log(
  "Done! Compacted blacklist size:",
  (fs.statSync(destPath).size / 1024 / 1024).toFixed(2),
  "MB",
);
